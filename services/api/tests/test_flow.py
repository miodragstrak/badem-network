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


def test_demo_endpoint_requires_admin_and_rejects_unknown_jobs(tmp_path):
    with TestClient(create_app(str(tmp_path / "test.db"), "admin", "laser-01", "test-secret")) as client:
        path = "/api/demo/jobs/unknown"
        assert client.get(path).status_code == 401
        assert client.get(path, headers={"X-Admin-Key": "wrong"}).status_code == 401
        assert client.get(path, headers={"X-Admin-Key": "admin"}).status_code == 404


def test_demo_endpoint_reports_machine_events_without_changing_job_state(tmp_path):
    with TestClient(create_app(str(tmp_path / "test.db"), "admin", "laser-01", "test-secret")) as client:
        headers = {"X-Admin-Key": "admin"}
        job_id = client.post("/jobs", headers=headers, json={
            "title": "demo", "machine_id": "laser-01", "file_sha256": "a" * 64,
        }).json()["job_id"]
        for event, status in ((None, "CREATED"), ("STARTED", "RUNNING"), ("FINISHED", "AWAITING_BUYER")):
            if event is not None:
                assert signed_event(client, job_id, 1 if event == "STARTED" else 2, event).status_code == 201
            before = client.get(f"/jobs/{job_id}", headers=headers).json()
            response = client.get(f"/api/demo/jobs/{job_id}", headers=headers)
            assert response.status_code == 200
            result = response.json()
            assert result["job"] == before["job"]
            assert result["job"]["status"] == status
            assert result["events"] == before["events"]
            assert result["proof"] is None
            assert result["anchor"] is None
            assert result["buyer_confirmation"] == "NOT_IMPLEMENTED"
            assert client.get(f"/jobs/{job_id}", headers=headers).json() == before
