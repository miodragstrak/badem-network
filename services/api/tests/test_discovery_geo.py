"""Offline Geo Discovery contracts: bounded search, derived distance and owner isolation."""

from copy import deepcopy
import json
import math
import sqlite3

import httpx
import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from backend.app import create_app
from backend.discovery.geo import EARTH_RADIUS_KM, SEARCH_RADII_KM, coordinates, ranking_key, search_rectangle, straight_line_km
from backend.discovery.google_provider import MAX_CANDIDATES, MAX_GEO_SEARCHES, GooglePlacesDiscoveryProvider, normalize_place
from backend.discovery.places_client import FIELD_MASK, GEO_FIELD_MASK, DiscoveryProviderError
from backend.discovery.profile_builder import build_profile
from backend.discovery.query_builder import MAX_QUERIES, PROCESS_QUERIES, build_queries
from backend.discovery.schemas import ManufacturingSpecificationPayload
from backend.discovery.scorer import score_profile
from test_discovery import ADMIN, SPECIFICATION, create_request, discover, specify
from test_discovery_enrichment import enriched_setup
from test_google_discovery import google_setup, listing, places_client


ORIGIN = (44.074, 22.095)
LOCATION = {"display_name": "Bor, Serbia", "city": "Bor", "country_code": "RS",
            "latitude": ORIGIN[0], "longitude": ORIGIN[1]}
GEO_SPEC = {**SPECIFICATION, "location": LOCATION}


def geo_place(place_id, km=1, *, name="Laser Engraving Wood Studio", country="RS", city="Bor"):
    place = listing(place_id, name, city=city, country=country)
    place["location"] = {"latitude": ORIGIN[0] + math.degrees(km / EARTH_RADIUS_KM), "longitude": ORIGIN[1]}
    return place


def search_radius(request):
    rectangle = json.loads(request.content)["locationRestriction"]["rectangle"]
    return round(math.radians(rectangle["high"]["latitude"] - ORIGIN[0]) * EARTH_RADIUS_KM)


@pytest.mark.parametrize("location", [LOCATION, {"latitude": 0, "longitude": 0},
    {"display_name": "Selected point", "country_code": " rs ", "latitude": -90, "longitude": 180},
    {"city": "Bor", "country": "RS"}, {"city": "Bor", "country": "Serbia", "country_code": "RS"},
    {"latitude": None, "longitude": None}, None])
def test_canonical_and_legacy_locations_are_supported(location):
    payload = ManufacturingSpecificationPayload.model_validate({**SPECIFICATION, "location": location})
    result = payload.model_dump(mode="json", exclude_unset=True)["location"]
    if isinstance(location, dict) and location.get("country_code"):
        assert result["country_code"] == "RS"
    else:
        assert result == location


@pytest.mark.parametrize("location", [
    {"latitude": 44}, {"longitude": 22}, {"latitude": None, "longitude": 22},
    {"latitude": "44", "longitude": 22}, {"latitude": True, "longitude": 22},
    {"latitude": 44, "longitude": False}, {"latitude": 91, "longitude": 22},
    {"latitude": -91, "longitude": 22}, {"latitude": 44, "longitude": 181},
    {"latitude": float("nan"), "longitude": 22}, {"latitude": 44, "longitude": float("inf")},
    {"country_code": "ZZ"}, {"country_code": "Serbia"}, {"country_code": "RS", "country": "US"},
    {"display_name": "x" * 241},
])
def test_invalid_canonical_location_is_rejected_before_provider_io(location):
    with pytest.raises(ValidationError):
        ManufacturingSpecificationPayload.model_validate({**SPECIFICATION, "location": location})


@pytest.mark.parametrize("origin,destination,expected", [
    ((0, 0), (0, 0), 0), ((0, 0), (0, 1), 111.195), ((0, 0), (1, 0), 111.195),
    ((0, 179.9), (0, -179.9), 22.239), ((0, 0), (0, 180), 20015.114),
    ((90, 0), (90, 90), 0),
])
def test_haversine_straight_line_distance_is_symmetric_and_finite(origin, destination, expected):
    assert straight_line_km(origin, destination) == pytest.approx(expected, abs=.002)
    assert straight_line_km(origin, destination) == pytest.approx(straight_line_km(destination, origin))


@pytest.mark.parametrize("center", [ORIGIN, (0, 0), (0, 179.9), (89.99, 10), (-89.99, -10)])
@pytest.mark.parametrize("radius", SEARCH_RADII_KM)
def test_rectangles_cover_requested_radii_and_handle_dateline_and_poles(center, radius):
    rectangle = search_rectangle(center, radius)
    low, high = rectangle["low"], rectangle["high"]
    assert -90 <= low["latitude"] <= center[0] <= high["latitude"] <= 90
    assert -180 <= low["longitude"] <= 180
    assert -180 <= high["longitude"] <= 180
    if center == (0, 179.9):
        assert low["longitude"] > high["longitude"]
    if abs(center[0]) > 89:
        assert (low["longitude"], high["longitude"]) == (-180, 180)
    else:
        assert straight_line_km(center, (high["latitude"], center[1])) == pytest.approx(radius)


@pytest.mark.parametrize("stop_radius,expected_calls", [(25, 3), (50, 6), (100, 9)])
def test_radius_expands_only_until_five_unique_relevant_geolocated_candidates(monkeypatch, stop_radius, expected_calls):
    calls = []

    def handle(request):
        calls.append(request)
        radius = search_radius(request)
        assert radius <= stop_radius
        count = 5 if radius == stop_radius else 2
        assert request.headers["X-Goog-FieldMask"] == GEO_FIELD_MASK
        body = json.loads(request.content)
        assert body["regionCode"] == "RS"
        assert body["pageSize"] == 5
        assert set(body) == {"textQuery", "pageSize", "languageCode", "regionCode", "locationRestriction"}
        assert "Bor" not in body["textQuery"], "City text must not pin expanded searches to one town"
        return httpx.Response(200, json={"places": [geo_place(f"p-{index}", index + 1) for index in range(count)]})

    result = GooglePlacesDiscoveryProvider(places_client(monkeypatch, handle)).discover(GEO_SPEC)
    assert len(result) == 5
    assert len(calls) == expected_calls
    assert [search_radius(call) for call in calls] == [radius for radius in SEARCH_RADII_KM if radius <= stop_radius for _ in range(3)]


def test_radius_filter_reconsiders_outside_results_on_larger_stage_and_excludes_over_100_km(monkeypatch):
    calls = []

    def handle(request):
        calls.append(request)
        corner = geo_place("rectangle-corner", 80)
        corner["location"]["longitude"] += math.degrees(80 / (EARTH_RADIUS_KM * math.cos(math.radians(ORIGIN[0]))))
        return httpx.Response(200, json={"places": [geo_place("near", 10), geo_place("middle", 40),
            geo_place("far", 90), geo_place("outside", 101), corner], "nextPageToken": "never-follow"})

    result = GooglePlacesDiscoveryProvider(places_client(monkeypatch, handle)).discover(GEO_SPEC)
    assert [row.source_place_id for row in result] == ["near", "middle", "far"]
    assert len(calls) == MAX_GEO_SEARCHES == 9
    assert all("pageToken" not in json.loads(call.content) for call in calls)


def test_geo_country_filter_is_hard_and_does_not_count_foreign_results(monkeypatch):
    calls = []

    def handle(request):
        calls.append(request)
        return httpx.Response(200, json={"places": [geo_place("rs", 2), geo_place("us", .1, country="US"),
            {"id": "unknown-country", "location": geo_place("point")["location"]}, geo_place("bg", .2, country="BG")]})

    result = GooglePlacesDiscoveryProvider(places_client(monkeypatch, handle)).discover(GEO_SPEC)
    assert [row.source_place_id for row in result] == ["rs"]
    assert len(calls) == 9
    assert all(json.loads(call.content)["regionCode"] == "RS" for call in calls)


def test_geo_without_country_does_not_infer_a_country_from_coordinates(monkeypatch):
    calls = []

    def handle(request):
        calls.append(request)
        assert "regionCode" not in json.loads(request.content)
        return httpx.Response(200, json={"places": [geo_place("us", 1, country="US")]})

    result = GooglePlacesDiscoveryProvider(places_client(monkeypatch, handle)).discover(
        {**GEO_SPEC, "location": {"latitude": ORIGIN[0], "longitude": ORIGIN[1]}})
    assert [row.country for row in result] == ["US"]
    assert len(calls) == 9


def test_unknown_distance_and_irrelevant_nearby_businesses_cannot_stop_expansion(monkeypatch):
    calls = []

    def handle(request):
        calls.append(request)
        records = [geo_place(f"unrelated-{index}", .1, name="General Hotel") for index in range(4)]
        records.append(listing("unknown-distance"))
        return httpx.Response(200, json={"places": records})

    result = GooglePlacesDiscoveryProvider(places_client(monkeypatch, handle)).discover(GEO_SPEC)
    assert len(result) == 5
    assert len(calls) == 9
    assert result[0].source_place_id == "unknown-distance", "Manufacturing relevance beats proximity, even when distance is unknown"


def test_geo_query_fanout_results_and_candidates_have_fixed_upper_bounds(monkeypatch):
    calls = []

    def handle(request):
        calls.append(request)
        return httpx.Response(200, json={"places": [geo_place(f"p-{len(calls)}-{index}", 1, name="General Hotel")
            for index in range(30)], "nextPageToken": "never-follow"})

    spec = {**GEO_SPEC, "process": ["laser_engraving", "cnc_milling", "3d_printing"],
            "radius_km": 100000, "max_queries": 9999}
    result = GooglePlacesDiscoveryProvider(places_client(monkeypatch, handle)).discover(spec)
    assert len(calls) == MAX_GEO_SEARCHES == 9
    assert len(result) == MAX_CANDIDATES == 10
    assert all(row.source_place_id.rsplit("-", 1)[-1] in {"0", "1", "2", "3", "4"} for row in result)
    assert len(build_queries(spec, limit=9999)) <= 9
    assert all(json.loads(call.content)["pageSize"] == 5 for call in calls)


@pytest.mark.parametrize("location", [None, {}, {"latitude": "bad", "longitude": 2},
    {"latitude": True, "longitude": 2}, {"latitude": float("nan"), "longitude": 2},
    {"latitude": 91, "longitude": 2}, {"latitude": 10**1000, "longitude": 2}, {"latitude": 44}])
def test_malformed_or_missing_google_coordinates_are_not_guessed(location):
    place = geo_place("candidate")
    place["location"] = location
    partner = normalize_place(place)
    assert partner.latitude is partner.longitude is None
    assert coordinates(build_profile(partner)["location"]) is None


def test_workshop_query_configuration_is_bounded_deterministic_and_does_not_infer_capabilities():
    terms = PROCESS_QUERIES["laser_engraving"]
    assert {"laser engraving service", "laser cutting service", "sign making", "custom fabrication", "woodworking", "CNC / laser workshop"} <= set(terms)
    pool = build_queries(GEO_SPEC, limit=9)
    assert len(pool) == len(set(pool)) == 6
    assert any("woodworking" in query for query in pool)
    assert any("sign making" in query for query in pool)
    assert any("CNC / laser workshop" in query for query in pool)
    assert pool == build_queries(deepcopy(GEO_SPEC), limit=9)
    profile = build_profile(normalize_place(geo_place("wood", name="Woodworking furniture")))
    assert score_profile(GEO_SPEC, profile).score_breakdown["process_match"] == 0
    assert build_queries({**GEO_SPEC, "process": ["unknown_process"]}, limit=9) == []


def test_legacy_text_search_retains_three_calls_and_original_mask(monkeypatch):
    calls = []

    def handle(request):
        calls.append(request)
        body = json.loads(request.content)
        assert "locationRestriction" not in body and "locationBias" not in body
        assert request.headers["X-Goog-FieldMask"] == FIELD_MASK
        return httpx.Response(200, json={"places": [listing("legacy")]})

    result = GooglePlacesDiscoveryProvider(places_client(monkeypatch, handle)).discover(SPECIFICATION)
    assert [row.source_place_id for row in result] == ["legacy"]
    assert len(calls) == MAX_QUERIES == 3


def test_geo_distance_and_relevance_ranking_persist_and_survive_restart(google_setup):
    client, db_path, payload, _ = google_setup
    payload["places"] = [geo_place("hotel", .01, name="General Hotel"), geo_place("wood", .1, name="Woodworking furniture"),
                         geo_place("far", 80), geo_place("near", 30)]
    request_id = create_request(client)
    assert specify(client, request_id, GEO_SPEC).status_code == 201
    response = discover(client, request_id)
    assert response.status_code == 200
    result = response.json()
    candidates = result["candidates"]
    details = [client.get(f"/api/partner-candidates/{row['candidate_id']}", headers=ADMIN).json() for row in candidates]
    assert [row["source_place_id"] for row in details] == ["near", "far", "wood"]
    assert [row["distance_km"] for row in candidates] == [30., 80., .1]
    assert all(row["fit_score"] == sum(row["score_breakdown"].values()) for row in candidates)
    assert all(row["verification_status"] == "PUBLIC_DATA_ONLY" for row in candidates)
    for detail in details:
        assert detail["partner_profile"]["distance_km"] == detail["distance_km"]
        assert coordinates(detail["partner_profile"]["location"]) is not None
        assert coordinates(detail) == coordinates(detail["partner_profile"]["location"])
    assert [coordinates(row) for row in candidates] == [coordinates(row) for row in details]
    assert coordinates(candidates[0]) != ORIGIN
    with sqlite3.connect(db_path) as connection:
        profiles = [json.loads(row[0]) for row in connection.execute("SELECT profile_json FROM public_capacity_profiles")]
        assert sorted(row["distance_km"] for row in profiles) == [.1, 30., 80.]
    other_headers = {**ADMIN, "X-BADEM-User-Id": "b07127c3-7a8e-44da-b43f-a5fdd2b83d21"}
    assert client.get(f"/api/manufacturing-requests/{request_id}/candidates", headers=other_headers).status_code == 404
    assert client.get(f"/api/partner-candidates/{candidates[0]['candidate_id']}", headers=other_headers).status_code == 404
    with TestClient(create_app(str(db_path), "admin", "laser-01", "test-secret")) as restarted:
        assert restarted.get(f"/api/manufacturing-requests/{request_id}/candidates", headers=ADMIN).json() == result
    # A historic profile without distance remains readable and does not invent it.
    with sqlite3.connect(db_path) as connection:
        row = connection.execute("SELECT id,profile_json FROM public_capacity_profiles LIMIT 1").fetchone()
        profile = json.loads(row[1])
        profile.pop("distance_km")
        connection.execute("UPDATE public_capacity_profiles SET profile_json=? WHERE id=?", (json.dumps(profile), row[0]))
    assert any(row["distance_km"] is None for row in client.get(f"/api/manufacturing-requests/{request_id}/candidates", headers=ADMIN).json()["candidates"])


def test_geo_enrichment_uses_relevance_before_distance_and_preserves_country_filter(enriched_setup):
    client, _, request_id, upstream = enriched_setup
    upstream.records = [geo_place("foreign", .01, country="US"), geo_place("hotel", .02, name="General Hotel"),
                        geo_place("near-workshop", 10), geo_place("far-workshop", 70), geo_place("wood", .03, name="Woodworking furniture")]
    assert specify(client, request_id, GEO_SPEC).status_code == 200
    result = discover(client, request_id).json()
    assert upstream.detail_ids() == ["near-workshop", "far-workshop", "wood"]
    assert result["candidates"][0]["distance_km"] == 10
    assert result["candidates"][1]["distance_km"] == 70


def test_distance_changes_order_only_after_manufacturing_evidence():
    def profile(process, material, distance):
        return {"fit_score": process + material + 10, "score_breakdown": {"process_match": process, "material_signal": material}, "distance_km": distance}
    assert ranking_key(profile(40, 20, 99), "far", geo=True) < ranking_key(profile(0, 0, 0), "near", geo=True)
    assert ranking_key(profile(40, 20, 1), "near", geo=True) < ranking_key(profile(40, 20, 40), "far", geo=True)
    assert ranking_key(profile(40, 20, None), "unknown", geo=True) > ranking_key(profile(40, 20, 40), "known", geo=True)
    assert ranking_key(profile(40, 20, None), "legacy", geo=False) == (-70, "legacy")


@pytest.mark.parametrize("center,radius", [(None, 25), (ORIGIN, None), (ORIGIN, 1000), ((91, 2), 25),
                                         ((float("nan"), 2), 25), ((True, 2), 25), ((44,), 25)])
def test_client_rejects_unsupported_search_shapes_without_http(monkeypatch, center, radius):
    def forbidden(request):
        raise AssertionError("Invalid geometry must not reach Google")
    with pytest.raises(DiscoveryProviderError, match="Invalid discovery search area"):
        places_client(monkeypatch, forbidden).text_search("laser engraving", center=center, radius_km=radius)


def test_geo_unknown_taxonomy_has_no_paid_requests(monkeypatch):
    def forbidden(request):
        raise AssertionError("Unknown taxonomy must not fan out")
    assert GooglePlacesDiscoveryProvider(places_client(monkeypatch, forbidden)).discover(
        {**GEO_SPEC, "process": ["unknown_taxonomy"]}) == []


@pytest.mark.parametrize("location", [None, {"city": "Bor", "country": "RS"}, LOCATION])
def test_unavailable_candidate_coordinates_expose_null_not_invented_distance(google_setup, location):
    client, _, payload, calls = google_setup
    payload["places"] = [listing("no-point", city="Bor")]
    request_id = create_request(client)
    assert specify(client, request_id, {**SPECIFICATION, "location": location}).status_code == 201
    response = discover(client, request_id)
    assert response.status_code == 200
    candidate = response.json()["candidates"][0]
    assert candidate["distance_km"] is None
    assert candidate["latitude"] is candidate["longitude"] is None
    detail = client.get(f"/api/partner-candidates/{candidate['candidate_id']}", headers=ADMIN).json()
    assert detail["distance_km"] is None
    assert "distance_km" not in detail["partner_profile"]
    assert len(calls) == (9 if location == LOCATION else 3)


def test_geo_provider_failure_keeps_previous_snapshot_and_stops_paid_fanout(google_setup):
    client, db_path, payload, calls = google_setup
    payload["places"] = [geo_place("existing", 1)]
    request_id = create_request(client)
    specify(client, request_id, GEO_SPEC)
    previous = discover(client, request_id).json()
    with sqlite3.connect(db_path) as connection:
        snapshot = connection.execute("SELECT * FROM public_capacity_profiles").fetchall()
    payload.clear()
    payload.update({"status_code": 429, "error": "private upstream message"})
    count = len(calls)
    assert discover(client, request_id).status_code == 502
    assert len(calls) == count + 1
    assert client.get(f"/api/manufacturing-requests/{request_id}/candidates", headers=ADMIN).json() == previous
    with sqlite3.connect(db_path) as connection:
        assert connection.execute("SELECT * FROM public_capacity_profiles").fetchall() == snapshot


def test_invalid_geo_api_payload_never_saves_specification_or_calls_google(google_setup):
    client, db_path, _, calls = google_setup
    request_id = create_request(client)
    assert specify(client, request_id, {**GEO_SPEC, "location": {**LOCATION, "latitude": 91}}).status_code == 422
    assert calls == []
    with sqlite3.connect(db_path) as connection:
        assert connection.execute("SELECT COUNT(*) FROM manufacturing_specifications").fetchone() == (0,)


def test_failure_during_expansion_is_not_retried_or_replaced_with_partial_results(monkeypatch):
    calls = []
    def handle(request):
        calls.append(request)
        if search_radius(request) == 50:
            return httpx.Response(429, json={"error": "private provider detail"})
        return httpx.Response(200, json={"places": [geo_place("near", 1)]})
    provider = GooglePlacesDiscoveryProvider(places_client(monkeypatch, handle))
    with pytest.raises(DiscoveryProviderError):
        provider.discover(GEO_SPEC)
    assert [search_radius(request) for request in calls] == [25, 25, 25, 50]


def test_canonical_country_code_preserves_legacy_country_scoring():
    profile = build_profile(normalize_place(geo_place("rs", 1)))
    canonical = {**SPECIFICATION, "location": {"city": "Bor", "country_code": "RS"}}
    legacy = {**SPECIFICATION, "location": {"city": "Bor", "country": "RS"}}
    assert score_profile(canonical, profile) == score_profile(legacy, profile)
