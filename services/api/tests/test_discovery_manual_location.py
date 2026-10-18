"""Manual location uses one server Places lookup and the existing geo pipeline."""

import json

import httpx
import pytest
from fastapi.testclient import TestClient

from backend.app import create_app
from backend.discovery import google_provider
from backend.discovery.geo import coordinates
from backend.discovery.places_client import (
    FIELD_MASK, GEO_FIELD_MASK, LOCATION_FIELD_MASK, REQUEST_TIMEOUT_SECONDS, TEXT_SEARCH_URL, GooglePlacesClient,
)
from test_discovery import ADMIN, SPECIFICATION, create_request, discover, specify
from test_google_discovery import listing


SERVER_KEY = "server-location-test-key-never-public"
MANUAL = {"display_name": "Belgrade, Serbia", "city": "Belgrade", "country": "RS"}
CANONICAL = {**MANUAL, "country_code": "RS", "latitude": 44.7866, "longitude": 20.4489}
MANUAL_SPEC = {**SPECIFICATION, "location": MANUAL}
CITY = {**listing("belgrade", "Belgrade"), "formattedAddress": "Belgrade, Serbia",
        "location": {"latitude": CANONICAL["latitude"], "longitude": CANONICAL["longitude"]},
        "types": ["locality", "political"], "primaryType": "locality", "private_provider_value": SERVER_KEY}


@pytest.fixture
def manual_setup(tmp_path, monkeypatch):
    monkeypatch.delenv("BADEM_NODE_ID", raising=False)
    monkeypatch.delenv("BADEM_NODE_PUBLIC_KEY", raising=False)
    monkeypatch.setenv("BADEM_DISCOVERY_PROVIDER", "google_places")
    monkeypatch.setenv("GOOGLE_PLACES_API_KEY", SERVER_KEY)
    monkeypatch.setenv("BADEM_DISCOVERY_ENRICH_TOP_N", "0")
    # Even an unexpected second result/page must never be followed for location resolution.
    upstream = {"resolution": httpx.Response(200, json={"places": [CITY, listing("ignored")],
                                                       "nextPageToken": "never-follow"}),
                "places": [{**listing(f"workshop-{index}"), "location": {
                    "latitude": CANONICAL["latitude"] + .01 * (index + 1),
                    "longitude": CANONICAL["longitude"]}} for index in range(5)]}
    calls = []

    def handle(request):
        calls.append(request)
        assert request.method == "POST"
        assert str(request.url) == TEXT_SEARCH_URL
        assert request.url.query == b""
        assert request.headers["X-Goog-Api-Key"] == SERVER_KEY
        if request.headers["X-Goog-FieldMask"] == LOCATION_FIELD_MASK:
            result = upstream["resolution"]
            if isinstance(result, httpx.HTTPError):
                raise result
            return result
        return httpx.Response(200, json={"places": upstream["places"]})

    monkeypatch.setattr(google_provider, "GooglePlacesClient",
                        lambda: GooglePlacesClient(transport=httpx.MockTransport(handle)))
    with TestClient(create_app(str(tmp_path / "manual.db"), "admin", "laser-01", "test-secret")) as client:
        yield client, upstream, calls


def resolution_calls(calls):
    return [call for call in calls if call.headers["X-Goog-FieldMask"] == LOCATION_FIELD_MASK]


def test_manual_belgrade_resolves_once_persists_and_uses_existing_geo_discovery(manual_setup):
    client, _, calls = manual_setup
    request_id = create_request(client)
    saved = specify(client, request_id, MANUAL_SPEC)
    assert saved.status_code == 201
    assert saved.json()["payload"]["location"] == CANONICAL
    assert len(calls) == 1
    lookup = calls[0]
    assert json.loads(lookup.content) == {"textQuery": "Belgrade, Serbia", "pageSize": 1,
                                        "languageCode": "en", "regionCode": "RS"}
    assert lookup.extensions["timeout"] == {
        kind: REQUEST_TIMEOUT_SECONDS for kind in ("connect", "read", "write", "pool")}
    persisted = client.get(f"/api/manufacturing-requests/{request_id}/specification", headers=ADMIN)
    assert persisted.json() == saved.json()
    response = discover(client, request_id)
    assert response.status_code == 200
    candidates = response.json()["candidates"]
    assert len(candidates) == 5
    assert all(coordinates(candidate) is not None and candidate["distance_km"] > 0 for candidate in candidates)
    searches = calls[1:]
    assert len(searches) == 3  # Existing 25 km stopping condition, unchanged.
    assert all(call.headers["X-Goog-FieldMask"] == GEO_FIELD_MASK for call in searches)
    assert all("locationRestriction" in json.loads(call.content) for call in searches)
    assert all("Belgrade" not in json.loads(call.content)["textQuery"] for call in searches)
    for candidate in candidates:
        detail = client.get(f"/api/partner-candidates/{candidate['candidate_id']}", headers=ADMIN)
        assert detail.json()["distance_km"] == candidate["distance_km"]
        assert SERVER_KEY not in detail.text
    assert all(SERVER_KEY not in result.text for result in (saved, persisted, response))
    assert SERVER_KEY not in client.get("/openapi.json").text
    assert discover(client, request_id).json() == response.json()
    # The returned canonical payload can be submitted again without another lookup.
    assert specify(client, request_id, saved.json()["payload"]).status_code == 200
    assert len(resolution_calls(calls)) == 1


@pytest.mark.parametrize("failure", [
    httpx.Response(403, json={"error": SERVER_KEY}),
    httpx.Response(429, json={"error": SERVER_KEY}),
    httpx.Response(503, json={"error": SERVER_KEY}),
    httpx.ReadTimeout(SERVER_KEY), httpx.ConnectError(SERVER_KEY),
    httpx.Response(200, content=SERVER_KEY),
    httpx.Response(200, json={"error": SERVER_KEY}),
    httpx.Response(200, json=[]),
    httpx.Response(200, json={"places": SERVER_KEY}),
    httpx.Response(200, json={}),
    httpx.Response(200, json={"places": []}),
    httpx.Response(200, json={"places": [None, CITY]}),
    httpx.Response(200, json={"places": [{**CITY, "location": {"latitude": 91, "longitude": 20}}]}),
    httpx.Response(200, json={"places": [{**CITY, "location": {"latitude": "44", "longitude": 20}}]}),
    httpx.Response(200, json={"places": [{**CITY, "location": {"latitude": True, "longitude": 20}}]}),
    httpx.Response(200, json={"places": [{**CITY, "location": None}]}),
    httpx.Response(200, json={"places": [{**CITY, "addressComponents": []}]}),
    httpx.Response(200, json={"places": [{**CITY, "addressComponents": listing(country="US")["addressComponents"]}]}),
    httpx.Response(200, json={"places": [{**CITY, "formattedAddress": "x" * 241}]}),
])
def test_failed_resolution_preserves_fallback_and_discovery_without_retry(manual_setup, failure):
    client, upstream, calls = manual_setup
    upstream.update({"resolution": failure, "places": [listing("fallback-workshop")]})
    request_id = create_request(client)
    saved = specify(client, request_id, MANUAL_SPEC)
    assert saved.status_code == 201
    assert saved.json()["payload"]["location"] == MANUAL
    assert len(calls) == 1
    response = discover(client, request_id)
    assert response.status_code == 200
    candidate, = response.json()["candidates"]
    assert candidate["latitude"] is candidate["longitude"] is candidate["distance_km"] is None
    assert len(calls) == 4
    for call in calls[1:]:
        assert call.headers["X-Goog-FieldMask"] == FIELD_MASK
        assert "Belgrade" in json.loads(call.content)["textQuery"]
        assert "locationRestriction" not in json.loads(call.content)
    persisted = client.get(f"/api/manufacturing-requests/{request_id}/specification", headers=ADMIN)
    assert persisted.json() == saved.json()
    assert discover(client, request_id).json() == response.json()
    assert len(resolution_calls(calls)) == 1
    assert all(SERVER_KEY not in result.text for result in (saved, persisted, response))


def test_browser_geolocation_is_preserved_without_resolution_or_reverse_geocoding(manual_setup):
    client, _, calls = manual_setup
    location = {"display_name": "Current location", "latitude": 44.7866, "longitude": 20.4489}
    request_id = create_request(client)
    saved = specify(client, request_id, {**SPECIFICATION, "location": location})
    assert saved.status_code == 201
    assert saved.json()["payload"]["location"] == location
    assert calls == []
    response = discover(client, request_id)
    assert response.status_code == 200
    assert len(response.json()["candidates"]) == 5
    assert len(calls) == 3
    assert all(call.headers["X-Goog-FieldMask"] == GEO_FIELD_MASK for call in calls)
    assert all("regionCode" not in json.loads(call.content) for call in calls)


def test_manual_resolution_requires_request_ownership_before_provider_io(manual_setup):
    client, _, calls = manual_setup
    request_id = create_request(client)
    other_user = {**ADMIN, "X-BADEM-User-Id": "b07127c3-7a8e-44da-b43f-a5fdd2b83d21"}
    path = f"/api/manufacturing-requests/{request_id}/specification"
    assert client.post(path, headers=other_user, json=MANUAL_SPEC).status_code == 404
    assert client.post(path, json=MANUAL_SPEC).status_code == 401
    assert specify(client, "missing-request", MANUAL_SPEC).status_code == 404
    assert calls == []
