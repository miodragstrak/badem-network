"""Bounded Places API (New) Text Search, with sanitized provider errors."""

import os

import httpx


TEXT_SEARCH_URL = "https://places.googleapis.com/v1/places:searchText"
FIELD_MASK = "places.id,places.displayName,places.addressComponents,places.primaryType,places.types"
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

    def text_search(self, query: str) -> list[dict]:
        try:
            with httpx.Client(transport=self.transport, timeout=REQUEST_TIMEOUT_SECONDS, trust_env=False) as client:
                response = client.post(TEXT_SEARCH_URL, headers={
                    "X-Goog-Api-Key": self._api_key, "X-Goog-FieldMask": FIELD_MASK,
                }, json={"textQuery": query, "pageSize": MAX_RESULTS_PER_QUERY, "languageCode": "en"})
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
