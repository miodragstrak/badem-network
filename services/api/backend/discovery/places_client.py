"""Bounded Places API (New) Text Search, with sanitized provider errors."""

import os
import re

import httpx

from backend.discovery.countries import region_code as supported_region_code


TEXT_SEARCH_URL = "https://places.googleapis.com/v1/places:searchText"
PLACE_DETAILS_URL = "https://places.googleapis.com/v1/places/"
FIELD_MASK = "places.id,places.displayName,places.addressComponents,places.primaryType,places.types"
DETAILS_FIELD_MASK = "websiteUri,rating,userRatingCount,businessStatus"
MAX_RESULTS_PER_QUERY = 5
REQUEST_TIMEOUT_SECONDS = 5


class DiscoveryConfigurationError(RuntimeError):
    pass


class DiscoveryProviderError(RuntimeError):
    status_code = 502


class DiscoveryTimeoutError(DiscoveryProviderError):
    status_code = 504


class GooglePlacesClient:
    def __init__(self, *, transport: httpx.BaseTransport | None = None):
        self._api_key = (os.getenv("GOOGLE_PLACES_API_KEY") or "").strip()
        if not self._api_key:
            raise DiscoveryConfigurationError("GOOGLE_PLACES_API_KEY is required for google_places discovery")
        self.transport = transport

    def text_search(self, query: str, *, region_code: str | None = None) -> list[dict]:
        payload = {"textQuery": query, "pageSize": MAX_RESULTS_PER_QUERY, "languageCode": "en"}
        region = supported_region_code(region_code)
        if region:
            payload["regionCode"] = region
        try:
            with httpx.Client(transport=self.transport, timeout=REQUEST_TIMEOUT_SECONDS, trust_env=False) as client:
                response = client.post(TEXT_SEARCH_URL, headers={
                    "X-Goog-Api-Key": self._api_key, "X-Goog-FieldMask": FIELD_MASK,
                }, json=payload)
                if not 200 <= response.status_code < 300:
                    raise DiscoveryProviderError("Google Places search failed; check provider configuration and quota")
                body = response.json()
        except httpx.TimeoutException:
            raise DiscoveryTimeoutError("Google Places search timed out; retry discovery") from None
        except httpx.HTTPError:
            raise DiscoveryProviderError("Google Places search could not be reached") from None
        except ValueError:
            raise DiscoveryProviderError("Google Places returned invalid JSON") from None
        if not isinstance(body, dict) or "error" in body or (body and "places" not in body):
            raise DiscoveryProviderError("Google Places returned a malformed search response")
        # Google omits repeated fields when there are zero results.
        places = body.get("places", [])
        if not isinstance(places, list):
            raise DiscoveryProviderError("Google Places returned a malformed places list")
        return [place for place in places[:MAX_RESULTS_PER_QUERY] if isinstance(place, dict)]

    def place_details(self, place_id: str) -> dict:
        if not re.fullmatch(r"[A-Za-z0-9_-]{1,512}", place_id):
            raise DiscoveryProviderError("Cannot enrich an invalid Google Place ID")
        try:
            with httpx.Client(transport=self.transport, timeout=REQUEST_TIMEOUT_SECONDS, trust_env=False) as client:
                response = client.get(PLACE_DETAILS_URL + place_id, headers={
                    "X-Goog-Api-Key": self._api_key, "X-Goog-FieldMask": DETAILS_FIELD_MASK,
                })
                if not 200 <= response.status_code < 300:
                    raise DiscoveryProviderError("Google Places details are unavailable")
                body = response.json()
        except httpx.TimeoutException:
            raise DiscoveryTimeoutError("Google Places details timed out") from None
        except httpx.HTTPError:
            raise DiscoveryProviderError("Google Places details could not be reached") from None
        except ValueError:
            raise DiscoveryProviderError("Google Places returned invalid detail JSON") from None
        if (not isinstance(body, dict) or "error" in body
                or (body and not body.keys() & set(DETAILS_FIELD_MASK.split(",")))):
            raise DiscoveryProviderError("Google Places returned a malformed detail response")
        return body
