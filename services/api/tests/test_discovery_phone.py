"""Offline phone enrichment: bounded Details only, one normalized public value."""

from copy import deepcopy
import json
import sqlite3

import httpx
import pytest
from fastapi.testclient import TestClient

from backend.app import create_app
from backend.discovery.enrichment import apply_enrichment, derive_public_evidence, normalize_public_phone
from backend.discovery.places_client import DETAILS_FIELD_MASK, FIELD_MASK, GEO_FIELD_MASK, LOCATION_FIELD_MASK
from backend.discovery.scorer import score_profile
from test_discovery import ADMIN, SPECIFICATION, discover
from test_discovery_enrichment import BASE_TOP_THREE, DETAILS, candidate_detail, enriched_setup, run_discovery
from test_discovery_signals import public_profile
from test_google_discovery import listing, places_client


INTERNATIONAL = "+1 (202) 555-0123"
NATIONAL = "(202) 555-0199"
NORMALIZED_INTERNATIONAL = "+12025550123"
NORMALIZED_NATIONAL = "2025550199"
PHONE_DETAILS = {**DETAILS, "internationalPhoneNumber": INTERNATIONAL, "nationalPhoneNumber": NATIONAL,
                 "unrequestedPrivateField": "raw-phone-response-must-not-persist"}


@pytest.mark.parametrize("value,expected", [
    (INTERNATIONAL, NORMALIZED_INTERNATIONAL), (NATIONAL, NORMALIZED_NATIONAL),
    (" 011 / 123-4567 ", "0111234567"), ("+381\u00a011\u00a0123 4567", "+381111234567"),
    ("\uff0b\uff11 (202) 555-0123", NORMALIZED_INTERNATIONAL),
    (None, None), ("", None), ("  ", None), (12345678, None), (True, None), ({}, None),
    ("+1 202 555 0123 ext. 9", None), ("+1 202 555 0123\r\nprivate", None),
    ("tel:+12025550123", None), ("+12+34567890", None), ("12", None), ("1" * 16, None), (" " * 81, None),
])
def test_public_phone_normalization_preserves_prefix_and_does_not_guess_country(value, expected):
    assert normalize_public_phone(value) == expected


@pytest.mark.parametrize("international,national,expected", [
    (INTERNATIONAL, NATIONAL, NORMALIZED_INTERNATIONAL),
    (None, NATIONAL, NORMALIZED_NATIONAL), ("", NATIONAL, NORMALIZED_NATIONAL),
    ("unusable", NATIONAL, NORMALIZED_NATIONAL), (123, NATIONAL, NORMALIZED_NATIONAL),
    (INTERNATIONAL, None, NORMALIZED_INTERNATIONAL), (None, None, None), ("", "invalid", None),
])
def test_prefer_usable_international_phone_then_national_without_retaining_both(international, national, expected):
    evidence = derive_public_evidence({"internationalPhoneNumber": international, "nationalPhoneNumber": national})
    assert evidence.get("phone") == expected
    assert "internationalPhoneNumber" not in evidence
    assert "nationalPhoneNumber" not in evidence
    profile = public_profile("Penda lasersko graviranje")
    before = deepcopy(evidence)
    apply_enrichment(profile, evidence)
    assert evidence == before
    assert profile.get("phone") == expected
    assert "phone" not in profile["enrichment"]["public_evidence"]
    assert profile["enrichment"]["signals"] == []


def test_phone_fields_are_only_in_bounded_details_mask_and_phone_only_details_are_valid(monkeypatch):
    assert set(DETAILS_FIELD_MASK.split(",")) == {
        "websiteUri", "rating", "userRatingCount", "businessStatus", "nationalPhoneNumber", "internationalPhoneNumber",
    }
    for mask in (FIELD_MASK, GEO_FIELD_MASK, LOCATION_FIELD_MASK):
        assert "PhoneNumber" not in mask
    calls = []

    def handle(request):
        calls.append(request)
        assert request.method == "GET"
        assert request.headers["X-Goog-FieldMask"] == DETAILS_FIELD_MASK
        return httpx.Response(200, json={"internationalPhoneNumber": INTERNATIONAL})

    details = places_client(monkeypatch, handle).place_details("phone-only")
    assert derive_public_evidence(details)["phone"] == NORMALIZED_INTERNATIONAL
    assert len(calls) == 1


def test_phone_does_not_change_fit_scores_confidence_reasoning_or_activity_signals():
    without_phone = public_profile("graver doo")
    with_phone = deepcopy(without_phone)
    apply_enrichment(without_phone, derive_public_evidence(DETAILS))
    apply_enrichment(with_phone, derive_public_evidence(PHONE_DETAILS))
    assert score_profile(SPECIFICATION, with_phone) == score_profile(SPECIFICATION, without_phone)
    assert with_phone["signals"] == without_phone["signals"]
    assert with_phone["enrichment"] == without_phone["enrichment"]
    assert with_phone["inferred_capabilities"] == without_phone["inferred_capabilities"]


@pytest.mark.parametrize("limit,expected_ids", [(0, []), (1, ["p-f"]), (3, BASE_TOP_THREE),
    (5, ["p-f", "p-d", "p-c", "p-e", "p-h"])])
def test_api_persists_only_normalized_phone_for_the_existing_bounded_top_n(enriched_setup, monkeypatch, limit, expected_ids):
    client, db_path, request_id, upstream = enriched_setup
    # Unexpected fields in broad search responses must not bypass the Details budget.
    for place in upstream.records:
        place.update({"internationalPhoneNumber": "+1 202 555 0999", "nationalPhoneNumber": "2025550999"})
    upstream.detail_results = {place["id"]: PHONE_DETAILS for place in upstream.records}
    monkeypatch.setenv("BADEM_DISCOVERY_ENRICH_TOP_N", str(limit))
    with TestClient(create_app(str(db_path), "admin", "laser-01", "test-secret")) as configured:
        response = discover(configured, request_id)
        assert response.status_code == 200
        result = response.json()
    assert len(upstream.searches) == 3
    assert upstream.detail_ids() == expected_ids
    assert all("PhoneNumber" not in request.headers["X-Goog-FieldMask"] for request in upstream.searches)
    assert all(request.headers["X-Goog-FieldMask"] == DETAILS_FIELD_MASK for request in upstream.details)
    for candidate in result["candidates"]:
        detail = candidate_detail(client, candidate)
        expected = NORMALIZED_INTERNATIONAL if detail["source_place_id"] in expected_ids else None
        assert candidate["phone"] == detail["phone"] == detail["partner_profile"].get("phone") == expected
        assert "phone" not in detail["partner_profile"].get("enrichment", {}).get("public_evidence", {})
        assert detail["verification_status"] == "PUBLIC_DATA_ONLY"
    before_calls = len(upstream.searches) + len(upstream.details)
    with TestClient(create_app(str(db_path), "admin", "laser-01", "test-secret")) as restarted:
        assert restarted.get(f"/api/manufacturing-requests/{request_id}/candidates", headers=ADMIN).json() == result
    assert len(upstream.searches) + len(upstream.details) == before_calls
    with sqlite3.connect(db_path) as connection:
        stored = [row[0] for row in connection.execute("SELECT profile_json FROM public_capacity_profiles")]
    assert sum(json.loads(row).get("phone") == NORMALIZED_INTERNATIONAL for row in stored) == len(expected_ids)
    encoded = " ".join(stored) + json.dumps(result)
    assert all(raw not in encoded for raw in ("internationalPhoneNumber", "nationalPhoneNumber", INTERNATIONAL,
        NATIONAL, NORMALIZED_NATIONAL, "2025550999", "unrequestedPrivateField", "raw-phone-response-must-not-persist"))


def test_national_fallback_and_legacy_missing_phone_in_api(enriched_setup):
    client, _, _, upstream = enriched_setup
    upstream.records = [listing("fallback", "Penda lasersko graviranje"), listing("no-phone", "Wooding Studio")]
    upstream.detail_results = {"fallback": {"nationalPhoneNumber": NATIONAL}, "no-phone": {}}
    result = run_discovery(enriched_setup)
    by_id = {candidate_detail(client, candidate)["source_place_id"]: candidate for candidate in result["candidates"]}
    assert by_id["fallback"]["phone"] == NORMALIZED_NATIONAL
    assert by_id["fallback"]["score_breakdown"]["public_activity_signal"] == 0
    assert by_id["no-phone"]["phone"] is None


@pytest.mark.parametrize("refresh", ["missing", "failure", "disabled"])
def test_rediscovery_does_not_retain_stale_phone_when_details_no_longer_supply_it(enriched_setup, monkeypatch, refresh):
    client, db_path, request_id, upstream = enriched_setup
    upstream.records = [listing("p-f", "Penda lasersko graviranje")]
    upstream.detail_results["p-f"] = PHONE_DETAILS
    previous = run_discovery(enriched_setup)["candidates"][0]
    assert previous["phone"] == NORMALIZED_INTERNATIONAL
    upstream.detail_results["p-f"] = httpx.Response(503) if refresh == "failure" else DETAILS
    if refresh == "disabled":
        monkeypatch.setenv("BADEM_DISCOVERY_ENRICH_TOP_N", "0")
    with TestClient(create_app(str(db_path), "admin", "laser-01", "test-secret")) as configured:
        response = discover(configured, request_id)
        assert response.status_code == 200
    current = response.json()["candidates"][0]
    assert current["candidate_id"] == previous["candidate_id"]
    assert current["phone"] is None
    detail = candidate_detail(client, current)
    assert detail["phone"] is None
    assert "phone" not in detail["partner_profile"]
    if refresh == "failure":
        assert detail["partner_profile"]["enrichment"] == {"status": "UNAVAILABLE", "signals": []}
    with sqlite3.connect(db_path) as connection:
        assert "phone" not in json.loads(connection.execute("SELECT profile_json FROM public_capacity_profiles").fetchone()[0])
