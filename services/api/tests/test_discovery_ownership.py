"""Discovery ownership is enforced in SQLite, after the trusted admin boundary."""

import json
import sqlite3

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

from backend.app import SCHEMA as PROOF_SCHEMA, create_app
from backend.discovery import models
from backend.discovery.mock_provider import MockDiscoveryProvider
from backend.discovery.schemas import ManufacturingSpecificationPayload
from backend.discovery.service import DiscoveryService
from test_discovery import (
    ADMIN, OWNER_USER_ID, REQUEST, SPECIFICATION, connection_factory, create_request,
    discover, setup, specify,
)

OTHER_USER_ID = "b07127c3-7a8e-44da-b43f-a5fdd2b83d21"
OTHER = {"X-Admin-Key": "admin", "X-BADEM-User-Id": OTHER_USER_ID}
TABLES = ("manufacturing_requests", "manufacturing_specifications", "partner_candidates", "public_capacity_profiles")


def request_operations(request_id, candidate_id):
    return [
        ("GET", f"/api/manufacturing-requests/{request_id}", None),
        ("POST", f"/api/manufacturing-requests/{request_id}/specification", SPECIFICATION),
        ("GET", f"/api/manufacturing-requests/{request_id}/specification", None),
        ("POST", f"/api/manufacturing-requests/{request_id}/discover", None),
        ("GET", f"/api/manufacturing-requests/{request_id}/candidates", None),
        ("GET", f"/api/partner-candidates/{candidate_id}", None),
    ]


def snapshot(db_path):
    with sqlite3.connect(db_path) as connection:
        return {table: connection.execute(f"SELECT * FROM {table} ORDER BY id").fetchall() for table in TABLES}


def test_owner_can_use_all_resources_and_cannot_read_another_users_data(setup, monkeypatch):
    client, db_path = setup
    first_id = create_request(client)
    first = client.get(f"/api/manufacturing-requests/{first_id}", headers=ADMIN)
    assert first.status_code == 200
    assert first.json()["owner_user_id"] == OWNER_USER_ID
    assert specify(client, first_id).status_code == 201
    result = discover(client, first_id)
    assert result.status_code == 200
    candidate_id = result.json()["candidates"][0]["candidate_id"]
    for method, path, payload in request_operations(first_id, candidate_id):
        response = client.request(method, path, headers=ADMIN, json=payload)
        assert response.status_code == 200, response.text

    other = client.post("/api/manufacturing-requests", headers=OTHER, json=REQUEST)
    assert other.status_code == 201
    other_id = other.json()["id"]
    assert other.json()["owner_user_id"] == OTHER_USER_ID
    assert client.get(f"/api/manufacturing-requests/{other_id}", headers=OTHER).status_code == 200
    assert client.get(f"/api/manufacturing-requests/{other_id}", headers=ADMIN).status_code == 404

    def forbidden_provider(*args):
        raise AssertionError("A foreign request must not invoke the discovery provider")

    monkeypatch.setattr(MockDiscoveryProvider, "discover", forbidden_provider)
    before = snapshot(db_path)
    for method, path, payload in request_operations(first_id, candidate_id):
        response = client.request(method, path, headers=OTHER, json=payload)
        assert response.status_code == 404, response.text
        missing = path.replace(first_id, "unknown").replace(candidate_id, "unknown")
        assert response.json() == client.request(method, missing, headers=OTHER, json=payload).json()
    assert snapshot(db_path) == before


@pytest.mark.parametrize("identity", [
    None, "", "not-a-uuid", OWNER_USER_ID.replace("-", ""), f" {OWNER_USER_ID}",
    f"{OWNER_USER_ID},{OTHER_USER_ID}", f"urn:uuid:{OWNER_USER_ID}",
])
def test_admin_without_one_valid_internal_user_cannot_access_discovery(setup, identity):
    client, db_path = setup
    headers = {"X-Admin-Key": "admin"}
    if identity is not None:
        headers["X-BADEM-User-Id"] = identity
    for method, path, payload in [
        ("POST", "/api/manufacturing-requests", REQUEST),
        *request_operations("unknown", "unknown"),
    ]:
        response = client.request(method, path, headers=headers, json=payload)
        assert response.status_code == 401
    assert snapshot(db_path)["manufacturing_requests"] == []


@pytest.mark.parametrize("admin", [None, "wrong"])
def test_internal_identity_is_never_trusted_without_admin_authentication(setup, admin):
    client, db_path = setup
    headers = {"X-BADEM-User-Id": OWNER_USER_ID}
    if admin is not None:
        headers["X-Admin-Key"] = admin
    for method, path, payload in [
        ("POST", "/api/manufacturing-requests", REQUEST),
        *request_operations("unknown", "unknown"),
    ]:
        assert client.request(method, path, headers=headers, json=payload).status_code == 401
    assert snapshot(db_path)["manufacturing_requests"] == []


def test_duplicate_internal_identity_is_rejected_and_uuid_is_canonicalized(setup):
    client, _ = setup
    response = client.post("/api/manufacturing-requests", json=REQUEST, headers=[
        ("X-Admin-Key", "admin"), ("X-BADEM-User-Id", OWNER_USER_ID), ("x-badem-user-id", OTHER_USER_ID),
    ])
    assert response.status_code == 401
    response = client.post("/api/manufacturing-requests", json=REQUEST,
                           headers={**ADMIN, "X-BADEM-User-Id": OWNER_USER_ID.upper()})
    assert response.status_code == 201
    assert response.json()["owner_user_id"] == OWNER_USER_ID
    assert client.get(f"/api/manufacturing-requests/{response.json()['id']}", headers=ADMIN).status_code == 200


def test_client_cannot_choose_or_transfer_owner_in_payload_or_query(setup):
    client, db_path = setup
    response = client.post("/api/manufacturing-requests", headers=ADMIN,
                           json={**REQUEST, "owner_user_id": OTHER_USER_ID})
    assert response.status_code == 422
    assert snapshot(db_path)["manufacturing_requests"] == []
    # Query metadata cannot override the trusted identity either.
    response = client.post(f"/api/manufacturing-requests?owner_user_id={OTHER_USER_ID}", headers=ADMIN, json=REQUEST)
    assert response.status_code == 201
    request_id = response.json()["id"]
    assert response.json()["owner_user_id"] == OWNER_USER_ID
    assert specify(client, request_id, {**SPECIFICATION, "owner_user_id": OTHER_USER_ID}).status_code == 422
    assert client.get(f"/api/manufacturing-requests/{request_id}?owner_user_id={OWNER_USER_ID}", headers=OTHER).status_code == 404
    assert client.get(f"/api/manufacturing-requests/{request_id}", headers=ADMIN).json()["owner_user_id"] == OWNER_USER_ID


def test_owned_records_and_candidate_authorization_survive_restart(setup):
    client, db_path = setup
    request_id = create_request(client)
    specify(client, request_id)
    candidate = discover(client, request_id).json()["candidates"][0]["candidate_id"]
    before = snapshot(db_path)
    with TestClient(create_app(str(db_path), "admin", "laser-01", "test-secret")) as restarted:
        assert restarted.get(f"/api/manufacturing-requests/{request_id}", headers=ADMIN).json()["owner_user_id"] == OWNER_USER_ID
        assert restarted.get(f"/api/partner-candidates/{candidate}", headers=ADMIN).status_code == 200
        for method, path, payload in request_operations(request_id, candidate):
            assert restarted.request(method, path, headers=OTHER, json=payload).status_code == 404
    assert snapshot(db_path) == before


def test_service_checks_ownership_before_provider_and_again_before_persisting(setup):
    client, db_path = setup
    request_id = create_request(client)
    specify(client, request_id)
    before = discover(client, request_id).json()
    service = DiscoveryService(lambda: connection_factory(db_path))
    payload = ManufacturingSpecificationPayload.model_validate(SPECIFICATION)
    candidate_id = before["candidates"][0]["candidate_id"]
    for operation in [
        lambda: service.get_request(request_id, owner_user_id=OTHER_USER_ID),
        lambda: service.store_specification(request_id, payload, owner_user_id=OTHER_USER_ID),
        lambda: service.get_specification(request_id, owner_user_id=OTHER_USER_ID),
        lambda: service.discover(request_id, owner_user_id=OTHER_USER_ID),
        lambda: service.get_candidates(request_id, owner_user_id=OTHER_USER_ID),
        lambda: service.get_candidate(candidate_id, owner_user_id=OTHER_USER_ID),
    ]:
        with pytest.raises(HTTPException) as error:
            operation()
        assert error.value.status_code == 404

    class ChangedOwnerProvider:
        def discover(self, specification):
            with sqlite3.connect(db_path, timeout=.1) as connection:
                connection.execute("UPDATE manufacturing_requests SET owner_user_id=? WHERE id=?",
                                   (OTHER_USER_ID, request_id))
            return MockDiscoveryProvider().discover(specification)

    service.provider = ChangedOwnerProvider()
    rows = snapshot(db_path)
    with pytest.raises(HTTPException) as error:
        service.discover(request_id, owner_user_id=OWNER_USER_ID)
    assert error.value.status_code == 404
    after = snapshot(db_path)
    for table in TABLES[1:]:
        assert after[table] == rows[table]
    assert service.get_candidates(request_id, owner_user_id=OTHER_USER_ID) == before


def test_additive_legacy_migration_preserves_rows_and_denies_ownerless_resources(tmp_path):
    db_path = tmp_path / "legacy.sqlite"
    request_id, candidate_id = "legacy-request", "legacy-candidate"
    with sqlite3.connect(db_path) as connection:
        connection.executescript(PROOF_SCHEMA)
        connection.execute("""CREATE TABLE manufacturing_requests (
            id TEXT PRIMARY KEY, title TEXT NOT NULL, description TEXT NOT NULL,
            location_text TEXT, quantity INTEGER, status TEXT NOT NULL, created_at INTEGER NOT NULL
        )""")
        for statement in models.SCHEMA[1:]:
            connection.execute(statement)
        connection.execute("INSERT INTO manufacturing_requests VALUES(?,?,?,?,?,?,?)",
                           (request_id, "Legacy request", "Existing public-data discovery", None, 1, "DISCOVERY_COMPLETE", 1000))
        connection.execute("INSERT INTO manufacturing_specifications VALUES(?,?,?,?)",
                           ("legacy-spec", request_id, json.dumps(SPECIFICATION), 1000))
        connection.execute("INSERT INTO partner_candidates VALUES(?,?,?,?,?,?)",
                           (candidate_id, models.MOCK_SOURCE, "legacy-place", request_id, 1000, 1000))
        connection.execute("INSERT INTO public_capacity_profiles VALUES(?,?,?,?,?,?,?,?)",
                           ("legacy-profile", candidate_id, '{"legacy":"retained"}', 10, "Low-confidence fit", "low", models.VERIFICATION_STATUS, 1000))
        connection.execute("INSERT INTO jobs(id,machine_id,title,file_sha256,created_at) VALUES(?,?,?,?,?)",
                           ("legacy-job", "laser-01", "Existing Proof demo job", "a" * 64, 1000))
        original = {table: connection.execute(f"SELECT * FROM {table}").fetchall() for table in TABLES}
        proof_rows = connection.execute("SELECT * FROM jobs").fetchall()
    for _ in range(2):
        with TestClient(create_app(str(db_path), "admin", "laser-01", "test-secret")) as client:
            for headers in [ADMIN, OTHER]:
                for method, path, payload in request_operations(request_id, candidate_id):
                    assert client.request(method, path, headers=headers, json=payload).status_code == 404
            # The internal identity is discovery-only; admin Proof/job reads still work.
            assert client.get("/jobs/legacy-job", headers={"X-Admin-Key": "admin"}).status_code == 200
            assert client.get("/api/demo/jobs/legacy-job", headers={"X-Admin-Key": "admin"}).status_code == 200
        with sqlite3.connect(db_path) as connection:
            columns = [row[1] for row in connection.execute("PRAGMA table_info(manufacturing_requests)")]
            assert columns.count("owner_user_id") == 1
            assert connection.execute("SELECT * FROM manufacturing_requests").fetchall() == [(*original["manufacturing_requests"][0], None)]
            for table in TABLES[1:]:
                assert connection.execute(f"SELECT * FROM {table}").fetchall() == original[table]
            assert connection.execute("SELECT * FROM jobs").fetchall() == proof_rows
            assert connection.execute("PRAGMA foreign_key_check").fetchall() == []
