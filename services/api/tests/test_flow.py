import hashlib
import hmac
import json
import time
import uuid

from fastapi.testclient import TestClient

from backend.app import create_app


def signed_event(client, job_id, sequence, kind, secret="test-secret", event_id=None,
                 machine_id="laser-01"):
    body = json.dumps({"event_id": event_id or str(uuid.uuid4()), "job_id": job_id,
                       "machine_id": machine_id, "sequence": sequence,
                       "event_type": kind, "observed_at": int(time.time())},
                      separators=(",", ":")).encode()
    return client.post("/machine-events", content=body, headers={
        "Content-Type": "application/json", "X-Device-Id": "laser-01",
        "X-Signature": hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()})


def test_machine_run_requires_authenticated_ordered_events(tmp_path):
    client = TestClient(create_app(str(tmp_path / "test.db"), "admin", "laser-01", "test-secret"))
    assert client.post("/jobs", json={"title": "x", "machine_id": "laser-01",
                    "file_sha256": "a" * 64}).status_code == 401
    response = client.post("/jobs", headers={"X-Admin-Key": "admin"}, json={
        "title": "demo", "machine_id": "laser-01", "file_sha256": "a" * 64})
    assert response.status_code == 201
    job_id = response.json()["job_id"]
    assert signed_event(client, job_id, 1, "FINISHED").status_code == 409
    assert signed_event(client, job_id, 1, "STARTED", secret="wrong").status_code == 401
    assert signed_event(client, job_id, 1, "STARTED").json()["status"] == "RUNNING"
    assert signed_event(client, job_id, 3, "FINISHED").status_code == 409
    assert signed_event(client, job_id, 2, "HEARTBEAT").status_code == 201
    assert signed_event(client, job_id, 3, "FINISHED").json()["status"] == "AWAITING_BUYER"
    assert signed_event(client, job_id, 4, "HEARTBEAT").status_code == 409
    result = client.get(f"/jobs/{job_id}", headers={"X-Admin-Key": "admin"}).json()
    assert len(result["events"]) == 3
    assert result["buyer_confirmation"] == "NOT_IMPLEMENTED"
    assert result["chain"] == "NOT_CONNECTED"


def test_duplicate_event_is_rejected(tmp_path):
    client = TestClient(create_app(str(tmp_path / "test.db"), "admin", "laser-01", "test-secret"))
    job_id = client.post("/jobs", headers={"X-Admin-Key": "admin"}, json={
        "title": "demo", "machine_id": "laser-01", "file_sha256": "b" * 64}).json()["job_id"]
    event_id = str(uuid.uuid4())
    assert signed_event(client, job_id, 1, "STARTED", event_id=event_id).status_code == 201
    assert signed_event(client, job_id, 1, "STARTED", event_id=event_id).status_code == 409
