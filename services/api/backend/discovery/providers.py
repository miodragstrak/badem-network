"""Explicit, startup-time discovery provider selection; never silently falls back."""

import os

from backend.discovery.google_provider import GooglePlacesDiscoveryProvider
from backend.discovery.mock_provider import MockDiscoveryProvider
from backend.discovery.models import DiscoveryProvider
from backend.discovery.places_client import DiscoveryConfigurationError


def create_provider() -> DiscoveryProvider:
    name = os.getenv("BADEM_DISCOVERY_PROVIDER", "mock").strip().lower()
    if name == "mock":
        return MockDiscoveryProvider()
    if name == "google_places":
        return GooglePlacesDiscoveryProvider()
    raise DiscoveryConfigurationError("BADEM_DISCOVERY_PROVIDER must be mock or google_places")
