import base64
from concurrent.futures import ThreadPoolExecutor
import hashlib
import json
import sqlite3
import threading

from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from fastapi.testclient import TestClient
import httpx
import pytest
from solders.hash import Hash
from solders.keypair import Keypair
from solders.transaction import Transaction

from backend.app import create_app
from backend.proofs import ProductionProof, canonical_message
from backend.solana_anchor import (
    ANCHOR_PREFIX, DEVNET_GENESIS_HASH, MEMO_PREFIX, MEMO_PROGRAM_ID,
    AnchorConfigurationError, SolanaAnchorService, anchor_hash,
    canonical_anchor_payload, explorer_url,
)


ADMIN = {"X-Admin-Key": "admin"}


@pytest.fixture(autouse=True)
def isolate_environment_and_network(monkeypatch):
    for name in ("SOLANA_RPC_URL", "SOLANA_PAYER_PRIVATE_KEY", "SOLANA_CLUSTER"):
        monkeypatch.delenv(name, raising=False)

    def block_network(*args, **kwargs):
        raise AssertionError("Automated anchor tests must never contact a real RPC")

    monkeypatch.setattr(httpx.HTTPTransport, "handle_request", block_network)


class MockSolanaRPC:
    def __init__(self):
        self.calls = []
        self.sent = []
        self.transactions = {}
        self.level = "finalized"
        self.execution_error = None
        self.fail_method = None
        self.malformed_method = None
        self.wrong_send_signature = False
        self.bad_blockhash = False
        self.lose_send_response = False
        self.hide_status = False
        self.genesis = DEVNET_GENESIS_HASH
        self.height = 100
        self.prepare_barrier = None

    def __call__(self, request):
        body = json.loads(request.content)
        method, params = body["method"], body["params"]
        self.calls.append(method)
        if method == self.malformed_method:
            return httpx.Response(200, json={"jsonrpc": "2.0", "id": 1, "result": None})
        if method == self.fail_method:
            return httpx.Response(200, json={"id": 1, "error": {
                "code": -32000, "message": "secret RPC detail must not be returned",
            }})
        if method == "getGenesisHash":
            result = self.genesis
        elif method == "getLatestBlockhash":
            blockhash = "invalid-blockhash" if self.bad_blockhash else str(Hash.new_unique())
            result = {"value": {"blockhash": blockhash, "lastValidBlockHeight": 150}}
            if self.prepare_barrier:
                self.prepare_barrier.wait(timeout=5)
        elif method == "getBlockHeight":
            assert params == [{"commitment": "finalized"}]
            result = self.height
        elif method == "sendTransaction":
            assert params[1] == {"encoding": "base64", "skipPreflight": False,
                "preflightCommitment": "confirmed", "maxRetries": 3}
            transaction = Transaction.from_bytes(base64.b64decode(params[0]))
            transaction.verify()
            self.sent.append(params[0])
            signature = str(transaction.signatures[0])
            self.transactions[signature] = transaction
            if self.lose_send_response:
                self.lose_send_response = False
                raise httpx.ReadTimeout("Lost sendTransaction response", request=request)
            result = str(Keypair().sign_message(b"unrelated test signature")) if self.wrong_send_signature else signature
        elif method == "getSignatureStatuses":
            assert params[1] == {"searchTransactionHistory": True}
            signature = params[0][0]
            status = None
            if signature in self.transactions and not self.hide_status:
                status = {"err": self.execution_error, "confirmationStatus": self.level}
            result = {"value": [status]}
        else:
            raise AssertionError(f"Unexpected RPC method: {method}")
        return httpx.Response(200, json={"jsonrpc": "2.0", "id": 1, "result": result})


@pytest.fixture
def anchor_setup(tmp_path):
    rpc = MockSolanaRPC()
    service = SolanaAnchorService("https://rpc.invalid", Keypair(),
        transport=httpx.MockTransport(rpc), confirmation_attempts=2, poll_interval=0)
    key = Ed25519PrivateKey.generate()
    db_path = tmp_path / "test.db"
    client = TestClient(create_app(str(db_path), "admin", "laser-01", "test-secret",
        "BADEM-001", key.public_key().public_bytes_raw().hex(), service))
    job_id = client.post("/jobs", headers=ADMIN, json={
        "machine_id": "laser-01", "title": "anchor demo", "file_sha256": "a" * 64,
    }).json()["job_id"]
    proof = ProductionProof(node_id="BADEM-001", job_id=job_id, event="COMPLETED",
        timestamp=1760000000, proof_hash="EF" * 32,
        public_key=key.public_key().public_bytes_raw().hex(), signature="0" * 128)
    proof.signature = key.sign(canonical_message(proof)).hex()
    accepted = client.post("/api/proofs", json=proof.model_dump())
    assert accepted.status_code == 201
    return client, rpc, service, key, db_path, job_id, accepted.json()["proof_id"], proof


def post_anchor(setup):
    return setup[0].post(f"/api/proofs/{setup[6]}/anchor", headers=ADMIN)


def read_anchor(setup):
    with sqlite3.connect(setup[4]) as connection:
        connection.row_factory = sqlite3.Row
        return connection.execute("SELECT * FROM proof_anchors WHERE proof_id=?", (setup[6],)).fetchone()


def assert_not_anchored(setup):
    result = setup[0].get(f"/jobs/{setup[5]}", headers=ADMIN).json()
    assert result["job"]["status"] == "PROOF_RECEIVED"
    assert result["chain"] == "NOT_CONNECTED"
    stored = read_anchor(setup)
    if stored:
        assert stored["status"] != "ANCHORED"
        assert stored["anchored_at"] is None


def test_valid_verified_proof_is_finalized_and_persisted(anchor_setup):
    client, rpc, _, _, _, job_id, proof_id, proof = anchor_setup
    response = post_anchor(anchor_setup)
    assert response.status_code == 200, response.text
    receipt = response.json()
    assert receipt["status"] == "ANCHORED"
    assert receipt["confirmation"] == "finalized"
    assert receipt["cluster"] == "devnet"
    assert receipt["anchor_hash"] == anchor_hash(proof)
    assert receipt["proof_id"] == proof_id
    assert receipt["buyer_confirmation"] == "NOT_IMPLEMENTED"
    assert receipt["chain"] == "SOLANA_DEVNET"
    assert receipt["anchored_at"] > proof.timestamp
    stored = read_anchor(anchor_setup)
    for field in ("anchor_hash", "transaction_signature", "cluster", "anchored_at", "status"):
        assert stored[field] == receipt[field]
    assert len(rpc.sent) == 1
    transaction = rpc.transactions[receipt["transaction_signature"]]
    instruction = transaction.message.instructions[0]
    assert transaction.message.account_keys[instruction.program_id_index] == MEMO_PROGRAM_ID
    assert bytes(instruction.data) == (MEMO_PREFIX + anchor_hash(proof)).encode()
    assert bytes(instruction.accounts) == b"\0"
    assert receipt["explorer_url"] == explorer_url(receipt["transaction_signature"])
    job = client.get(f"/jobs/{job_id}", headers=ADMIN).json()
    assert job["job"]["status"] == "PROOF_ANCHORED"
    assert job["chain"] == "SOLANA_DEVNET"
    assert client.get(f"/api/proofs/{proof_id}/anchor", headers=ADMIN).json() == receipt


def test_missing_proof_is_rejected_before_rpc(anchor_setup):
    client, rpc, *_ = anchor_setup
    assert client.post("/api/proofs/unknown/anchor", headers=ADMIN).status_code == 404
    assert client.get("/api/proofs/unknown/anchor", headers=ADMIN).status_code == 404
    assert rpc.calls == []


@pytest.mark.parametrize("method", ["post", "get"])
def test_anchor_endpoints_require_admin(anchor_setup, method):
    client, rpc, *_ = anchor_setup
    assert getattr(client, method)(f"/api/proofs/{anchor_setup[6]}/anchor").status_code == 401
    assert getattr(client, method)(f"/api/proofs/{anchor_setup[6]}/anchor",
        headers={"X-Admin-Key": "wrong"}).status_code == 401
    assert rpc.calls == []


@pytest.mark.parametrize("field,value", [
    ("signature", "0" * 128), ("public_key", "0" * 64),
    ("canonical_message", "not the signed canonical message"), ("proof_hash", "AB" * 32),
])
def test_unverified_or_tampered_stored_proof_cannot_be_anchored(anchor_setup, field, value):
    with sqlite3.connect(anchor_setup[4]) as connection:
        connection.execute(f"UPDATE production_proofs SET {field}=? WHERE proof_id=?", (value, anchor_setup[6]))
    assert post_anchor(anchor_setup).status_code == 409
    assert anchor_setup[1].calls == []
    assert read_anchor(anchor_setup) is None
    assert_not_anchored(anchor_setup)


def test_duplicate_anchor_returns_same_receipt_without_rpc(anchor_setup):
    first = post_anchor(anchor_setup)
    assert first.status_code == 200
    before = list(anchor_setup[1].calls)
    assert post_anchor(anchor_setup).json() == first.json()
    assert anchor_setup[1].calls == before
    assert len(anchor_setup[1].sent) == 1


def test_concurrent_anchor_requests_share_one_signed_transaction(anchor_setup):
    anchor_setup[1].prepare_barrier = threading.Barrier(2)
    with ThreadPoolExecutor(max_workers=2) as executor:
        results = list(executor.map(lambda _: post_anchor(anchor_setup), range(2)))
    assert [result.status_code for result in results] == [200, 200]
    assert results[0].json() == results[1].json()
    assert len(set(anchor_setup[1].sent)) == 1
    assert len(anchor_setup[1].transactions) == 1


@pytest.mark.parametrize("method", ["getGenesisHash", "getLatestBlockhash", "sendTransaction"])
def test_rpc_failure_never_marks_proof_anchored(anchor_setup, method):
    anchor_setup[1].fail_method = method
    result = post_anchor(anchor_setup)
    assert result.status_code == 502
    assert "secret RPC detail" not in result.text
    assert_not_anchored(anchor_setup)


@pytest.mark.parametrize("level", ["processed", "confirmed"])
def test_confirmation_timeout_is_pending_and_retry_does_not_resign(anchor_setup, level):
    client, rpc, *_ = anchor_setup
    rpc.level = level
    result = post_anchor(anchor_setup)
    assert result.status_code == 504
    assert_not_anchored(anchor_setup)
    pending = read_anchor(anchor_setup)
    assert pending["status"] == "PENDING"
    assert client.get(f"/api/proofs/{anchor_setup[6]}/anchor", headers=ADMIN).json()["confirmation"] is None
    rpc.level = "finalized"
    confirmed = post_anchor(anchor_setup)
    assert confirmed.status_code == 200
    assert confirmed.json()["transaction_signature"] == pending["transaction_signature"]
    assert len(rpc.sent) == 1
    assert rpc.calls.count("getLatestBlockhash") == 1


def test_lost_send_response_can_be_reconciled_after_restart(anchor_setup):
    _, rpc, service, key, db_path, _, proof_id, _ = anchor_setup
    rpc.lose_send_response = True
    assert post_anchor(anchor_setup).status_code == 502
    assert_not_anchored(anchor_setup)
    restarted = TestClient(create_app(str(db_path), "admin", "laser-01", "test-secret",
        "BADEM-001", key.public_key().public_bytes_raw().hex(), service))
    response = restarted.post(f"/api/proofs/{proof_id}/anchor", headers=ADMIN)
    assert response.status_code == 200
    assert len(rpc.sent) == 1
    assert rpc.calls.count("getLatestBlockhash") == 1
    before = list(rpc.calls)
    assert restarted.post(f"/api/proofs/{proof_id}/anchor", headers=ADMIN).json() == response.json()
    assert rpc.calls == before


def test_retry_rebroadcasts_only_the_persisted_signed_bytes(anchor_setup):
    rpc = anchor_setup[1]
    rpc.hide_status = True
    assert post_anchor(anchor_setup).status_code == 504
    stored = read_anchor(anchor_setup)
    rpc.hide_status = False
    rpc.transactions.clear()
    assert post_anchor(anchor_setup).status_code == 200
    assert rpc.sent == [stored["signed_transaction"], stored["signed_transaction"]]
    assert rpc.calls.count("getLatestBlockhash") == 1


def test_rpc_poll_failure_does_not_mark_anchored(anchor_setup):
    rpc = anchor_setup[1]
    rpc.level = "processed"
    assert post_anchor(anchor_setup).status_code == 504
    rpc.fail_method = "getSignatureStatuses"
    assert post_anchor(anchor_setup).status_code == 502
    assert_not_anchored(anchor_setup)


@pytest.mark.parametrize("method", ["getLatestBlockhash", "getSignatureStatuses", "getBlockHeight"])
def test_malformed_rpc_responses_are_not_success(anchor_setup, method):
    anchor_setup[1].malformed_method = method
    assert post_anchor(anchor_setup).status_code == 502
    assert_not_anchored(anchor_setup)


def test_wrong_rpc_signature_is_not_accepted(anchor_setup):
    anchor_setup[1].wrong_send_signature = True
    assert post_anchor(anchor_setup).status_code == 502
    assert_not_anchored(anchor_setup)


def test_invalid_blockhash_is_an_rpc_failure_not_an_unhandled_sdk_error(anchor_setup):
    anchor_setup[1].bad_blockhash = True
    assert post_anchor(anchor_setup).status_code == 502
    assert read_anchor(anchor_setup) is None
    assert_not_anchored(anchor_setup)


@pytest.mark.parametrize("corruption", ["invalid-base64", "wrong-memo", "invalid-signature"])
def test_corrupted_persisted_transaction_cannot_be_reported_as_anchored(anchor_setup, corruption):
    rpc = anchor_setup[1]
    rpc.level = "processed"
    assert post_anchor(anchor_setup).status_code == 504
    stored = read_anchor(anchor_setup)
    if corruption == "invalid-base64":
        encoded = "not valid base64"
    else:
        raw = bytearray(base64.b64decode(stored["signed_transaction"]))
        raw[-1 if corruption == "wrong-memo" else 1] ^= 1
        encoded = base64.b64encode(raw).decode()
    with sqlite3.connect(anchor_setup[4]) as connection:
        connection.execute("UPDATE proof_anchors SET signed_transaction=? WHERE proof_id=?", (encoded, anchor_setup[6]))
    rpc.level = "finalized"
    before = list(rpc.calls)
    assert post_anchor(anchor_setup).status_code == 502
    assert rpc.calls == before
    assert_not_anchored(anchor_setup)


def test_incompatible_job_state_cannot_be_anchored(anchor_setup):
    with sqlite3.connect(anchor_setup[4]) as connection:
        connection.execute("UPDATE jobs SET status='FAILED' WHERE id=?", (anchor_setup[5],))
    assert post_anchor(anchor_setup).status_code == 409
    assert anchor_setup[1].calls == []


def test_anchored_record_remains_idempotent_without_payer_configuration(anchor_setup):
    result = post_anchor(anchor_setup)
    assert result.status_code == 200
    _, rpc, _, key, db_path, _, proof_id, _ = anchor_setup
    restarted = TestClient(create_app(str(db_path), "admin", "laser-01", "test-secret",
        "BADEM-001", key.public_key().public_bytes_raw().hex()))
    before = list(rpc.calls)
    assert restarted.post(f"/api/proofs/{proof_id}/anchor", headers=ADMIN).json() == result.json()
    assert rpc.calls == before


def test_onchain_execution_error_is_not_a_success(anchor_setup):
    anchor_setup[1].execution_error = {"InstructionError": [0, "InvalidInstructionData"]}
    assert post_anchor(anchor_setup).status_code == 409
    assert read_anchor(anchor_setup)["status"] == "FAILED"
    assert_not_anchored(anchor_setup)
    before = list(anchor_setup[1].calls)
    assert post_anchor(anchor_setup).status_code == 409
    assert anchor_setup[1].calls == before


def test_expired_unknown_transaction_is_not_replaced(anchor_setup):
    rpc = anchor_setup[1]
    rpc.hide_status = True
    assert post_anchor(anchor_setup).status_code == 504
    rpc.height = 151
    assert post_anchor(anchor_setup).status_code == 409
    assert read_anchor(anchor_setup)["status"] == "FAILED"
    assert len(rpc.sent) == 1
    assert rpc.calls.count("getLatestBlockhash") == 1
    assert_not_anchored(anchor_setup)


def test_non_devnet_rpc_is_rejected_without_submission(anchor_setup):
    anchor_setup[1].genesis = str(Hash.new_unique())
    assert post_anchor(anchor_setup).status_code == 502
    assert anchor_setup[1].sent == []
    assert_not_anchored(anchor_setup)


def test_no_anchor_configuration_does_not_break_ingestion(anchor_setup):
    _, rpc, _, key, db_path, _, proof_id, _ = anchor_setup
    client = TestClient(create_app(str(db_path), "admin", "laser-01", "test-secret",
        "BADEM-001", key.public_key().public_bytes_raw().hex()))
    assert client.get("/health").status_code == 200
    assert client.get(f"/api/proofs/{proof_id}/anchor", headers=ADMIN).json()["status"] == "NOT_ANCHORED"
    assert client.post(f"/api/proofs/{proof_id}/anchor", headers=ADMIN).status_code == 503
    assert rpc.calls == []


@pytest.mark.parametrize("encoding", ["json", "base58"])
def test_environment_payer_formats(monkeypatch, encoding):
    payer = Keypair()
    value = json.dumps(list(bytes(payer))) if encoding == "json" else str(payer)
    monkeypatch.setenv("SOLANA_RPC_URL", "https://rpc.invalid")
    monkeypatch.setenv("SOLANA_PAYER_PRIVATE_KEY", value)
    assert SolanaAnchorService.from_environment().payer.pubkey() == payer.pubkey()


@pytest.mark.parametrize("value", ["not-a-private-key", "[1,2,3]", "[true]", "{bad-json"])
def test_invalid_payer_is_rejected_without_leaking_material(monkeypatch, value):
    monkeypatch.setenv("SOLANA_RPC_URL", "https://rpc.invalid")
    monkeypatch.setenv("SOLANA_PAYER_PRIVATE_KEY", value)
    with pytest.raises(AnchorConfigurationError) as error:
        SolanaAnchorService.from_environment()
    assert value not in str(error.value)


def test_mainnet_configuration_is_rejected(monkeypatch):
    monkeypatch.setenv("SOLANA_RPC_URL", "https://rpc.invalid")
    monkeypatch.setenv("SOLANA_PAYER_PRIVATE_KEY", str(Keypair()))
    monkeypatch.setenv("SOLANA_CLUSTER", "mainnet-beta")
    with pytest.raises(AnchorConfigurationError, match="must be devnet"):
        SolanaAnchorService.from_environment()


def hash_example():
    return ProductionProof(node_id="BADEM-001", job_id="JOB-0042", event="COMPLETED",
        timestamp=1760000000, proof_hash="EF" * 32, public_key="AB" * 32, signature="CD" * 64)


def test_exact_deterministic_canonical_anchor_bytes():
    proof = hash_example()
    expected = b"BADEM_PROOF_ANCHOR_V1|BADEM-001|JOB-0042|COMPLETED|1760000000|" + (
        "EF" * 32 + "|" + "ab" * 32 + "|" + "cd" * 64
    ).encode()
    assert ANCHOR_PREFIX == b"BADEM_PROOF_ANCHOR_V1|"
    assert canonical_anchor_payload(proof) == expected
    assert b"\n" not in expected and b"\0" not in expected
    assert anchor_hash(proof) == hashlib.sha256(expected).hexdigest()
    assert anchor_hash(proof) == "4c29afa40a163e8088ff559a8b9b2639759772189517d231dcfc372da80ed005"
    assert anchor_hash(proof) == anchor_hash(ProductionProof(**dict(reversed(list(proof.model_dump().items())))))


@pytest.mark.parametrize("field,value", [
    ("node_id", "BADEM-002"), ("job_id", "JOB-0043"), ("event", "FINISHED"),
    ("timestamp", 1760000001), ("proof_hash", "00" * 32),
    ("public_key", "34" * 32), ("signature", "56" * 64),
])
def test_anchor_hash_commits_to_every_production_field(field, value):
    proof = hash_example()
    assert anchor_hash(proof) != anchor_hash(proof.model_copy(update={field: value}))


def test_only_transport_hex_case_is_normalized():
    proof = hash_example()
    assert anchor_hash(proof) == anchor_hash(proof.model_copy(update={
        "public_key": proof.public_key.lower(), "signature": proof.signature.lower(),
    }))
    assert anchor_hash(proof) != anchor_hash(proof.model_copy(update={"proof_hash": proof.proof_hash.lower()}))


def test_existing_verified_database_gains_anchor_table_without_rewriting_proof(anchor_setup):
    _, _, service, key, db_path, _, proof_id, _ = anchor_setup
    with sqlite3.connect(db_path) as connection:
        connection.execute("DROP TABLE proof_anchors")
        original = connection.execute("SELECT * FROM production_proofs WHERE proof_id=?", (proof_id,)).fetchone()
    restarted = TestClient(create_app(str(db_path), "admin", "laser-01", "test-secret",
        "BADEM-001", key.public_key().public_bytes_raw().hex(), service))
    with sqlite3.connect(db_path) as connection:
        assert connection.execute("SELECT * FROM production_proofs WHERE proof_id=?", (proof_id,)).fetchone() == original
    assert restarted.post(f"/api/proofs/{proof_id}/anchor", headers=ADMIN).status_code == 200
