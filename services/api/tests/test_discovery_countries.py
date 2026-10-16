"""Explicit country relevance stays textual, bounded and based on Google addresses."""

from copy import deepcopy
import json
import sqlite3

import httpx
import pytest

from backend.discovery.countries import REGION_CODES, region_code
from backend.discovery.google_provider import GooglePlacesDiscoveryProvider, matches_country
from backend.discovery.places_client import FIELD_MASK
from test_discovery import ADMIN, SPECIFICATION, create_request, discover, specify
from test_discovery_enrichment import enriched_setup
from test_google_discovery import google_setup, listing, places_client


@pytest.mark.parametrize("country,expected", [
    ("RS", "RS"), (" rs ", "RS"), ("US", "US"), ("de", "DE"), ("GB", "GB"),
    ("JP", "JP"), ("XK", "XK"), ("AC", "AC"),
    (None, None), ("", None), ("  ", None), ("ZZ", None), ("XX", None), ("UK", None),
    ("EU", None), ("UN", None), ("YU", None), ("USA", None), ("001", None),
    ("R S", None), ("RS,US", None), ("Serbia", None), (17, None),
])
def test_only_supported_two_letter_regions_enter_text_search(monkeypatch, country, expected):
    assert region_code(country) == expected
    calls = []

    def handle(request):
        calls.append(request)
        body = json.loads(request.content)
        assert body == {"textQuery": "laser engraving Bor", "pageSize": 5, "languageCode": "en",
                        **({"regionCode": expected} if expected else {})}
        assert request.headers["X-Goog-FieldMask"] == FIELD_MASK
        return httpx.Response(200, json={})

    assert places_client(monkeypatch, handle).text_search("laser engraving Bor", region_code=country) == []
    assert len(calls) == 1


def test_region_registry_excludes_unknown_and_non_country_regions():
    assert all(len(code) == 2 and code.isascii() and code.isalpha() and code.isupper() for code in REGION_CODES)
    assert {"RS", "US", "GB", "DE", "FR", "CN", "BR", "AU", "ZA"} <= REGION_CODES
    assert not REGION_CODES & {"ZZ", "XX", "UK", "EU", "UN", "QO", "001", "YU"}


@pytest.mark.parametrize("country,expected_region", [("RS", "RS"), (" rs ", "RS"), ("Serbia", None)])
def test_bor_serbia_excludes_foreign_and_unknown_countries_before_persisting(google_setup, country, expected_region):
    client, db_path, payload, calls = google_setup
    payload["places"] = [
        listing("us", city="Bor", country="US"),
        listing("rs-bor", city="Bor"),
        listing("rs-other-city", city="Belgrade"),
        {"id": "no-country", "displayName": {"text": "Laser Engraving Wood Studio"}},
    ]
    request_id = create_request(client)
    assert specify(client, request_id, {**SPECIFICATION, "location": {"city": "Bor", "country": country}}).status_code == 201
    response = discover(client, request_id)
    assert response.status_code == 200
    result = response.json()
    assert len(result["candidates"]) == 2
    details = [client.get(f"/api/partner-candidates/{row['candidate_id']}", headers=ADMIN).json()
               for row in result["candidates"]]
    assert [row["source_place_id"] for row in details] == ["rs-bor", "rs-other-city"]
    assert [row["score_breakdown"]["location_suitability"] for row in details] == [10, 5]
    assert all(row["partner_profile"]["location"]["country"] == "RS" for row in details)
    assert all(row["verification_status"] == "PUBLIC_DATA_ONLY" for row in details)
    assert client.get(f"/api/manufacturing-requests/{request_id}/candidates", headers=ADMIN).json() == result
    assert len(calls) == 3
    for request in calls:
        body = json.loads(request.content)
        assert body["textQuery"].endswith("Bor Serbia")
        assert body.get("regionCode") == expected_region
        assert set(body) == {"textQuery", "pageSize", "languageCode"} | ({"regionCode"} if expected_region else set())
    with sqlite3.connect(db_path) as connection:
        assert {row[0] for row in connection.execute("SELECT source_place_id FROM partner_candidates")} == {"rs-bor", "rs-other-city"}


@pytest.mark.parametrize("location", [None, {}, {"city": "Bor"}, {"city": "Bor", "country": None},
                                      {"city": "Bor", "country": ""}, {"city": "Bor", "country": "  "}])
def test_no_country_preserves_unfiltered_results_and_omits_region(monkeypatch, location):
    calls = []
    places = [listing("rs", city="Bor"), listing("us", city="Bor", country="US"), {"id": "unknown"}]

    def handle(request):
        calls.append(request)
        body = json.loads(request.content)
        assert set(body) == {"textQuery", "pageSize", "languageCode"}
        assert "Serbia" not in body["textQuery"]
        assert "RS" not in body["textQuery"]
        if location and location.get("city"):
            assert body["textQuery"].endswith(" Bor")
        return httpx.Response(200, json={"places": places})

    provider = GooglePlacesDiscoveryProvider(places_client(monkeypatch, handle))
    result = provider.discover({**SPECIFICATION, "location": location})
    assert [row.source_place_id for row in result] == ["rs", "us", "unknown"]
    assert [row.country for row in result] == ["RS", "US", ""]
    assert len(calls) == 3


@pytest.mark.parametrize("components,accepted", [
    (None, False), ([], False), ([None, {}], False),
    ([{"types": "country", "shortText": "RS"}], False),
    ([{"types": ["locality"], "longText": "Serbia"}], False),
    ([{"types": ["country"], "shortText": " rs "}], True),
    ([{"types": ["country"], "longText": "Serbia"}], True),
    ([{"types": ["country"], "shortText": "US", "longText": "Serbia"}], False),
    ([{"types": ["country"], "shortText": "RS"}, {"types": ["country"], "shortText": "US"}], False),
])
def test_country_match_uses_structured_address_not_query_name_or_formatted_address(components, accepted):
    place = {"id": "public-listing", "displayName": {"text": "Bor Serbia RS Laser Engraving"},
             "formattedAddress": "Bor, Serbia", "addressComponents": components}
    assert matches_country(place, "RS") is accepted
    assert matches_country(place, "Serbia") is accepted
    assert matches_country(place, "") is True


def test_full_country_names_can_match_returned_long_name_without_geocoding():
    place = listing("de", country="DE")
    place["addressComponents"][-1]["longText"] = "Germany"
    assert matches_country(place, "Germany")
    assert not matches_country(place, "RS")
    assert not matches_country(place, "Serbia")


def test_no_country_api_persists_foreign_and_unknown_locations_without_inference(google_setup):
    client, db_path, payload, calls = google_setup
    payload["places"] = [listing("rs", city="Bor"), listing("us", city="Bor", country="US"), {"id": "unknown"}]
    request_id = create_request(client)
    assert specify(client, request_id, {**SPECIFICATION, "location": {"city": "Bor"}}).status_code == 201
    response = discover(client, request_id)
    assert response.status_code == 200
    candidates = response.json()["candidates"]
    assert len(candidates) == 3
    details = [client.get(f"/api/partner-candidates/{row['candidate_id']}", headers=ADMIN).json()
               for row in candidates]
    assert [row["partner_profile"]["location"]["country"] for row in details] == ["RS", "US", ""]
    assert [row["score_breakdown"]["location_suitability"] for row in details] == [10, 10, 0]
    assert all("regionCode" not in json.loads(call.content) for call in calls)
    with sqlite3.connect(db_path) as connection:
        assert connection.execute("SELECT COUNT(*) FROM partner_candidates").fetchone() == (3,)


def test_filtered_foreign_duplicates_do_not_consume_the_ten_candidate_budget(monkeypatch):
    calls = []

    def handle(request):
        calls.append(request)
        body = json.loads(request.content)
        assert body["regionCode"] == "RS"
        assert body["pageSize"] == 5
        index = len(calls)
        # The second query has the same IDs as the first, now with relevant addresses.
        offset = 5 if index == 3 else 0
        return httpx.Response(200, json={"places": [listing(f"p-{offset + n}", city="Bor",
            country="US" if index == 1 else "RS") for n in range(5)], "nextPageToken": "never-follow"})

    result = GooglePlacesDiscoveryProvider(places_client(monkeypatch, handle)).discover(
        {**SPECIFICATION, "location": {"city": "Bor", "country": "RS"}})
    assert len(calls) == 3
    assert len(result) == 10
    assert all(partner.country == "RS" for partner in result)
    assert [partner.source_place_id for partner in result] == [f"p-{n}" for n in range(10)]


def test_foreign_and_unknown_candidates_are_never_enriched(enriched_setup):
    client, db_path, request_id, upstream = enriched_setup
    upstream.records = [listing("us", city="Bor", country="US"), listing("rs", city="Bor"), {"id": "no-country"}]
    assert specify(client, request_id, {**SPECIFICATION, "location": {"city": "Bor", "country": "RS"}}).status_code == 200
    result = discover(client, request_id).json()
    assert len(result["candidates"]) == 1
    assert upstream.detail_ids() == ["rs"]
    with sqlite3.connect(db_path) as connection:
        assert connection.execute("SELECT source_place_id FROM partner_candidates").fetchall() == [("rs",)]
    # No local match is a real empty result, not stale rankings or a foreign fallback.
    upstream.records = [listing("us", city="Bor", country="US")]
    upstream.searches.clear()
    upstream.details.clear()
    result = discover(client, request_id).json()
    assert result["candidates"] == []
    assert len(upstream.searches) == 3
    assert upstream.details == []
    with sqlite3.connect(db_path) as connection:
        assert connection.execute("SELECT COUNT(*) FROM partner_candidates").fetchone() == (0,)
        assert connection.execute("SELECT COUNT(*) FROM public_capacity_profiles").fetchone() == (0,)


def test_explicit_country_never_changes_the_stored_specification(google_setup):
    client, _, _, _ = google_setup
    request_id = create_request(client)
    specification = deepcopy(SPECIFICATION)
    specification["location"] = {"city": "Bor", "country": "RS"}
    assert specify(client, request_id, specification).status_code == 201
    assert discover(client, request_id).status_code == 200
    stored = client.get(f"/api/manufacturing-requests/{request_id}/specification", headers=ADMIN).json()["payload"]
    assert stored == specification
