import json
import sqlite3
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager

import httpx
import pytest
from fastapi.testclient import TestClient

from backend.app import create_app
from backend.discovery import models
from backend.discovery.mock_provider import MockDiscoveryProvider
from backend.discovery.schemas import ManufacturingSpecificationPayload
from backend.discovery.service import DiscoveryService


OWNER_USER_ID = "7d210ad9-3c1e-4b65-af95-a749924b39f0"
ADMIN = {"X-Admin-Key": "admin", "X-BADEM-User-Id": OWNER_USER_ID}
REQUEST = {"title": "Wooden logo pendant", "description": "30 wooden pendants with an engraved logo.",
           "location_text": "Belgrade, Serbia", "quantity": 30}
SPECIFICATION = {"process": ["laser_engraving"], "materials": ["plywood"], "quantity": 30,
                 "dimensions_mm": {"width": 80, "height": 80, "thickness": 3},
                 "requirements": ["engraved logo"], "location": {"city": "Belgrade", "country": "RS"}}


@pytest.fixture
def setup(tmp_path, monkeypatch):
    monkeypatch.delenv("BADEM_NODE_ID", raising=False)
    monkeypatch.delenv("BADEM_NODE_PUBLIC_KEY", raising=False)

    def block_network(*args, **kwargs):
        raise AssertionError("Mock discovery must not contact external services")

    monkeypatch.setattr(httpx.HTTPTransport, "handle_request", block_network)
    db_path = tmp_path / "discovery.db"
    with TestClient(create_app(str(db_path), "admin", "laser-01", "test-secret")) as client:
        yield client, db_path


def create_request(client):
    response = client.post("/api/manufacturing-requests", headers=ADMIN, json=REQUEST)
    assert response.status_code == 201, response.text
    return response.json()["id"]


def specify(client, request_id, payload=SPECIFICATION):
    return client.post(f"/api/manufacturing-requests/{request_id}/specification", headers=ADMIN, json=payload)


def discover(client, request_id):
    return client.post(f"/api/manufacturing-requests/{request_id}/discover", headers=ADMIN)


@contextmanager
def connection_factory(db_path):
    connection = sqlite3.connect(db_path, timeout=10)
    connection.row_factory = sqlite3.Row
    try:
        connection.execute("PRAGMA foreign_keys=ON")
        connection.execute("BEGIN IMMEDIATE")
        yield connection
        connection.commit()
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.close()


def test_create_request_persists_draft_and_reads_it(setup):
    client, db_path = setup
    request_id = create_request(client)
    response = client.get(f"/api/manufacturing-requests/{request_id}", headers=ADMIN)
    assert response.status_code == 200
    request = response.json()
    assert all(request[key] == value for key, value in REQUEST.items())
    assert request["status"] == "DRAFT"
    assert request["created_at"] > 0
    with sqlite3.connect(db_path) as connection:
        assert connection.execute("SELECT status FROM manufacturing_requests WHERE id=?", (request_id,)).fetchone() == ("DRAFT",)
        assert connection.execute("SELECT COUNT(*) FROM jobs").fetchone() == (0,)


def test_request_can_omit_optional_quantity_and_location(setup):
    response = setup[0].post("/api/manufacturing-requests", headers=ADMIN,
                             json={"title": "Prototype", "description": "Initial manufacturing request"})
    assert response.status_code == 201
    assert response.json()["quantity"] is None
    assert response.json()["location_text"] is None


@pytest.mark.parametrize("changes", [
    {"title": ""}, {"title": "  "}, {"title": "x" * 121}, {"description": ""},
    {"quantity": 0}, {"quantity": -1}, {"quantity": True}, {"quantity": 1.5},
    {"quantity": "30"}, {"quantity": 2**63}, {"status": "DISCOVERY_COMPLETE"},
])
def test_invalid_manufacturing_request_is_not_stored(setup, changes):
    client, db_path = setup
    assert client.post("/api/manufacturing-requests", headers=ADMIN,
                       json={**REQUEST, **changes}).status_code == 422
    with sqlite3.connect(db_path) as connection:
        assert connection.execute("SELECT COUNT(*) FROM manufacturing_requests").fetchone() == (0,)


@pytest.mark.parametrize("method,path,payload", [
    ("POST", "/api/manufacturing-requests", REQUEST),
    ("GET", "/api/manufacturing-requests/unknown", None),
    ("POST", "/api/manufacturing-requests/unknown/specification", SPECIFICATION),
    ("GET", "/api/manufacturing-requests/unknown/specification", None),
    ("POST", "/api/manufacturing-requests/unknown/discover", None),
    ("GET", "/api/manufacturing-requests/unknown/candidates", None),
    ("GET", "/api/partner-candidates/unknown", None),
])
@pytest.mark.parametrize("headers", [{}, {"X-Admin-Key": "wrong"}])
def test_discovery_routes_require_existing_admin_auth(setup, method, path, payload, headers):
    assert setup[0].request(method, path, headers=headers, json=payload).status_code == 401


@pytest.mark.parametrize("method,path,payload", [
    ("GET", "/api/manufacturing-requests/unknown", None),
    ("POST", "/api/manufacturing-requests/unknown/specification", SPECIFICATION),
    ("GET", "/api/manufacturing-requests/unknown/specification", None),
    ("POST", "/api/manufacturing-requests/unknown/discover", None),
    ("GET", "/api/manufacturing-requests/unknown/candidates", None),
    ("GET", "/api/partner-candidates/unknown", None),
])
def test_unknown_entities_return_404(setup, method, path, payload):
    assert setup[0].request(method, path, headers=ADMIN, json=payload).status_code == 404


def test_specification_is_flexible_json_persisted_and_status_is_specified(setup):
    client, db_path = setup
    request_id = create_request(client)
    payload = {**SPECIFICATION, "finish_options": ["natural", "painted"],
               "future_taxonomy": {"tolerance_mm": .2, "prototype": True}}
    response = specify(client, request_id, payload)
    assert response.status_code == 201
    specification = response.json()
    assert specification["request_id"] == request_id
    assert specification["payload"] == payload
    assert client.get(f"/api/manufacturing-requests/{request_id}/specification", headers=ADMIN).json() == specification
    assert client.get(f"/api/manufacturing-requests/{request_id}", headers=ADMIN).json()["status"] == "SPECIFIED"
    with sqlite3.connect(db_path) as connection:
        assert json.loads(connection.execute("SELECT payload_json FROM manufacturing_specifications").fetchone()[0]) == payload


@pytest.mark.parametrize("changes", [
    {"process": []}, {"process": "laser_engraving"}, {"process": [""]},
    {"materials": []}, {"materials": [3]}, {"quantity": False},
    {"quantity": 0}, {"location": {"city": ["Belgrade"]}}, {"dimensions_mm": [80, 80, 3]},
])
def test_invalid_specifications_do_not_change_request(setup, changes):
    client, db_path = setup
    request_id = create_request(client)
    assert specify(client, request_id, {**SPECIFICATION, **changes}).status_code == 422
    assert client.get(f"/api/manufacturing-requests/{request_id}", headers=ADMIN).json()["status"] == "DRAFT"
    with sqlite3.connect(db_path) as connection:
        assert connection.execute("SELECT COUNT(*) FROM manufacturing_specifications").fetchone() == (0,)


def test_oversized_specification_is_rejected(setup):
    client, _ = setup
    request_id = create_request(client)
    assert specify(client, request_id, {**SPECIFICATION, "future_field": "x" * 65536}).status_code == 422


def test_discovery_requires_specification_and_draft_list_is_empty(setup):
    client, _ = setup
    request_id = create_request(client)
    assert discover(client, request_id).status_code == 409
    assert client.get(f"/api/manufacturing-requests/{request_id}/specification", headers=ADMIN).status_code == 404
    assert client.get(f"/api/manufacturing-requests/{request_id}/candidates", headers=ADMIN).json() == {
        "request_id": request_id, "status": "DRAFT", "provider": "MOCK_PUBLIC_DATA", "candidates": [],
    }


def test_mock_discovery_persists_ranked_unverified_profiles_and_read_endpoints(setup):
    client, db_path = setup
    request_id = create_request(client)
    assert specify(client, request_id).status_code == 201
    response = discover(client, request_id)
    assert response.status_code == 200, response.text
    result = response.json()
    assert result["status"] == "DISCOVERY_COMPLETE"
    assert result["provider"] == "MOCK_PUBLIC_DATA"
    candidates = result["candidates"]
    assert len(candidates) == 3
    assert {candidate["name"] for candidate in candidates} == {
        "Laser Studio Belgrade", "Maker Workshop Serbia", "CNC Wood Lab",
    }
    assert candidates[0]["name"] == "Laser Studio Belgrade"
    scores = [candidate["fit_score"] for candidate in candidates]
    assert scores == sorted(scores, reverse=True)
    assert any(candidate["fit_score"] < 40 for candidate in candidates)
    for candidate in candidates:
        assert 0 <= candidate["fit_score"] <= 100
        assert candidate["fit_score"] == sum(candidate["score_breakdown"].values())
        assert candidate["verification_status"] == "PUBLIC_DATA_ONLY"
        assert candidate["disclaimer"] == models.DISCLAIMER
        assert candidate["source"] == "MOCK_PUBLIC_DATA"
        assert candidate["is_mock"] is True
        assert candidate["reasoning"]
        assert candidate["fit_summary"].endswith("based on public data")
        detail_response = client.get(f"/api/partner-candidates/{candidate['candidate_id']}", headers=ADMIN)
        assert detail_response.status_code == 200
        detail = detail_response.json()
        assert detail["request_id"] == request_id
        assert detail["source_place_id"].startswith("mock-")
        profile = detail["partner_profile"]
        assert profile["display_name"] == candidate["name"]
        assert profile["fit_score"] == candidate["fit_score"]
        assert profile["fit_label"] == candidate["fit_label"]
        assert profile["disclaimer"] == models.DISCLAIMER
        assert profile["verification_status"] == "PUBLIC_DATA_ONLY"
        assert profile["is_mock"] is True
        assert all("evidence" in capability for capability in profile["inferred_capabilities"])
        wording = json.dumps(detail).casefold()
        assert all(claim not in wording for claim in ("can manufacture", "verified supplier", "will manufacture"))
    assert client.get(f"/api/manufacturing-requests/{request_id}/candidates", headers=ADMIN).json() == result
    assert client.get(f"/api/manufacturing-requests/{request_id}", headers=ADMIN).json()["status"] == "DISCOVERY_COMPLETE"
    with sqlite3.connect(db_path) as connection:
        for table in ("partner_candidates", "public_capacity_profiles"):
            assert connection.execute(f"SELECT COUNT(*) FROM {table}").fetchone() == (3,)
        for table in ("jobs", "machine_events", "production_proofs", "proof_anchors"):
            assert connection.execute(f"SELECT COUNT(*) FROM {table}").fetchone() == (0,)


def test_repeated_discovery_is_stable_and_does_not_touch_other_requests(setup):
    client, db_path = setup
    ids = [create_request(client), create_request(client)]
    for request_id in ids:
        specify(client, request_id)
    first = discover(client, ids[0]).json()
    other = discover(client, ids[1]).json()
    assert discover(client, ids[0]).json() == first
    assert client.get(f"/api/manufacturing-requests/{ids[1]}/candidates", headers=ADMIN).json() == other
    assert {c["candidate_id"] for c in first["candidates"]}.isdisjoint({c["candidate_id"] for c in other["candidates"]})
    with sqlite3.connect(db_path) as connection:
        for table in ("partner_candidates", "public_capacity_profiles"):
            assert connection.execute(f"SELECT COUNT(*) FROM {table}").fetchone() == (6,)


def test_refreshed_timestamp_changes_but_creation_and_ids_are_preserved(setup):
    client, db_path = setup
    request_id = create_request(client)
    specify(client, request_id)
    service = DiscoveryService(lambda: connection_factory(db_path), clock=lambda: 1000)
    first = service.discover(request_id, owner_user_id=OWNER_USER_ID)
    candidate_id = first["candidates"][0]["candidate_id"]
    first_detail = service.get_candidate(candidate_id, owner_user_id=OWNER_USER_ID)
    service.clock = lambda: 2000
    second = service.discover(request_id, owner_user_id=OWNER_USER_ID)
    assert second == first
    refreshed = service.get_candidate(candidate_id, owner_user_id=OWNER_USER_ID)
    assert refreshed["created_at"] == first_detail["created_at"] == 1000
    assert refreshed["last_refreshed_at"] == 2000


def test_specification_replacement_invalidates_results_and_changes_ranking(setup):
    client, db_path = setup
    request_id = create_request(client)
    original_specification = specify(client, request_id).json()
    previous = discover(client, request_id).json()
    replacement = {"process": ["3d_printing"], "materials": ["pla"],
                   "location": {"city": "Belgrade", "country": "RS"}}
    updated = specify(client, request_id, replacement)
    assert updated.status_code == 200
    assert updated.json()["id"] == original_specification["id"]
    assert updated.json()["created_at"] == original_specification["created_at"]
    assert updated.json()["payload"] == replacement
    assert client.get(f"/api/manufacturing-requests/{request_id}/candidates", headers=ADMIN).json() == {
        "request_id": request_id, "status": "SPECIFIED", "provider": "MOCK_PUBLIC_DATA", "candidates": [],
    }
    assert client.get(f"/api/partner-candidates/{previous['candidates'][0]['candidate_id']}", headers=ADMIN).status_code == 404
    current = discover(client, request_id).json()
    assert current["candidates"][0]["name"] == "3D Print & Prototype Studio"
    with sqlite3.connect(db_path) as connection:
        assert connection.execute("SELECT COUNT(*) FROM manufacturing_specifications").fetchone() == (1,)
        assert connection.execute("SELECT COUNT(*) FROM public_capacity_profiles").fetchone() == (2,)


def test_requests_profiles_and_scores_survive_restart(setup):
    client, db_path = setup
    request_id = create_request(client)
    specification = specify(client, request_id).json()
    result = discover(client, request_id).json()
    with TestClient(create_app(str(db_path), "admin", "laser-01", "test-secret")) as restarted:
        assert restarted.get(f"/api/manufacturing-requests/{request_id}/specification", headers=ADMIN).json() == specification
        assert restarted.get(f"/api/manufacturing-requests/{request_id}/candidates", headers=ADMIN).json() == result
        assert discover(restarted, request_id).json() == result


def test_concurrent_rediscovery_keeps_one_profile_per_candidate(setup):
    client, db_path = setup
    request_id = create_request(client)
    specify(client, request_id)
    with ThreadPoolExecutor(max_workers=2) as pool:
        responses = list(pool.map(lambda _: discover(client, request_id), range(2)))
    assert all(response.status_code == 200 for response in responses)
    assert responses[0].json() == responses[1].json()
    with sqlite3.connect(db_path) as connection:
        assert connection.execute("SELECT COUNT(*) FROM partner_candidates").fetchone() == (3,)
        assert connection.execute("SELECT COUNT(*) FROM public_capacity_profiles").fetchone() == (3,)


def test_provider_failure_rolls_back_status_and_retains_prior_results(setup):
    class FailingProvider:
        def discover(self, specification):
            raise RuntimeError("Mock fixture failure")

    client, db_path = setup
    request_id = create_request(client)
    specify(client, request_id)
    before = discover(client, request_id).json()
    service = DiscoveryService(lambda: connection_factory(db_path), provider=FailingProvider())
    with pytest.raises(RuntimeError, match="fixture failure"):
        service.discover(request_id, owner_user_id=OWNER_USER_ID)
    assert client.get(f"/api/manufacturing-requests/{request_id}/candidates", headers=ADMIN).json() == before


def test_storage_failure_rolls_back_deletes_and_status(setup, monkeypatch):
    client, db_path = setup
    request_id = create_request(client)
    specify(client, request_id)
    before = discover(client, request_id).json()
    original = models.replace_candidates

    def fail_after_replacement(connection, request_id, results, now):
        original(connection, request_id, results, now)
        raise RuntimeError("Mock storage failure")

    monkeypatch.setattr(models, "replace_candidates", fail_after_replacement)
    service = DiscoveryService(lambda: connection_factory(db_path))
    with pytest.raises(RuntimeError, match="storage failure"):
        service.discover(request_id, owner_user_id=OWNER_USER_ID)
    assert client.get(f"/api/manufacturing-requests/{request_id}/candidates", headers=ADMIN).json() == before


def test_empty_provider_results_are_a_clear_completed_discovery(setup):
    class EmptyProvider:
        def discover(self, specification):
            return []

    client, db_path = setup
    request_id = create_request(client)
    specify(client, request_id)
    discover(client, request_id)
    service = DiscoveryService(lambda: connection_factory(db_path), provider=EmptyProvider())
    assert service.discover(request_id, owner_user_id=OWNER_USER_ID) == {"request_id": request_id, "status": "DISCOVERY_COMPLETE",
                                           "provider": "MOCK_PUBLIC_DATA", "candidates": []}
    with sqlite3.connect(db_path) as connection:
        assert connection.execute("SELECT COUNT(*) FROM public_capacity_profiles").fetchone() == (0,)


def test_future_taxonomy_is_stored_without_inventing_a_capability(setup):
    client, _ = setup
    request_id = create_request(client)
    payload = {"process": ["future_process"], "materials": ["future_material"]}
    assert specify(client, request_id, payload).status_code == 201
    result = discover(client, request_id).json()
    assert result["status"] == "DISCOVERY_COMPLETE"
    assert result["candidates"] == []


def test_direct_specification_validation_rejects_nonfinite_json():
    with pytest.raises(ValueError, match="finite JSON"):
        ManufacturingSpecificationPayload.model_validate({**SPECIFICATION, "future_field": float("nan")})


@pytest.mark.parametrize("value", [float("nan"), float("inf"), -float("inf")])
def test_nonfinite_specification_json_returns_422_without_mutation(setup, value):
    client, db_path = setup
    request_id = create_request(client)
    response = client.post(f"/api/manufacturing-requests/{request_id}/specification", headers={
        **ADMIN, "Content-Type": "application/json",
    }, content=json.dumps({**SPECIFICATION, "future_field": value}))
    assert response.status_code == 422
    assert all("input" not in error and "ctx" not in error for error in response.json()["detail"])
    with sqlite3.connect(db_path) as connection:
        assert connection.execute("SELECT COUNT(*) FROM manufacturing_specifications").fetchone() == (0,)
        assert connection.execute("SELECT status FROM manufacturing_requests").fetchone() == ("DRAFT",)


def test_nonfinite_quantity_is_rejected_without_echoing_user_input(setup):
    response = setup[0].post("/api/manufacturing-requests", headers={**ADMIN, "Content-Type": "application/json"},
                             content=json.dumps({**REQUEST, "quantity": float("nan")}))
    assert response.status_code == 422
    assert all("input" not in error for error in response.json()["detail"])
