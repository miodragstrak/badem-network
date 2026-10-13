import json
import sqlite3

import httpx
import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

from backend.app import create_app
from backend.discovery import google_provider, models
from backend.discovery.google_provider import MAX_CANDIDATES, GooglePlacesDiscoveryProvider, normalize_place
from backend.discovery.mock_provider import MockDiscoveryProvider
from backend.discovery.places_client import (
    FIELD_MASK, MAX_RESULTS_PER_QUERY, REQUEST_TIMEOUT_SECONDS, TEXT_SEARCH_URL,
    DiscoveryConfigurationError, DiscoveryProviderError, DiscoveryTimeoutError, GooglePlacesClient,
)
from backend.discovery.profile_builder import build_profile
from backend.discovery.providers import create_provider
from backend.discovery.query_builder import build_queries
from backend.discovery.scorer import score_profile
from backend.discovery.service import DiscoveryService
from test_discovery import ADMIN, SPECIFICATION, connection_factory, create_request, discover, specify


def listing(place_id="test-place-1", name="Laser Engraving Wood Studio", city="Belgrade", country="RS"):
    return {"id": place_id, "displayName": {"text": name},
            "primaryType": "manufacturer", "types": ["manufacturer", "establishment"],
            "addressComponents": [
                {"longText": city, "types": ["locality", "political"]},
                {"longText": "Serbia", "shortText": country, "types": ["country", "political"]},
            ]}


def places_client(monkeypatch, handler):
    monkeypatch.setenv("GOOGLE_PLACES_API_KEY", "test-only-placeholder")
    return GooglePlacesClient(transport=httpx.MockTransport(handler))


@pytest.fixture
def google_setup(tmp_path, monkeypatch):
    monkeypatch.delenv("BADEM_NODE_ID", raising=False)
    monkeypatch.delenv("BADEM_NODE_PUBLIC_KEY", raising=False)
    monkeypatch.setenv("BADEM_DISCOVERY_PROVIDER", "google_places")
    monkeypatch.setenv("GOOGLE_PLACES_API_KEY", "test-only-placeholder")
    calls = []
    payload = {"places": [listing(), listing("test-place-2", "General repair workshop", city="Novi Sad")]}

    def handle(request):
        calls.append(request)
        if isinstance(payload.get("error"), httpx.HTTPError):
            raise payload["error"]
        return httpx.Response(payload.get("status_code", 200), json=payload)

    monkeypatch.setattr(google_provider, "GooglePlacesClient",
                        lambda: GooglePlacesClient(transport=httpx.MockTransport(handle)))
    db_path = tmp_path / "google-discovery.db"
    with TestClient(create_app(str(db_path), "admin", "laser-01", "test-secret")) as client:
        yield client, db_path, payload, calls


def test_minimal_field_mask_body_endpoint_timeout_and_closed_client(monkeypatch):
    calls = []

    class ObservedTransport(httpx.MockTransport):
        closed = False

        def close(self):
            self.closed = True

    def handle(request):
        calls.append(request)
        assert request.method == "POST"
        assert str(request.url) == TEXT_SEARCH_URL
        assert request.url.query == b""
        assert request.headers["X-Goog-Api-Key"] == "test-only-placeholder"
        assert request.headers["X-Goog-FieldMask"] == FIELD_MASK
        assert set(FIELD_MASK.split(",")) == {
            "places.id", "places.displayName", "places.addressComponents", "places.primaryType", "places.types",
        }
        assert json.loads(request.content) == {"textQuery": "laser engraving service wood Belgrade RS",
            "pageSize": MAX_RESULTS_PER_QUERY, "languageCode": "en"}
        assert request.extensions["timeout"] == {
            kind: REQUEST_TIMEOUT_SECONDS for kind in ("connect", "read", "write", "pool")}
        return httpx.Response(200, json={"places": [listing()]})

    monkeypatch.setenv("GOOGLE_PLACES_API_KEY", "test-only-placeholder")
    transport = ObservedTransport(handle)
    assert len(GooglePlacesClient(transport=transport).text_search(build_queries(SPECIFICATION)[0])) == 1
    assert len(calls) == 1
    assert transport.closed is True


def test_google_normalization_uses_returned_public_fields_only():
    partner = normalize_place(listing())
    assert partner.source == models.GOOGLE_SOURCE
    assert partner.source_place_id == "test-place-1"
    assert (partner.display_name, partner.city, partner.country) == ("Laser Engraving Wood Studio", "Belgrade", "RS")
    assert partner.materials == ("wood",)
    assert partner.specializations == ("establishment", "manufacturer")
    assert partner.website_keywords == partner.review_keywords == partner.equipment == ()
    assert partner.public_activity is False
    profile = build_profile(partner)
    assert profile["is_mock"] is False
    assert profile["inferred_capabilities"] == [{"capability": "laser_engraving", "confidence": .75,
        "evidence": ["business name contains 'laser engraving'", "business name contains 'engraving'"]}]
    score = score_profile(SPECIFICATION, profile)
    assert score.score_breakdown == {"process_match": 40, "material_signal": 20, "equipment_signal": 0,
        "business_specialization": 10, "location_suitability": 10, "public_activity_signal": 0}
    assert profile["confidence"] == "medium"
    assert all("mock" not in reason.casefold() for reason in score.reasoning)


@pytest.mark.parametrize("changes", [
    {}, {"displayName": None, "addressComponents": None, "primaryType": None, "types": None},
    {"displayName": {"text": 17}, "addressComponents": [None, {}], "types": [None, 2, {}]},
    {"displayName": "not localized text", "addressComponents": "not a list", "types": {}},
])
def test_missing_or_malformed_optional_fields_are_safe_and_never_inherit_search_location(changes):
    partner = normalize_place({"id": "test-sparse", **changes})
    assert partner.display_name == "Unnamed Google Places listing"
    assert partner.city == partner.country == ""
    profile = build_profile(partner)
    assert profile["location_summary"] == "Location unavailable"
    assert profile["inferred_capabilities"] == []
    assert score_profile(SPECIFICATION, profile).fit_score == 0


@pytest.mark.parametrize("place_id", [None, "", "   ", 23, {}, [], "malformed id", "places/id", "x" * 513])
def test_missing_or_malformed_place_ids_are_skipped(place_id):
    assert normalize_place({"id": place_id}) is None


def test_structured_locality_has_priority_over_postal_town_and_address_text_is_not_guessed():
    place = listing()
    place["addressComponents"].append({"longText": "Postal district", "types": ["postal_town"]})
    assert normalize_place(place).city == "Belgrade"
    assert normalize_place({"id": "test-address", "formattedAddress": "Belgrade, Serbia"}).city == ""


def test_google_deduplicates_by_place_id_across_three_queries_and_keeps_first_listing(monkeypatch):
    calls = []

    def handle(request):
        calls.append(request)
        return httpx.Response(200, json={"places": [
            listing("same-id", "First name" if len(calls) == 1 else "Changed name"),
            listing(f"unique-{len(calls)}"), {}, {"id": None}, "malformed item",
        ]})

    result = GooglePlacesDiscoveryProvider(places_client(monkeypatch, handle)).discover(SPECIFICATION)
    assert len(calls) == 3
    assert [partner.source_place_id for partner in result] == ["same-id", "unique-1", "unique-2", "unique-3"]
    assert result[0].display_name == "First name"


def test_result_and_candidate_caps_ignore_extra_results_and_do_not_paginate_or_retry(monkeypatch):
    calls = []

    def handle(request):
        calls.append(request)
        return httpx.Response(200, json={"places": [listing(f"p-{len(calls)}-{n}") for n in range(30)],
                                        "nextPageToken": "must-not-follow"})

    result = GooglePlacesDiscoveryProvider(places_client(monkeypatch, handle)).discover(SPECIFICATION)
    assert len(calls) == 2
    assert len(result) == MAX_CANDIDATES == 10
    assert all(json.loads(call.content)["pageSize"] == 5 for call in calls)
    assert all("pageToken" not in json.loads(call.content) for call in calls)
    assert all(partner.source_place_id.rsplit("-", 1)[1] in {"0", "1", "2", "3", "4"} for partner in result)


def test_unknown_process_does_not_contact_google(monkeypatch):
    def forbidden(request):
        pytest.fail("Unknown taxonomy must not generate a generic Google query")

    assert GooglePlacesDiscoveryProvider(places_client(monkeypatch, forbidden)).discover(
        {"process": ["future_process"], "materials": ["wood"]}) == []


@pytest.mark.parametrize("body", [{}, {"places": []}, {"places": [None, "bad", {}, {"id": 4}]}])
def test_empty_google_results_are_valid(monkeypatch, body):
    provider = GooglePlacesDiscoveryProvider(places_client(monkeypatch, lambda _: httpx.Response(200, json=body)))
    assert provider.discover(SPECIFICATION) == []


@pytest.mark.parametrize("body", [
    None, [], "bad", {"error": {}}, {"unexpected": "shape"}, {"places": None}, {"places": {}}, {"places": "bad"},
])
def test_malformed_top_level_responses_are_provider_errors(monkeypatch, body):
    client = places_client(monkeypatch, lambda _: httpx.Response(200, content=json.dumps(body)))
    with pytest.raises(DiscoveryProviderError, match="malformed"):
        client.text_search("laser engraving")


def test_invalid_json_is_a_sanitized_provider_error(monkeypatch):
    client = places_client(monkeypatch, lambda _: httpx.Response(200, content=b"not JSON"))
    with pytest.raises(DiscoveryProviderError, match="invalid JSON"):
        client.text_search("laser engraving")


@pytest.mark.parametrize("status", [301, 400, 401, 403, 429, 500, 503])
def test_non_success_response_is_sanitized_without_redirects_or_retries(monkeypatch, status):
    calls = []

    def handle(request):
        calls.append(request)
        return httpx.Response(status, json={"error": {"message": "test-only-placeholder private upstream detail"}},
                              headers={"Location": "https://must-not-follow.invalid"})

    client = places_client(monkeypatch, handle)
    with pytest.raises(DiscoveryProviderError) as error:
        client.text_search("laser engraving")
    assert error.value.status_code == 502
    assert "test-only-placeholder" not in str(error.value)
    assert "private upstream detail" not in str(error.value)
    assert len(calls) == 1


@pytest.mark.parametrize("exception,error_type,status", [
    (httpx.ConnectTimeout, DiscoveryTimeoutError, 504), (httpx.ReadTimeout, DiscoveryTimeoutError, 504),
    (httpx.ConnectError, DiscoveryProviderError, 502), (httpx.RemoteProtocolError, DiscoveryProviderError, 502),
])
def test_network_failures_are_sanitized(monkeypatch, exception, error_type, status):
    def handle(request):
        raise exception("test-only-placeholder secret detail", request=request)

    client = places_client(monkeypatch, handle)
    with pytest.raises(error_type) as error:
        client.text_search("laser engraving")
    assert error.value.status_code == status
    assert "test-only-placeholder" not in str(error.value)


def test_provider_selection_defaults_to_mock_and_ignores_unused_google_credentials(monkeypatch):
    assert isinstance(create_provider(), MockDiscoveryProvider)
    monkeypatch.setenv("GOOGLE_PLACES_API_KEY", "test-only-placeholder")
    monkeypatch.setenv("BADEM_DISCOVERY_PROVIDER", "mock")
    assert isinstance(create_provider(), MockDiscoveryProvider)


def test_google_provider_is_explicit_opt_in(monkeypatch):
    monkeypatch.setenv("BADEM_DISCOVERY_PROVIDER", "google_places")
    monkeypatch.setenv("GOOGLE_PLACES_API_KEY", "test-only-placeholder")
    assert isinstance(create_provider(), GooglePlacesDiscoveryProvider)


@pytest.mark.parametrize("key", [None, "", "   "])
def test_google_selection_requires_environment_key_without_silent_fallback(monkeypatch, key, tmp_path):
    monkeypatch.setenv("BADEM_DISCOVERY_PROVIDER", "google_places")
    if key is not None:
        monkeypatch.setenv("GOOGLE_PLACES_API_KEY", key)
    with pytest.raises(DiscoveryConfigurationError, match="GOOGLE_PLACES_API_KEY is required"):
        create_provider()
    with pytest.raises(DiscoveryConfigurationError, match="GOOGLE_PLACES_API_KEY is required"):
        create_app(str(tmp_path / "config.db"), "admin", "laser-01", "test-secret")


@pytest.mark.parametrize("name", ["", "typo", "private value must not be echoed"])
def test_unknown_provider_is_a_clear_configuration_error(monkeypatch, name):
    monkeypatch.setenv("BADEM_DISCOVERY_PROVIDER", name)
    with pytest.raises(DiscoveryConfigurationError, match="must be mock or google_places") as error:
        create_provider()
    assert "private value" not in str(error.value)


def test_google_api_results_are_ranked_public_only_and_do_not_store_raw_payloads(google_setup):
    client, db_path, payload, calls = google_setup
    payload["places"][0]["unrequestedPrivateField"] = "must-not-persist"
    request_id = create_request(client)
    assert specify(client, request_id).status_code == 201
    response = discover(client, request_id)
    assert response.status_code == 200, response.text
    result = response.json()
    assert result["provider"] == models.GOOGLE_SOURCE
    assert result["status"] == "DISCOVERY_COMPLETE"
    assert len(calls) == 3
    assert [candidate["fit_score"] for candidate in result["candidates"]] == [80, 5]
    for candidate, place_id in zip(result["candidates"], ("test-place-1", "test-place-2")):
        assert candidate["source"] == models.GOOGLE_SOURCE
        assert candidate["is_mock"] is False
        assert candidate["verification_status"] == models.VERIFICATION_STATUS
        assert candidate["disclaimer"] == models.DISCLAIMER
        detail = client.get(f"/api/partner-candidates/{candidate['candidate_id']}", headers=ADMIN).json()
        assert detail["source_place_id"] == place_id
        assert detail["partner_profile"]["source"] == models.GOOGLE_SOURCE
        assert detail["partner_profile"]["is_mock"] is False
        assert detail["partner_profile"]["verification_status"] == models.VERIFICATION_STATUS
        assert detail["partner_profile"]["disclaimer"] == models.DISCLAIMER
        wording = json.dumps(detail).casefold()
        assert all(claim not in wording for claim in ("can manufacture", "verified supplier", "will manufacture"))
    assert client.get(f"/api/manufacturing-requests/{request_id}/candidates", headers=ADMIN).json() == result
    assert discover(client, request_id).json() == result
    with sqlite3.connect(db_path) as connection:
        stored = " ".join(row[0] for row in connection.execute("SELECT profile_json FROM public_capacity_profiles"))
        assert "must-not-persist" not in stored
        assert "displayName" not in stored
        assert "addressComponents" not in stored
        assert "test-only-placeholder" not in stored
        assert connection.execute("SELECT COUNT(*) FROM partner_candidates").fetchone() == (2,)
        for table in ("jobs", "machine_events", "production_proofs", "proof_anchors"):
            assert connection.execute(f"SELECT COUNT(*) FROM {table}").fetchone() == (0,)


@pytest.mark.parametrize("failure,status", [("status", 502), ("malformed", 502), ("timeout", 504)])
def test_google_failures_are_http_errors_preserving_prior_results_and_other_routes(google_setup, failure, status):
    client, _, payload, calls = google_setup
    request_id = create_request(client)
    specify(client, request_id)
    before = discover(client, request_id).json()
    payload.clear()
    if failure == "status":
        payload.update({"status_code": 429, "error": "test-only-placeholder"})
    elif failure == "timeout":
        payload["error"] = httpx.ReadTimeout("test-only-placeholder")
    else:
        payload["places"] = None
    count = len(calls)
    failed = discover(client, request_id)
    assert failed.status_code == status
    assert len(calls) == count + 1
    assert "Google Places" in failed.json()["detail"]
    assert "test-only-placeholder" not in failed.text
    assert client.get(f"/api/manufacturing-requests/{request_id}/candidates", headers=ADMIN).json() == before
    assert client.post("/jobs", headers=ADMIN, json={
        "title": "still available", "machine_id": "laser-01", "file_sha256": "a" * 64}).status_code == 201


def test_google_empty_search_completes_and_replaces_old_results(google_setup):
    client, db_path, payload, _ = google_setup
    request_id = create_request(client)
    specify(client, request_id)
    discover(client, request_id)
    payload.clear()
    result = discover(client, request_id).json()
    assert result == {"request_id": request_id, "status": "DISCOVERY_COMPLETE",
                      "provider": models.GOOGLE_SOURCE, "candidates": []}
    with sqlite3.connect(db_path) as connection:
        assert connection.execute("SELECT COUNT(*) FROM public_capacity_profiles").fetchone() == (0,)


def test_persisted_google_results_are_not_relabelled_when_configuration_changes(google_setup):
    client, db_path, _, _ = google_setup
    request_id = create_request(client)
    specify(client, request_id)
    before = discover(client, request_id).json()
    service = DiscoveryService(lambda: connection_factory(db_path), provider=MockDiscoveryProvider())
    assert service.get_candidates(request_id) == before
    mock = service.discover(request_id)
    assert mock["provider"] == models.MOCK_SOURCE
    assert all(candidate["is_mock"] for candidate in mock["candidates"])


def test_provider_io_holds_no_database_lock_and_rejects_stale_specification(google_setup, monkeypatch):
    client, db_path, _, _ = google_setup
    request_id = create_request(client)
    specify(client, request_id)
    before = discover(client, request_id).json()

    def change_spec_during_search(request):
        # Independent writer succeeds while the mocked upstream request is in flight.
        with sqlite3.connect(db_path, timeout=.1) as connection:
            connection.execute("UPDATE manufacturing_specifications SET payload_json=? WHERE request_id=?",
                               (json.dumps({"process": ["3d_printing"], "materials": ["pla"]}), request_id))
        return httpx.Response(200, json={"places": [listing()]})

    service = DiscoveryService(lambda: connection_factory(db_path), provider=GooglePlacesDiscoveryProvider(
        places_client(monkeypatch, change_spec_during_search)))
    with pytest.raises(HTTPException, match="specification changed") as error:
        service.discover(request_id)
    assert error.value.status_code == 409
    assert service.get_candidates(request_id) == before


def test_google_auth_and_missing_specification_do_not_call_upstream(google_setup):
    client, _, _, calls = google_setup
    request_id = create_request(client)
    assert client.post(f"/api/manufacturing-requests/{request_id}/discover").status_code == 401
    assert discover(client, request_id).status_code == 409
    assert discover(client, "unknown").status_code == 404
    assert calls == []


def test_multilingual_google_candidates_rank_by_signals_with_exact_disclaimer_and_persisted_evidence(google_setup):
    client, db_path, payload, calls = google_setup
    names = {"explicit": "Penda lasersko graviranje", "laser": "Tenzor Laser",
             "wood": "Wooding Studio", "print": "Laser Print - Reklamni materijal i brendiranje",
             "unrelated": "General repair workshop"}
    payload["places"] = [listing(place_id, name) for place_id, name in names.items()]
    request_id = create_request(client)
    specify(client, request_id)
    response = discover(client, request_id)
    assert response.status_code == 200, response.text
    candidates = response.json()["candidates"]
    assert len(candidates) == 5
    assert len(calls) == 3
    assert candidates[0]["name"] == names["explicit"]
    assert candidates[-1]["name"] == names["unrelated"]
    by_name = {candidate["name"]: candidate for candidate in candidates}
    explicit = by_name[names["explicit"]]
    generic = by_name[names["laser"]]
    assert explicit["fit_score"] > generic["fit_score"] > 10
    assert explicit["score_breakdown"]["process_match"] > generic["score_breakdown"]["process_match"] > 0
    assert explicit["score_breakdown"]["business_specialization"] > 0
    assert by_name[names["wood"]]["score_breakdown"]["material_signal"] > 0
    assert by_name[names["print"]]["score_breakdown"]["business_specialization"] > 0
    for candidate in candidates:
        assert candidate["disclaimer"] == models.DISCLAIMER
        assert candidate["verification_status"] == models.VERIFICATION_STATUS
        assert candidate["source"] == models.GOOGLE_SOURCE
        assert candidate["is_mock"] is False
        assert candidate["score_breakdown"]["equipment_signal"] == 0
        assert candidate["score_breakdown"]["public_activity_signal"] == 0
        detail = client.get(f"/api/partner-candidates/{candidate['candidate_id']}", headers=ADMIN).json()
        assert detail["source_place_id"] in names
        assert detail["partner_profile"]["disclaimer"] == models.DISCLAIMER
        if candidate["name"] == names["explicit"]:
            capability = detail["partner_profile"]["inferred_capabilities"][0]
            assert "business name contains 'lasersko graviranje'" in capability["evidence"]
            assert capability["confidence"] == .75
        wording = json.dumps(detail).casefold()
        assert all(claim not in wording for claim in (
            "can perform", "has laser equipment", "supports plywood", "verified supplier", "can manufacture"))
    with sqlite3.connect(db_path) as connection:
        stored = " ".join(row[0] for row in connection.execute("SELECT profile_json FROM public_capacity_profiles"))
        assert "lasersko graviranje" in stored
        assert connection.execute("SELECT COUNT(*) FROM partner_candidates").fetchone() == (5,)
    assert client.get(f"/api/manufacturing-requests/{request_id}/candidates", headers=ADMIN).json() == response.json()
    assert discover(client, request_id).json() == response.json()
