"""Public qualification fields cross existing bounded normalization/storage/API paths only."""

from copy import deepcopy
import json
import sqlite3

import httpx
import pytest
from fastapi.testclient import TestClient

from backend.app import create_app
from backend.discovery.enrichment import (
    PUBLIC_DETAIL_FIELDS, apply_enrichment, derive_public_evidence, normalize_public_website,
)
from backend.discovery.google_provider import normalize_place, public_address
from backend.discovery.places_client import DETAILS_FIELD_MASK, FIELD_MASK, GEO_FIELD_MASK
from backend.discovery.profile_builder import build_profile
from backend.discovery.scorer import score_profile
from test_discovery import ADMIN, SPECIFICATION, discover, specify
from test_discovery_enrichment import BASE_TOP_THREE, DETAILS, candidate_detail, enriched_setup, run_discovery
from test_discovery_geo import GEO_SPEC, geo_place
from test_discovery_phone import INTERNATIONAL, NATIONAL, NORMALIZED_INTERNATIONAL, NORMALIZED_NATIONAL
from test_discovery_signals import public_profile
from test_google_discovery import listing


PUBLIC_FIELDS = (*PUBLIC_DETAIL_FIELDS, "address", "distance_km")
CONTACT_DETAILS = {**DETAILS, "internationalPhoneNumber": INTERNATIONAL, "nationalPhoneNumber": NATIONAL,
                   "unrequestedPrivateField": {"sentinel": "never-retain-raw-google-payload"}}
ADDRESS_PARTS = [{"longText": "12", "types": ["street_number"]},
                 {"longText": " Workshop  Road ", "types": ["route"]},
                 {"longText": "Belgrade", "types": ["locality", "political"]},
                 {"longText": "11000", "types": ["postal_code"]},
                 {"longText": "Serbia", "shortText": "RS", "types": ["country", "political"]}]
ADDRESS = "12, Workshop Road, Belgrade, 11000, Serbia"


def test_address_uses_existing_structured_parts_without_search_text_or_capability_inference():
    place = listing()
    place["addressComponents"] = deepcopy(ADDRESS_PARTS)
    place["formattedAddress"] = "Unrequested formatted address must not be used"
    partner = normalize_place(place)
    assert partner.address == ADDRESS
    profile = build_profile(partner)
    assert profile["address"] == ADDRESS
    before = build_profile(normalize_place(listing()))
    assert profile["signals"] == before["signals"]
    assert score_profile(SPECIFICATION, profile) == score_profile(SPECIFICATION, before)
    place = listing(name="General Workshop")
    place["addressComponents"] = [{"longText": "Laser engraving CNC wood Road", "types": ["route"]}]
    profile = build_profile(normalize_place(place))
    assert profile["inferred_capabilities"] == []
    assert score_profile(SPECIFICATION, profile).score_breakdown["process_match"] == 0
    assert public_address([{"shortText": "Public premise", "types": ["premise"]}]) == "Public premise"


@pytest.mark.parametrize("parts", [None, {}, "Not structured", [], [None, {}],
    [{"longText": "City only", "types": ["locality"]}],
    [{"longText": "123", "types": ["street_number"]}],
    [{"longText": "x" * 241, "types": ["route"]}],
    [{"longText": 123, "types": ["route"]}],
    [{"longText": "Invalid\x00street", "types": ["route"]}],
    [{"longText": "Not an address", "types": [None, {}]}],
])
def test_missing_malformed_or_locality_only_address_does_not_fabricate_a_street(parts):
    assert public_address(parts) is None


@pytest.mark.parametrize("value,expected", [
    (" HTTPS://workshop.example/contact?ref=public ", "https://workshop.example/contact?ref=public"),
    ("http://workshop.example:8080/", "http://workshop.example:8080/"),
    (None, None), (True, None), ("", None), ("//workshop.example", None),
    ("javascript:alert(1)", None), ("data:text/html,unsafe", None), ("file:///private", None),
    ("ftp://workshop.example", None), ("https:///workshop.example", None),
    ("https://user:password@workshop.example", None), ("https://workshop.example:invalid", None),
    ("https://work shop.example", None), ("https://.", None),
    ("https://workshop.example\\@other.example", None), ("https://workshop.example\n", None),
    ("https://workshop.example/" + "x" * 2048, None),
])
def test_normalized_public_website_is_a_safe_contact_destination(value, expected):
    assert normalize_public_website(value) == expected


@pytest.mark.parametrize("limit", [0, 1, 3, 5])
def test_qualification_values_survive_normalization_storage_list_profile_and_restart(enriched_setup, monkeypatch, limit):
    client, db_path, request_id, upstream = enriched_setup
    for place in upstream.records:
        place["addressComponents"] = deepcopy(ADDRESS_PARTS)
        # Broad response extras cannot bypass bounded contact/activity enrichment.
        place.update({"websiteUri": "https://never-use-broad.example", "rating": 1.1, "userRatingCount": 999,
                      "businessStatus": "CLOSED_PERMANENTLY", "internationalPhoneNumber": "+12025550999"})
        upstream.detail_results[place["id"]] = CONTACT_DETAILS
    monkeypatch.setenv("BADEM_DISCOVERY_ENRICH_TOP_N", str(limit))
    with TestClient(create_app(str(db_path), "admin", "laser-01", "test-secret")) as configured:
        response = discover(configured, request_id)
        assert response.status_code == 200, response.text
    result = response.json()
    enriched_ids = upstream.detail_ids()
    assert len(enriched_ids) == limit
    assert len(upstream.searches) == 3
    assert FIELD_MASK == "places.id,places.displayName,places.addressComponents,places.primaryType,places.types"
    assert DETAILS_FIELD_MASK == "websiteUri,rating,userRatingCount,businessStatus,nationalPhoneNumber,internationalPhoneNumber"
    assert all(request.headers["X-Goog-FieldMask"] == FIELD_MASK for request in upstream.searches)
    for candidate in result["candidates"]:
        detail = candidate_detail(client, candidate)
        expected = {"website": DETAILS["websiteUri"], "phone": NORMALIZED_INTERNATIONAL,
                    "rating": 4.7, "review_count": 83, "business_status": "OPERATIONAL"}
        expected = {key: value if detail["source_place_id"] in enriched_ids else None for key, value in expected.items()}
        expected.update({"address": ADDRESS, "distance_km": None})
        assert {field: candidate[field] for field in PUBLIC_FIELDS} == expected
        assert {field: detail[field] for field in PUBLIC_FIELDS} == expected
        assert {field: detail["partner_profile"].get(field) for field in PUBLIC_FIELDS} == expected
        assert detail["verification_status"] == "PUBLIC_DATA_ONLY"
        assert detail["disclaimer"] == "Potential fit based on public data. Production capability has not been verified."
        assert all(field not in detail["partner_profile"].get("enrichment", {}).get("public_evidence", {})
                   for field in PUBLIC_FIELDS)
    with sqlite3.connect(db_path) as connection:
        stored = [json.loads(row[0]) for row in connection.execute("SELECT profile_json FROM public_capacity_profiles")]
        schema = connection.execute("SELECT name,sql FROM sqlite_master ORDER BY name").fetchall()
    assert sum(profile.get("website") == DETAILS["websiteUri"] for profile in stored) == limit
    assert all(profile["address"] == ADDRESS for profile in stored)
    encoded = json.dumps(stored) + json.dumps(result)
    assert all(raw not in encoded for raw in ("websiteUri", "businessStatus", "userRatingCount", "addressComponents",
        "internationalPhoneNumber", "nationalPhoneNumber", INTERNATIONAL, NATIONAL, "never-use-broad.example",
        "+12025550999", "unrequestedPrivateField", "never-retain-raw-google-payload"))
    counts = len(upstream.searches), len(upstream.details)
    with TestClient(create_app(str(db_path), "admin", "laser-01", "test-secret")) as restarted:
        assert restarted.get(f"/api/manufacturing-requests/{request_id}/candidates", headers=ADMIN).json() == result
        for candidate in result["candidates"]:
            assert candidate_detail(restarted, candidate)["website"] == candidate["website"]
    assert (len(upstream.searches), len(upstream.details)) == counts
    with sqlite3.connect(db_path) as connection:
        assert connection.execute("SELECT name,sql FROM sqlite_master ORDER BY name").fetchall() == schema


@pytest.mark.parametrize("details", [{}, {key: None for key in CONTACT_DETAILS},
    {"websiteUri": "", "businessStatus": "", "internationalPhoneNumber": "", "nationalPhoneNumber": ""}])
def test_missing_qualification_values_are_null_safe_in_list_and_detail(enriched_setup, details):
    client, _, _, upstream = enriched_setup
    upstream.detail_results = {place["id"]: details for place in upstream.records}
    result = run_discovery(enriched_setup)
    for candidate in result["candidates"]:
        assert all(candidate[field] is None for field in PUBLIC_FIELDS)
        detail = candidate_detail(client, candidate)
        assert all(detail[field] is None for field in PUBLIC_FIELDS)
    assert len(upstream.searches) == 3
    assert upstream.detail_ids() == BASE_TOP_THREE


def test_legacy_snapshots_stay_unchanged_and_get_explicit_null_api_fields(enriched_setup):
    client, db_path, request_id, upstream = enriched_setup
    result = run_discovery(enriched_setup)
    with sqlite3.connect(db_path) as connection:
        for candidate_id, encoded in connection.execute("SELECT candidate_id,profile_json FROM public_capacity_profiles").fetchall():
            profile = json.loads(encoded)
            for field in PUBLIC_FIELDS:
                profile.pop(field, None)
            connection.execute("UPDATE public_capacity_profiles SET profile_json=? WHERE candidate_id=?",
                               (json.dumps(profile), candidate_id))
        snapshot = connection.execute("SELECT * FROM public_capacity_profiles ORDER BY id").fetchall()
    counts = len(upstream.searches), len(upstream.details)
    with TestClient(create_app(str(db_path), "admin", "laser-01", "test-secret")) as restarted:
        read = restarted.get(f"/api/manufacturing-requests/{request_id}/candidates", headers=ADMIN).json()
        assert [c["candidate_id"] for c in read["candidates"]] == [c["candidate_id"] for c in result["candidates"]]
        for candidate in read["candidates"]:
            assert all(candidate[field] is None for field in PUBLIC_FIELDS)
            detail = candidate_detail(restarted, candidate)
            assert all(detail[field] is None for field in PUBLIC_FIELDS)
            assert all(field not in detail["partner_profile"] for field in PUBLIC_FIELDS)
    with sqlite3.connect(db_path) as connection:
        assert connection.execute("SELECT * FROM public_capacity_profiles ORDER BY id").fetchall() == snapshot
    assert (len(upstream.searches), len(upstream.details)) == counts


def test_display_values_do_not_change_existing_scoring_confidence_evidence_or_order(enriched_setup):
    _, _, _, upstream = enriched_setup
    before = run_discovery(enriched_setup)
    changed_details = {**CONTACT_DETAILS, "rating": 1.1, "userRatingCount": 10000,
                       "websiteUri": "https://another-public-workshop.example/contact"}
    upstream.detail_results = {place["id"]: changed_details for place in upstream.records}
    after = run_discovery(enriched_setup)
    assert [{key: value for key, value in candidate.items() if key not in PUBLIC_FIELDS} for candidate in after["candidates"]] == [
        {key: value for key, value in candidate.items() if key not in PUBLIC_FIELDS} for candidate in before["candidates"]]
    profile = public_profile("Penda lasersko graviranje")
    apply_enrichment(profile, derive_public_evidence(changed_details))
    without_display_fields = {key: value for key, value in profile.items() if key not in PUBLIC_FIELDS}
    assert score_profile(SPECIFICATION, profile) == score_profile(SPECIFICATION, without_display_fields)
    assert profile["inferred_capabilities"] == without_display_fields["inferred_capabilities"]
    assert upstream.detail_ids() == BASE_TOP_THREE * 2
    assert len(upstream.searches) == 6


@pytest.mark.parametrize("refresh", ["missing", "failure", "disabled"])
def test_rediscovery_clears_missing_details_without_losing_public_address(enriched_setup, monkeypatch, refresh):
    client, db_path, request_id, upstream = enriched_setup
    upstream.records = [listing("one", "Penda lasersko graviranje")]
    upstream.records[0]["addressComponents"] = deepcopy(ADDRESS_PARTS)
    upstream.detail_results["one"] = CONTACT_DETAILS
    before = run_discovery(enriched_setup)["candidates"][0]
    assert before["website"] and before["phone"]
    upstream.detail_results["one"] = httpx.Response(503) if refresh == "failure" else {}
    monkeypatch.setenv("BADEM_DISCOVERY_ENRICH_TOP_N", "0" if refresh == "disabled" else "3")
    with TestClient(create_app(str(db_path), "admin", "laser-01", "test-secret")) as configured:
        response = discover(configured, request_id)
    assert response.status_code == 200
    candidate = response.json()["candidates"][0]
    assert candidate["candidate_id"] == before["candidate_id"]
    assert all(candidate[field] is None for field in PUBLIC_DETAIL_FIELDS)
    detail = candidate_detail(client, candidate)
    assert detail["address"] == candidate["address"] == ADDRESS
    assert all(detail["partner_profile"].get(field) is None for field in PUBLIC_DETAIL_FIELDS)


def test_geo_distance_and_phone_fallback_are_exposed_alongside_qualification_without_extra_calls(enriched_setup):
    client, _, request_id, upstream = enriched_setup
    upstream.records = [geo_place(f"near-{index}", index + 1) for index in range(5)]
    for place in upstream.records:
        upstream.detail_results[place["id"]] = {**DETAILS, "nationalPhoneNumber": NATIONAL}
    assert specify(client, request_id, GEO_SPEC).status_code == 200
    result = run_discovery(enriched_setup)
    assert len(upstream.searches) == 3
    assert len(upstream.details) == 3
    assert all(request.headers["X-Goog-FieldMask"] == GEO_FIELD_MASK for request in upstream.searches)
    assert [candidate["distance_km"] for candidate in result["candidates"]] == [1, 2, 3, 4, 5]
    for candidate in result["candidates"]:
        detail = candidate_detail(client, candidate)
        assert detail["distance_km"] == candidate["distance_km"]
        expected_phone = NORMALIZED_NATIONAL if candidate["distance_km"] <= 3 else None
        assert candidate["phone"] == detail["phone"] == expected_phone
