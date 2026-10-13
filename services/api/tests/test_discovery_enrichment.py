from copy import deepcopy
import json
import sqlite3

import httpx
import pytest
from fastapi.testclient import TestClient

from backend.app import create_app
from backend.discovery import google_provider, models
from backend.discovery.enrichment import (
    DEFAULT_ENRICH_TOP_N, MAX_ENRICH_TOP_N, apply_enrichment, configured_enrichment_limit,
    derive_public_evidence, public_activity_points,
)
from backend.discovery.google_provider import normalize_place
from backend.discovery.places_client import (
    DETAILS_FIELD_MASK, PLACE_DETAILS_URL, REQUEST_TIMEOUT_SECONDS, TEXT_SEARCH_URL,
    DiscoveryConfigurationError, DiscoveryProviderError, DiscoveryTimeoutError, GooglePlacesClient,
)
from backend.discovery.profile_builder import build_profile
from backend.discovery.providers import create_provider
from backend.discovery.scorer import WEIGHTS, score_profile
from backend.discovery.service import DiscoveryService
from test_discovery import ADMIN, SPECIFICATION, connection_factory, create_request, discover, specify
from test_discovery_signals import public_profile
from test_google_discovery import listing, places_client


DETAILS = {"websiteUri": "https://listing.invalid/laser-engraving?private=must-not-persist",
           "rating": 4.7, "userRatingCount": 83, "businessStatus": "OPERATIONAL"}
NAMES = {"p-a": "General Workshop", "p-b": "Tenzor Laser", "p-c": "graver doo",
         "p-d": "Penda lasersko graviranje", "p-e": "Wooding Studio",
         "p-f": "Laser Engraving Wood Studio", "p-g": "3D Print & Prototype Studio", "p-h": "CNC Wood Studio"}
BASE_TOP_THREE = ["p-f", "p-d", "p-c"]


class MockPlaces:
    def __init__(self):
        self.records = [listing(place_id, name) for place_id, name in NAMES.items()]
        self.searches = []
        self.details = []
        self.detail_results = {}
        self.search_failure = None

    def __call__(self, request):
        assert request.url.host == "places.googleapis.com", "Never fetch business websites or other hosts"
        if request.method == "POST":
            assert str(request.url) == TEXT_SEARCH_URL
            self.searches.append(request)
            if isinstance(self.search_failure, httpx.HTTPError):
                raise self.search_failure
            if self.search_failure:
                return httpx.Response(self.search_failure, json={"error": "private upstream detail"})
            queries = list(dict.fromkeys(json.loads(call.content)["textQuery"] for call in self.searches))
            index = queries.index(json.loads(request.content)["textQuery"])
            return httpx.Response(200, json={"places": self.records[index * 5:(index + 1) * 5]})
        assert request.method == "GET"
        place_id = request.url.path.rsplit("/", 1)[1]
        assert str(request.url) == PLACE_DETAILS_URL + place_id
        assert request.headers["X-Goog-FieldMask"] == DETAILS_FIELD_MASK
        assert request.url.query == b""
        self.details.append(request)
        result = self.detail_results.get(place_id, DETAILS)
        if callable(result):
            return result(request)
        if isinstance(result, httpx.HTTPError):
            raise result
        if isinstance(result, httpx.Response):
            return result
        return httpx.Response(200, content=json.dumps(result))

    def detail_ids(self):
        return [request.url.path.rsplit("/", 1)[1] for request in self.details]


@pytest.fixture
def enriched_setup(tmp_path, monkeypatch):
    monkeypatch.delenv("BADEM_NODE_ID", raising=False)
    monkeypatch.delenv("BADEM_NODE_PUBLIC_KEY", raising=False)
    monkeypatch.setenv("BADEM_DISCOVERY_PROVIDER", "google_places")
    monkeypatch.setenv("GOOGLE_PLACES_API_KEY", "test-only-placeholder")
    upstream = MockPlaces()
    monkeypatch.setattr(google_provider, "GooglePlacesClient",
                        lambda: GooglePlacesClient(transport=httpx.MockTransport(upstream)))
    db_path = tmp_path / "enrichment.db"
    with TestClient(create_app(str(db_path), "admin", "laser-01", "test-secret")) as client:
        request_id = create_request(client)
        specify(client, request_id)
        yield client, db_path, request_id, upstream


def run_discovery(setup):
    client, _, request_id, _ = setup
    response = discover(client, request_id)
    assert response.status_code == 200, response.text
    return response.json()


def candidate_detail(client, candidate):
    response = client.get(f"/api/partner-candidates/{candidate['candidate_id']}", headers=ADMIN)
    assert response.status_code == 200
    return response.json()


def test_details_endpoint_exact_mask_key_header_timeout_and_closed_client(monkeypatch):
    calls = []

    class Transport(httpx.MockTransport):
        closed = False

        def close(self):
            self.closed = True

    def handle(request):
        calls.append(request)
        assert request.method == "GET"
        assert str(request.url) == PLACE_DETAILS_URL + "test-place-1"
        assert request.url.query == b""
        assert request.content == b""
        assert request.headers["X-Goog-Api-Key"] == "test-only-placeholder"
        assert request.headers["X-Goog-FieldMask"] == "websiteUri,rating,userRatingCount,businessStatus"
        assert request.extensions["timeout"] == {
            kind: REQUEST_TIMEOUT_SECONDS for kind in ("connect", "read", "write", "pool")}
        return httpx.Response(200, json=DETAILS)

    monkeypatch.setenv("GOOGLE_PLACES_API_KEY", "test-only-placeholder")
    transport = Transport(handle)
    assert GooglePlacesClient(transport=transport).place_details("test-place-1") == DETAILS
    assert len(calls) == 1
    assert transport.closed


def test_enrichment_configuration_default_and_upper_bound():
    assert configured_enrichment_limit() == DEFAULT_ENRICH_TOP_N == 3
    assert MAX_ENRICH_TOP_N == 5


def test_mock_provider_ignores_unused_google_enrichment_configuration(monkeypatch):
    monkeypatch.setenv("BADEM_DISCOVERY_ENRICH_TOP_N", "invalid unused setting")
    provider = create_provider()
    assert provider.source == models.MOCK_SOURCE
    assert not hasattr(provider, "enrich")
    assert len(provider.discover(SPECIFICATION)) == 5


@pytest.mark.parametrize("value,expected", [("0", 0), ("1", 1), ("3", 3), ("5", 5)])
def test_enrichment_count_configuration(monkeypatch, value, expected):
    monkeypatch.setenv("BADEM_DISCOVERY_ENRICH_TOP_N", value)
    assert configured_enrichment_limit() == expected


@pytest.mark.parametrize("value", ["-1", "6", "100", "", "1.5", "private value"])
def test_unsafe_enrichment_count_is_a_sanitized_google_startup_error(monkeypatch, value):
    monkeypatch.setenv("BADEM_DISCOVERY_PROVIDER", "google_places")
    monkeypatch.setenv("GOOGLE_PLACES_API_KEY", "test-only-placeholder")
    monkeypatch.setenv("BADEM_DISCOVERY_ENRICH_TOP_N", value)
    with pytest.raises(DiscoveryConfigurationError, match="integer between 0 and 5") as error:
        google_provider.GooglePlacesDiscoveryProvider()
    assert "private value" not in str(error.value)


def test_raw_details_become_only_derived_boolean_and_category_evidence():
    evidence = derive_public_evidence({**DETAILS, "unrequestedPrivateField": "must-not-persist"})
    assert evidence == {"website_present": True, "rating_present": True,
                        "public_activity_signal_strength": "ESTABLISHED",
                        "business_operational_signal": "LISTED_OPERATIONAL"}
    assert public_activity_points(evidence) == 5
    assert "websiteUri" not in evidence
    assert "rating" not in evidence
    assert "userRatingCount" not in evidence
    assert "businessStatus" not in evidence


@pytest.mark.parametrize("payload,points", [
    ({}, 0), ({"websiteUri": "https://listing.invalid"}, 1), ({"businessStatus": "OPERATIONAL"}, 2),
    ({"rating": 5}, 0), ({"userRatingCount": 1000}, 0), ({"rating": 4, "userRatingCount": 0}, 0),
    ({"rating": 4, "userRatingCount": 1}, 1), ({"rating": 1, "userRatingCount": 9}, 1),
    ({"rating": 1, "userRatingCount": 10}, 2), ({"rating": 5, "userRatingCount": 10000}, 2),
    ({"businessStatus": "FUTURE_UNKNOWN_STATUS"}, 0),
])
def test_public_activity_credit_is_small_bounded_and_not_rating_quality(payload, points):
    evidence = derive_public_evidence(payload)
    assert public_activity_points(evidence) == points <= 5
    profile = public_profile("General Workshop")
    apply_enrichment(profile, evidence)
    score = score_profile(SPECIFICATION, profile)
    assert score.score_breakdown == {
        "process_match": 0, "material_signal": 0, "equipment_signal": 0,
        "business_specialization": 0, "location_suitability": 10, "public_activity_signal": points,
    }
    assert profile["confidence"] == "low"


@pytest.mark.parametrize("status", ["CLOSED_TEMPORARILY", "CLOSED_PERMANENTLY", "FUTURE_OPENING"])
def test_non_operational_listings_receive_no_activity_or_confidence_upgrade(status):
    evidence = derive_public_evidence({**DETAILS, "businessStatus": status})
    assert evidence["business_operational_signal"] == "LISTED_NON_OPERATIONAL"
    assert public_activity_points(evidence) == 0
    profile = public_profile("graver doo")
    before = score_profile(SPECIFICATION, profile)
    apply_enrichment(profile, evidence)
    after = score_profile(SPECIFICATION, profile)
    assert before.fit_score == after.fit_score
    assert profile["confidence"] == "low"
    assert "The listing is not operational; no public-activity credit is awarded." in after.reasoning


@pytest.mark.parametrize("payload", [{}, {field: None for field in DETAILS}, {"websiteUri": "", "businessStatus": ""}])
def test_missing_optional_details_are_valid_without_inventing_activity(payload):
    evidence = derive_public_evidence(payload)
    assert evidence["website_present"] is False
    assert evidence["rating_present"] is False
    assert evidence["business_operational_signal"] == "UNKNOWN"
    assert evidence["public_activity_signal_strength"] == "NONE"
    assert public_activity_points(evidence) == 0


@pytest.mark.parametrize("changes", [
    {"websiteUri": 23}, {"websiteUri": "not a URI"}, {"websiteUri": "javascript:alert(1)"},
    {"websiteUri": "https://[invalid"}, {"rating": True}, {"rating": "private upstream value"},
    {"rating": float("nan")}, {"rating": float("inf")}, {"rating": 0}, {"rating": 6},
    {"userRatingCount": -1}, {"userRatingCount": True}, {"userRatingCount": 2.5}, {"businessStatus": {}},
])
def test_malformed_optional_fields_are_sanitized_provider_errors(changes):
    with pytest.raises(DiscoveryProviderError, match="malformed detail fields") as error:
        derive_public_evidence({**DETAILS, **changes})
    assert "private upstream value" not in str(error.value)


@pytest.mark.parametrize("name,expected", [
    ("graver doo", "medium"), ("Penda lasersko graviranje", "medium"),
    ("Tenzor Laser", "low"), ("General Workshop", "low"), ("Wooding Studio", "low"),
    ("Lasersko se\u010denje Beograd", "low"),
])
def test_corroborated_public_confidence_never_upgrades_inferred_process_evidence(name, expected):
    profile = public_profile(name)
    capabilities = deepcopy(profile["inferred_capabilities"])
    before = score_profile(SPECIFICATION, profile)
    apply_enrichment(profile, derive_public_evidence(DETAILS))
    after = score_profile(SPECIFICATION, profile)
    assert after.confidence == expected
    assert profile["inferred_capabilities"] == capabilities
    assert after.fit_score == before.fit_score + 5
    assert all(after.score_breakdown[key] == before.score_breakdown[key]
               for key in WEIGHTS if key != "public_activity_signal")
    assert all(0 <= after.score_breakdown[key] <= maximum for key, maximum in WEIGHTS.items())
    assert after.fit_score <= 100


@pytest.mark.parametrize("field", ["websiteUri", "businessStatus", "rating", "userRatingCount"])
def test_confidence_corroboration_requires_all_coverage_fields(field):
    profile = public_profile("graver doo")
    details = {key: value for key, value in DETAILS.items() if key != field}
    apply_enrichment(profile, derive_public_evidence(details))
    assert score_profile(SPECIFICATION, profile).confidence == "low"


def test_default_top_three_are_selected_from_base_ranking_once_then_reranked(enriched_setup):
    client, db_path, request_id, upstream = enriched_setup
    upstream.detail_results["p-f"] = {**DETAILS, "unrequestedPrivateField": "raw-details-must-not-persist"}
    result = run_discovery(enriched_setup)
    assert len(upstream.searches) == 3
    assert upstream.detail_ids() == BASE_TOP_THREE
    assert len(set(upstream.detail_ids())) == 3
    assert len(result["candidates"]) == 8
    assert [candidate["fit_score"] for candidate in result["candidates"]][:3] == [85, 65, 45]
    for candidate in result["candidates"]:
        detail = candidate_detail(client, candidate)
        profile = detail["partner_profile"]
        assert candidate["verification_status"] == profile["verification_status"] == models.VERIFICATION_STATUS
        assert candidate["disclaimer"] == profile["disclaimer"] == models.DISCLAIMER
        if detail["source_place_id"] in BASE_TOP_THREE:
            assert profile["enrichment"]["status"] == "ENRICHED"
            assert profile["enrichment"]["signals"] == ["website_present", "operational_listing", "public_activity"]
            assert candidate["score_breakdown"]["public_activity_signal"] == 5
        else:
            assert "enrichment" not in profile
            assert candidate["score_breakdown"]["public_activity_signal"] == 0
        assert candidate["score_breakdown"]["equipment_signal"] == 0
        assert candidate["fit_score"] <= 100
        wording = json.dumps(detail).casefold()
        assert all(claim not in wording for claim in ("can perform", "has laser equipment", "supports plywood", "verified supplier"))
    calls = len(upstream.searches) + len(upstream.details)
    assert client.get(f"/api/manufacturing-requests/{request_id}/candidates", headers=ADMIN).json() == result
    assert len(upstream.searches) + len(upstream.details) == calls
    with sqlite3.connect(db_path) as connection:
        stored = " ".join(row[0] for row in connection.execute("SELECT profile_json FROM public_capacity_profiles"))
        assert all(raw not in stored for raw in (
            "websiteUri", "userRatingCount", "businessStatus", "listing.invalid", "must-not-persist", '"rating":', "4.7",
            "unrequestedPrivateField", "raw-details-must-not-persist"))
        assert connection.execute("SELECT COUNT(*) FROM partner_candidates").fetchone() == (8,)
        for table in ("jobs", "machine_events", "production_proofs", "proof_anchors"):
            assert connection.execute(f"SELECT COUNT(*) FROM {table}").fetchone() == (0,)


@pytest.mark.parametrize("count,expected", [(0, []), (1, ["p-f"]), (5, ["p-f", "p-d", "p-c", "p-e", "p-h"])])
def test_configured_limit_enriches_only_that_many_base_candidates(enriched_setup, monkeypatch, count, expected):
    client, db_path, _, upstream = enriched_setup
    monkeypatch.setenv("BADEM_DISCOVERY_ENRICH_TOP_N", str(count))
    with TestClient(create_app(str(db_path), "admin", "laser-01", "test-secret")) as configured:
        response = discover(configured, enriched_setup[2])
        assert response.status_code == 200
    assert upstream.detail_ids() == expected
    assert len(upstream.searches) == 3


def test_fewer_candidates_and_empty_search_do_not_spend_unused_detail_budget(enriched_setup):
    _, _, _, upstream = enriched_setup
    upstream.records = upstream.records[:1]
    assert len(run_discovery(enriched_setup)["candidates"]) == 1
    assert upstream.detail_ids() == ["p-a"]
    upstream.records = []
    assert run_discovery(enriched_setup)["candidates"] == []
    assert upstream.detail_ids() == ["p-a"]


@pytest.mark.parametrize("limit,expected_requests", [(99, 5), (-1, 0)])
def test_service_enforces_hard_budget_even_if_provider_limit_is_modified(enriched_setup, limit, expected_requests):
    _, db_path, request_id, upstream = enriched_setup
    provider = google_provider.GooglePlacesDiscoveryProvider(
        GooglePlacesClient(transport=httpx.MockTransport(upstream)))
    provider.enrich_top_n = limit
    service = DiscoveryService(lambda: connection_factory(db_path), provider=provider)
    assert service.discover(request_id)["status"] == "DISCOVERY_COMPLETE"
    assert len(upstream.details) == expected_requests


def test_repeated_enrichment_is_deterministic_and_only_rechecks_base_top_n(enriched_setup):
    _, _, _, upstream = enriched_setup
    before = run_discovery(enriched_setup)
    assert run_discovery(enriched_setup) == before
    assert upstream.detail_ids() == BASE_TOP_THREE * 2
    upstream.records = []
    assert run_discovery(enriched_setup)["candidates"] == []
    assert upstream.detail_ids() == BASE_TOP_THREE * 2


@pytest.mark.parametrize("failure", [
    httpx.ReadTimeout("test-only-placeholder secret upstream detail"),
    httpx.ConnectError("test-only-placeholder secret upstream detail"),
    httpx.Response(404, json={"error": "candidate disappeared"}),
    httpx.Response(429, json={"error": "private quota body"}),
    httpx.Response(500, json={"error": "private failure body"}),
    httpx.Response(200, content=b"invalid JSON private body"),
    None, [], {"unexpected": "shape"}, {"rating": "private malformed rating"},
])
def test_one_failed_enrichment_preserves_base_score_and_other_candidates(enriched_setup, failure):
    client, _, _, upstream = enriched_setup
    upstream.detail_results["p-f"] = failure
    result = run_discovery(enriched_setup)
    assert upstream.detail_ids() == BASE_TOP_THREE
    assert len(result["candidates"]) == 8
    failed = next(candidate for candidate in result["candidates"] if candidate["name"] == NAMES["p-f"])
    base = build_profile(normalize_place(listing("p-f", NAMES["p-f"])))
    score = score_profile(SPECIFICATION, base)
    assert failed["fit_score"] == score.fit_score
    assert failed["score_breakdown"] == score.score_breakdown
    assert failed["reasoning"] == score.reasoning
    assert failed["confidence"] == base["confidence"]
    assert candidate_detail(client, failed)["partner_profile"]["enrichment"] == {"status": "UNAVAILABLE", "signals": []}
    assert [candidate["fit_score"] for candidate in result["candidates"]][:3] == [80, 65, 45]
    assert "test-only-placeholder" not in json.dumps(result)


def test_missing_optional_detail_fields_succeed_without_score_or_confidence_change(enriched_setup):
    client, _, _, upstream = enriched_setup
    upstream.detail_results = {place_id: {} for place_id in BASE_TOP_THREE}
    result = run_discovery(enriched_setup)
    assert [candidate["fit_score"] for candidate in result["candidates"]][:3] == [80, 60, 40]
    for candidate in result["candidates"][:3]:
        profile = candidate_detail(client, candidate)["partner_profile"]
        assert profile["enrichment"]["status"] == "ENRICHED"
        assert profile["enrichment"]["signals"] == []
    assert result["candidates"][2]["confidence"] == "low"


@pytest.mark.parametrize("failure,status", [(httpx.ReadTimeout("private timeout"), 504), (503, 502)])
def test_base_discovery_failure_keeps_existing_errors_without_detail_requests(enriched_setup, failure, status):
    client, _, request_id, upstream = enriched_setup
    before = run_discovery(enriched_setup)
    detail_ids = upstream.detail_ids()
    upstream.search_failure = failure
    response = discover(client, request_id)
    assert response.status_code == status
    assert upstream.detail_ids() == detail_ids
    assert client.get(f"/api/manufacturing-requests/{request_id}/candidates", headers=ADMIN).json() == before


def test_enrichment_io_holds_no_sqlite_write_lock_and_detects_specification_change(enriched_setup):
    client, db_path, request_id, upstream = enriched_setup

    def change_specification(request):
        with sqlite3.connect(db_path, timeout=.1) as connection:
            connection.execute("UPDATE manufacturing_specifications SET payload_json=? WHERE request_id=?",
                               (json.dumps({"process": ["3d_printing"], "materials": ["pla"]}), request_id))
        return httpx.Response(200, json=DETAILS)

    upstream.detail_results["p-f"] = change_specification
    response = discover(client, request_id)
    assert response.status_code == 409
    assert "specification changed" in response.json()["detail"]
    with sqlite3.connect(db_path) as connection:
        assert connection.execute("SELECT COUNT(*) FROM partner_candidates").fetchone() == (0,)


@pytest.mark.parametrize("status", [301, 400, 403, 404, 429, 500])
def test_details_non_success_is_sanitized_and_not_retried_or_redirected(monkeypatch, status):
    calls = []

    def handle(request):
        calls.append(request)
        return httpx.Response(status, json={"error": "test-only-placeholder private body"},
                              headers={"Location": "https://never-fetch.invalid"})

    client = places_client(monkeypatch, handle)
    with pytest.raises(DiscoveryProviderError) as error:
        client.place_details("test-place-1")
    assert error.value.status_code == 502
    assert "test-only-placeholder" not in str(error.value)
    assert len(calls) == 1


@pytest.mark.parametrize("exception,error_type", [
    (httpx.ConnectTimeout, DiscoveryTimeoutError), (httpx.ReadTimeout, DiscoveryTimeoutError),
    (httpx.RemoteProtocolError, DiscoveryProviderError),
])
def test_details_transport_errors_are_sanitized(monkeypatch, exception, error_type):
    def handle(request):
        raise exception("test-only-placeholder private body", request=request)

    client = places_client(monkeypatch, handle)
    with pytest.raises(error_type) as error:
        client.place_details("test-place-1")
    assert "test-only-placeholder" not in str(error.value)


@pytest.mark.parametrize("place_id", ["../escape", "id/extra", "id?query=key", "", "id with spaces"])
def test_invalid_details_ids_never_make_http_requests(monkeypatch, place_id):
    def forbidden(request):
        pytest.fail("Invalid Place IDs must not make requests")

    client = places_client(monkeypatch, forbidden)
    with pytest.raises(DiscoveryProviderError, match="invalid Google Place ID"):
        client.place_details(place_id)
