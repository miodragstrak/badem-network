"""Backend tests are credential-independent and must not make live HTTP calls."""

import httpx
import pytest


@pytest.fixture(autouse=True)
def isolate_discovery_and_external_http(monkeypatch):
    for name in ("BADEM_DISCOVERY_PROVIDER", "GOOGLE_PLACES_API_KEY", "BADEM_DISCOVERY_ENRICH_TOP_N"):
        monkeypatch.delenv(name, raising=False)

    def block_network(*args, **kwargs):
        raise AssertionError("Backend tests must use mocked external HTTP")

    monkeypatch.setattr(httpx.HTTPTransport, "handle_request", block_network)
    monkeypatch.setattr(httpx.AsyncHTTPTransport, "handle_async_request", block_network)
