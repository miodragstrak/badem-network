import hashlib
import sqlite3
import time
from concurrent.futures import ThreadPoolExecutor

import pytest
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from fastapi.testclient import TestClient

from backend.app import create_app
from backend.proofs import ProductionProof, canonical_message


def signed_proof(key, reference_job_id, **changes):
    payload = {
        "node_id": "BADEM-001", "job_id": reference_job_id, "event": "COMPLETED",
        "timestamp": int(time.time()), "proof_hash": hashlib.sha256(b"test completion").hexdigest(),
        "public_key": key.public_key().public_bytes_raw().hex(),
    }
    payload.update(changes)
    message = "|".join(str(payload[field]) for field in (
        "node_id", "job_id", "event", "timestamp", "proof_hash",
    )).encode("utf-8")
    payload["signature"] = key.sign(message).hex()
    return payload


@pytest.fixture
def proof_setup(tmp_path, monkeypatch):
    monkeypatch.delenv("BADEM_NODE_ID", raising=False)
    monkeypatch.delenv("BADEM_NODE_PUBLIC_KEY", raising=False)
    key = Ed25519PrivateKey.generate()
    db_path = tmp_path / "test.db"
    client = TestClient(create_app(
        str(db_path), "admin", "laser-01", "test-secret", "BADEM-001",
        key.public_key().public_bytes_raw().hex(),
    ))
    response = client.post("/jobs", headers={"X-Admin-Key": "admin"}, json={
        "title": "proof demo", "machine_id": "laser-01", "file_sha256": "a" * 64,
    })
    assert response.status_code == 201
    return client, key, db_path, response.json()["job_id"]


def assert_rejected(setup, payload, status_code, initial_status="CREATED"):
    client, _, db_path, job_id = setup
    response = client.post("/api/proofs", json=payload)
    assert response.status_code == status_code, response.text
    result = client.get(f"/jobs/{job_id}", headers={"X-Admin-Key": "admin"}).json()
    assert result["job"]["status"] == initial_status
    with sqlite3.connect(db_path) as connection:
        assert connection.execute("SELECT COUNT(*) FROM production_proofs").fetchone()[0] == 0


def test_canonical_message_has_exact_documented_bytes():
    key = Ed25519PrivateKey.generate()
    proof = ProductionProof(**signed_proof(
        key, "JOB-0042", timestamp=1760000000, proof_hash="a" * 64,
    ))
    assert canonical_message(proof) == b"BADEM-001|JOB-0042|COMPLETED|1760000000|" + b"a" * 64


def test_valid_proof_is_persisted_and_changes_job_state(proof_setup):
    client, key, db_path, job_id = proof_setup
    payload = signed_proof(key, job_id)
    response = client.post("/api/proofs", json=payload)
    assert response.status_code == 201
    accepted = response.json()
    assert accepted["status"] == "PROOF_RECEIVED"
    assert accepted["signature_verified"] is True
    assert accepted["chain"] == "NOT_CONNECTED"
    assert accepted["buyer_confirmation"] == "NOT_IMPLEMENTED"
    result = client.get(f"/jobs/{job_id}", headers={"X-Admin-Key": "admin"}).json()
    assert result["job"]["status"] == "PROOF_RECEIVED"
    assert result["events"] == []
    assert set(result) == {"job", "events", "buyer_confirmation", "chain"}
    with sqlite3.connect(db_path) as connection:
        connection.row_factory = sqlite3.Row
        stored = connection.execute("SELECT * FROM production_proofs").fetchone()
        assert stored["proof_id"] == accepted["proof_id"]
        for field, value in payload.items():
            assert stored[field] == value
        assert stored["canonical_message"] == canonical_message(ProductionProof(**payload)).decode()
        assert stored["received_at"] >= payload["timestamp"]


def test_demo_endpoint_reports_verified_proof_without_creating_an_anchor(proof_setup):
    client, key, db_path, job_id = proof_setup
    payload = signed_proof(key, job_id)
    accepted = client.post("/api/proofs", json=payload)
    assert accepted.status_code == 201
    response = client.get(f"/api/demo/jobs/{job_id}", headers={"X-Admin-Key": "admin"})
    assert response.status_code == 200
    result = response.json()
    assert result["job"]["status"] == "PROOF_RECEIVED"
    assert result["proof"]["proof_id"] == accepted.json()["proof_id"]
    for field in ("node_id", "job_id", "event", "timestamp", "proof_hash"):
        assert result["proof"][field] == payload[field]
    assert result["proof"]["received_at"] >= payload["timestamp"]
    assert result["anchor"] == {
        "proof_id": accepted.json()["proof_id"], "status": "NOT_ANCHORED", "chain": "NOT_CONFIRMED",
    }
    with sqlite3.connect(db_path) as connection:
        assert connection.execute("SELECT COUNT(*) FROM proof_anchors").fetchone()[0] == 0
        assert connection.execute("SELECT status FROM jobs WHERE id=?", (job_id,)).fetchone()[0] == "PROOF_RECEIVED"


def test_invalid_signature_is_rejected_without_side_effects(proof_setup):
    _, key, _, job_id = proof_setup
    payload = signed_proof(key, job_id)
    signature = bytearray.fromhex(payload["signature"])
    signature[0] ^= 1
    payload["signature"] = signature.hex()
    assert_rejected(proof_setup, payload, 401)


@pytest.mark.parametrize("field,value", [
    ("public_key", "z" * 64), ("public_key", "a" * 62),
    ("public_key", "a" * 66), ("public_key", "a" * 64 + "\n"),
    ("signature", "z" * 128), ("signature", "a" * 126),
    ("signature", "a" * 130), ("signature", "a" * 128 + "\n"),
])
def test_malformed_keys_and_signatures_are_rejected(proof_setup, field, value):
    _, key, _, job_id = proof_setup
    payload = signed_proof(key, job_id)
    payload[field] = value
    assert_rejected(proof_setup, payload, 422)


@pytest.mark.parametrize("field", [
    "node_id", "job_id", "event", "timestamp", "proof_hash", "public_key", "signature",
])
def test_every_payload_field_is_required(proof_setup, field):
    _, key, _, job_id = proof_setup
    payload = signed_proof(key, job_id)
    del payload[field]
    assert_rejected(proof_setup, payload, 422)


def test_unknown_job_is_rejected(proof_setup):
    _, key, _, _ = proof_setup
    assert_rejected(proof_setup, signed_proof(key, "JOB-UNKNOWN"), 404)


@pytest.mark.parametrize("event", ["STARTED", "FINISHED", "ERROR"])
def test_unsupported_event_is_rejected(proof_setup, event):
    _, key, _, job_id = proof_setup
    assert_rejected(proof_setup, signed_proof(key, job_id, event=event), 422)


def test_unknown_node_cannot_use_a_registered_key(proof_setup):
    _, key, _, job_id = proof_setup
    assert_rejected(proof_setup, signed_proof(key, job_id, node_id="BADEM-OTHER"), 403)


def test_caller_supplied_key_is_not_a_trusted_identity(proof_setup):
    _, _, _, job_id = proof_setup
    attacker_key = Ed25519PrivateKey.generate()
    assert_rejected(proof_setup, signed_proof(attacker_key, job_id), 403)


def test_node_cannot_submit_for_another_machine(proof_setup):
    client, key, _, _ = proof_setup
    response = client.post("/jobs", headers={"X-Admin-Key": "admin"}, json={
        "title": "other machine", "machine_id": "laser-02", "file_sha256": "b" * 64,
    })
    assert response.status_code == 201
    other_job_id = response.json()["job_id"]
    assert_rejected(proof_setup, signed_proof(key, other_job_id), 403)
    assert client.get(f"/jobs/{other_job_id}", headers={"X-Admin-Key": "admin"}).json()[
        "job"
    ]["status"] == "CREATED"


def test_duplicate_combination_is_rejected_even_with_a_new_signature(proof_setup):
    client, key, db_path, job_id = proof_setup
    original = signed_proof(key, job_id)
    assert client.post("/api/proofs", json=original).status_code == 201
    changed = signed_proof(key, job_id, timestamp=original["timestamp"] + 1, proof_hash="b" * 64)
    assert client.post("/api/proofs", json=changed).status_code == 409
    with sqlite3.connect(db_path) as connection:
        assert connection.execute("SELECT signature FROM production_proofs").fetchall() == [
            (original["signature"],)
        ]


def test_concurrent_duplicate_submissions_are_serialized(proof_setup):
    client, key, db_path, job_id = proof_setup
    payload = signed_proof(key, job_id)
    with ThreadPoolExecutor(max_workers=2) as executor:
        responses = list(executor.map(lambda _: client.post("/api/proofs", json=payload), range(2)))
    assert sorted(response.status_code for response in responses) == [201, 409]
    with sqlite3.connect(db_path) as connection:
        assert connection.execute("SELECT COUNT(*) FROM production_proofs").fetchone()[0] == 1


@pytest.mark.parametrize("status", ["RUNNING", "AWAITING_BUYER"])
def test_proof_extends_existing_successful_lifecycle_states(proof_setup, status):
    client, key, db_path, job_id = proof_setup
    with sqlite3.connect(db_path) as connection:
        connection.execute("UPDATE jobs SET status=? WHERE id=?", (status, job_id))
    assert client.post("/api/proofs", json=signed_proof(key, job_id)).status_code == 201
    assert client.get(f"/jobs/{job_id}", headers={"X-Admin-Key": "admin"}).json()[
        "job"
    ]["status"] == "PROOF_RECEIVED"


@pytest.mark.parametrize("status", ["FAILED", "ABORTED"])
def test_proof_cannot_overwrite_failed_or_aborted_jobs(proof_setup, status):
    _, key, db_path, job_id = proof_setup
    with sqlite3.connect(db_path) as connection:
        connection.execute("UPDATE jobs SET status=? WHERE id=?", (status, job_id))
    assert_rejected(proof_setup, signed_proof(key, job_id), 409, initial_status=status)


@pytest.mark.parametrize("timestamp", [-1, 2**63, True, "1760000000", 1760000000.5])
def test_timestamp_must_be_an_unsigned_sqlite_integer(proof_setup, timestamp):
    _, key, _, job_id = proof_setup
    assert_rejected(proof_setup, signed_proof(key, job_id, timestamp=timestamp), 422)


@pytest.mark.parametrize("field,value", [
    ("node_id", "BADEM|001"), ("node_id", "BADEM-001\n"),
    ("job_id", "JOB|0042"), ("job_id", "JOB-0042\n"),
    ("proof_hash", "0" * 63), ("proof_hash", "O" * 44),
    ("proof_hash", "a" * 64 + "\n"),
])
def test_ambiguous_identifiers_and_malformed_hashes_are_rejected(proof_setup, field, value):
    _, key, _, job_id = proof_setup
    assert_rejected(proof_setup, signed_proof(key, job_id, **{field: value}), 422)


@pytest.mark.parametrize("proof_hash", ["AB" * 32, "1" * 32, "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijk"])
def test_hex_and_base58_hash_text_is_signed_without_normalization(proof_setup, proof_hash):
    client, key, _, job_id = proof_setup
    payload = signed_proof(key, job_id, proof_hash=proof_hash)
    assert canonical_message(ProductionProof(**payload)).endswith(proof_hash.encode())
    assert client.post("/api/proofs", json=payload).status_code == 201


@pytest.mark.parametrize("field,value", [("timestamp", 1760000000), ("proof_hash", "b" * 64)])
def test_tampered_signed_fields_are_rejected(proof_setup, field, value):
    _, key, _, job_id = proof_setup
    payload = signed_proof(key, job_id)
    payload[field] = value
    assert_rejected(proof_setup, payload, 401)


def test_additional_hidden_fields_are_rejected(proof_setup):
    _, key, _, job_id = proof_setup
    payload = signed_proof(key, job_id)
    payload["hidden_nonce"] = "unexpected"
    assert_rejected(proof_setup, payload, 422)


def test_json_field_order_is_not_part_of_the_signature(proof_setup):
    client, key, _, job_id = proof_setup
    payload = signed_proof(key, job_id)
    assert client.post("/api/proofs", json=dict(reversed(list(payload.items())))).status_code == 201


def test_transport_hex_case_does_not_change_the_signed_message(proof_setup):
    client, key, _, job_id = proof_setup
    payload = signed_proof(key, job_id)
    payload["public_key"] = payload["public_key"].upper()
    payload["signature"] = payload["signature"].upper()
    assert client.post("/api/proofs", json=payload).status_code == 201


def test_delayed_proof_timestamp_is_accepted_when_correctly_signed(proof_setup):
    client, key, _, job_id = proof_setup
    payload = signed_proof(key, job_id, timestamp=1760000000)
    assert client.post("/api/proofs", json=payload).status_code == 201


def test_proof_endpoint_is_disabled_without_an_expected_public_key(tmp_path, monkeypatch):
    monkeypatch.delenv("BADEM_NODE_PUBLIC_KEY", raising=False)
    key = Ed25519PrivateKey.generate()
    client = TestClient(create_app(str(tmp_path / "test.db"), "admin", "laser-01", "test-secret"))
    assert client.get("/health").status_code == 200
    assert client.post("/api/proofs", json=signed_proof(key, "JOB-0042")).status_code == 403


def test_public_key_registration_can_use_environment_configuration(tmp_path, monkeypatch):
    key = Ed25519PrivateKey.generate()
    monkeypatch.setenv("BADEM_NODE_ID", "BADEM-001")
    monkeypatch.setenv("BADEM_NODE_PUBLIC_KEY", key.public_key().public_bytes_raw().hex().upper())
    client = TestClient(create_app(str(tmp_path / "test.db"), "admin", "laser-01", "test-secret"))
    job = client.post("/jobs", headers={"X-Admin-Key": "admin"}, json={
        "title": "registered node", "machine_id": "laser-01", "file_sha256": "a" * 64,
    })
    payload = signed_proof(key, job.json()["job_id"])
    assert client.post("/api/proofs", json=payload).status_code == 201


def test_malformed_registered_public_key_fails_startup(tmp_path, monkeypatch):
    monkeypatch.setenv("BADEM_NODE_PUBLIC_KEY", "not-a-key")
    with pytest.raises(RuntimeError, match="BADEM_NODE_PUBLIC_KEY"):
        create_app(str(tmp_path / "test.db"), "admin", "laser-01", "test-secret")


def test_existing_database_can_gain_a_proof_table_without_changing_job_records(proof_setup):
    _, key, db_path, job_id = proof_setup
    with sqlite3.connect(db_path) as connection:
        connection.execute("DROP TABLE production_proofs")
        original_job = connection.execute("SELECT * FROM jobs WHERE id=?", (job_id,)).fetchone()
    client = TestClient(create_app(
        str(db_path), "admin", "laser-01", "test-secret", "BADEM-001",
        key.public_key().public_bytes_raw().hex(),
    ))
    with sqlite3.connect(db_path) as connection:
        assert connection.execute("SELECT * FROM jobs WHERE id=?", (job_id,)).fetchone() == original_job
    assert client.post("/api/proofs", json=signed_proof(key, job_id)).status_code == 201


def test_duplicate_proof_remains_rejected_after_restart(proof_setup):
    client, key, db_path, job_id = proof_setup
    payload = signed_proof(key, job_id)
    assert client.post("/api/proofs", json=payload).status_code == 201
    restarted = TestClient(create_app(
        str(db_path), "admin", "laser-01", "test-secret", "BADEM-001",
        key.public_key().public_bytes_raw().hex(),
    ))
    assert restarted.post("/api/proofs", json=payload).status_code == 409
    assert restarted.get(f"/jobs/{job_id}", headers={"X-Admin-Key": "admin"}).json()[
        "job"
    ]["status"] == "PROOF_RECEIVED"
