"""Jobs, authenticated machine events, verified device proofs and Devnet anchoring."""

from __future__ import annotations

import hashlib
import hmac
import os
import sqlite3
import time
import uuid
from contextlib import contextmanager
from pathlib import Path
from typing import Literal

from cryptography.exceptions import InvalidSignature
from fastapi import FastAPI, Header, HTTPException, Request
from pydantic import BaseModel, Field

from backend.proofs import ProductionProof, canonical_message, registered_public_key
from backend.solana_anchor import (
    AnchorConfigurationError, AnchorFailedError, AnchorPendingError, AnchorRPCError,
    PreparedAnchor, SolanaAnchorService, anchor_hash, explorer_url,
)


class NewJob(BaseModel):
    machine_id: str = Field(min_length=1, max_length=80)
    file_sha256: str = Field(pattern=r"^[0-9a-fA-F]{64}$")
    title: str = Field(min_length=1, max_length=120)


class MachineEvent(BaseModel):
    event_id: str = Field(min_length=1, max_length=100)
    job_id: str
    machine_id: str
    sequence: int = Field(ge=1)
    event_type: Literal["STARTED", "HEARTBEAT", "FINISHED", "ERROR", "ABORTED"]
    observed_at: int = Field(description="Unix timestamp in seconds from the device")


SCHEMA = """
CREATE TABLE IF NOT EXISTS jobs (
    id TEXT PRIMARY KEY,
    machine_id TEXT NOT NULL,
    title TEXT NOT NULL,
    file_sha256 TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'CREATED',
    created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS machine_events (
    event_id TEXT PRIMARY KEY,
    job_id TEXT NOT NULL REFERENCES jobs(id),
    machine_id TEXT NOT NULL,
    sequence INTEGER NOT NULL,
    event_type TEXT NOT NULL,
    observed_at INTEGER NOT NULL,
    received_at INTEGER NOT NULL,
    body_sha256 TEXT NOT NULL,
    previous_hash TEXT NOT NULL,
    event_hash TEXT NOT NULL,
    UNIQUE(job_id, sequence)
);
CREATE TABLE IF NOT EXISTS production_proofs (
    proof_id TEXT PRIMARY KEY,
    node_id TEXT NOT NULL,
    job_id TEXT NOT NULL REFERENCES jobs(id),
    event TEXT NOT NULL CHECK(event = 'COMPLETED'),
    timestamp INTEGER NOT NULL,
    proof_hash TEXT NOT NULL,
    public_key TEXT NOT NULL,
    signature TEXT NOT NULL,
    canonical_message TEXT NOT NULL,
    received_at INTEGER NOT NULL,
    UNIQUE(node_id, job_id, event)
);
CREATE TABLE IF NOT EXISTS proof_anchors (
    proof_id TEXT PRIMARY KEY REFERENCES production_proofs(proof_id),
    anchor_hash TEXT NOT NULL,
    transaction_signature TEXT NOT NULL UNIQUE,
    cluster TEXT NOT NULL CHECK(cluster = 'devnet'),
    status TEXT NOT NULL CHECK(status IN ('PENDING', 'ANCHORED', 'FAILED')),
    signed_transaction TEXT NOT NULL,
    last_valid_block_height INTEGER NOT NULL,
    anchored_at INTEGER,
    CHECK((status = 'ANCHORED' AND anchored_at IS NOT NULL) OR
          (status != 'ANCHORED' AND anchored_at IS NULL))
);
"""


def create_app(db_path: str | None = None, admin_key: str | None = None,
               device_id: str | None = None, device_secret: str | None = None,
               node_id: str | None = None, node_public_key: str | None = None,
               anchor_service: SolanaAnchorService | None = None) -> FastAPI:
    db_path = db_path or os.getenv("BADEM_DB_PATH", "badem.db")
    admin_key = admin_key or os.getenv("BADEM_ADMIN_KEY", "")
    device_id = device_id or os.getenv("BADEM_DEVICE_ID", "")
    device_secret = device_secret or os.getenv("BADEM_DEVICE_SECRET", "")
    if not all((admin_key, device_id, device_secret)):
        raise RuntimeError("Set BADEM_ADMIN_KEY, BADEM_DEVICE_ID and BADEM_DEVICE_SECRET")
    node_id = node_id or os.getenv("BADEM_NODE_ID", device_id)
    node_public_key = node_public_key or os.getenv("BADEM_NODE_PUBLIC_KEY", "")
    expected_key = None
    if node_public_key:
        try:
            expected_key = registered_public_key(node_public_key)
        except ValueError:
            raise RuntimeError("BADEM_NODE_PUBLIC_KEY must be a 32-byte Ed25519 key in hex") from None
    Path(db_path).parent.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(db_path) as connection:
        connection.executescript(SCHEMA)

    @contextmanager
    def db():
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

    app = FastAPI(title="BADEM Proof of Production prototype", version="0.1.0")

    def require_admin(value: str | None):
        if value is None or not hmac.compare_digest(value, admin_key):
            raise HTTPException(401, "Invalid admin key")

    @app.get("/health")
    def health():
        return {"status": "ok", "chain": "not_connected"}

    @app.post("/jobs", status_code=201)
    def create_job(job: NewJob, x_admin_key: str | None = Header(default=None)):
        require_admin(x_admin_key)
        job_id = str(uuid.uuid4())
        with db() as connection:
            connection.execute(
                "INSERT INTO jobs(id,machine_id,title,file_sha256,created_at) VALUES(?,?,?,?,?)",
                (job_id, job.machine_id, job.title, job.file_sha256.lower(), int(time.time())),
            )
        return {"job_id": job_id, "status": "CREATED"}

    @app.get("/jobs/{job_id}")
    def get_job(job_id: str, x_admin_key: str | None = Header(default=None)):
        require_admin(x_admin_key)
        with db() as connection:
            job = connection.execute("SELECT * FROM jobs WHERE id=?", (job_id,)).fetchone()
            if job is None:
                raise HTTPException(404, "Job not found")
            events = connection.execute(
                "SELECT event_id,sequence,event_type,observed_at,received_at,event_hash "
                "FROM machine_events WHERE job_id=? ORDER BY sequence", (job_id,)
            ).fetchall()
        return {"job": dict(job), "events": [dict(event) for event in events],
                "buyer_confirmation": "NOT_IMPLEMENTED",
                "chain": "SOLANA_DEVNET" if job["status"] == "PROOF_ANCHORED" else "NOT_CONNECTED"}

    @app.post("/machine-events", status_code=201)
    async def machine_event(request: Request, x_device_id: str | None = Header(default=None),
                            x_signature: str | None = Header(default=None)):
        body = await request.body()
        if len(body) > 4096:
            raise HTTPException(413, "Event too large")
        if x_device_id != device_id or not x_signature:
            raise HTTPException(401, "Invalid device authentication")
        expected = hmac.new(device_secret.encode(), body, hashlib.sha256).hexdigest()
        if not hmac.compare_digest(expected, x_signature):
            raise HTTPException(401, "Invalid device signature")
        try:
            event = MachineEvent.model_validate_json(body)
        except Exception:
            raise HTTPException(422, "Invalid event payload") from None
        now = int(time.time())
        if abs(now - event.observed_at) > 300:
            raise HTTPException(422, "Device timestamp differs by more than five minutes")
        with db() as connection:
            job = connection.execute("SELECT * FROM jobs WHERE id=?", (event.job_id,)).fetchone()
            if job is None:
                raise HTTPException(404, "Job not found")
            if job["machine_id"] != event.machine_id or event.machine_id != device_id:
                raise HTTPException(409, "Machine does not match job or device")
            previous = connection.execute(
                "SELECT sequence,event_hash FROM machine_events WHERE job_id=? "
                "ORDER BY sequence DESC LIMIT 1", (event.job_id,)
            ).fetchone()
            if connection.execute("SELECT 1 FROM machine_events WHERE event_id=?",
                                  (event.event_id,)).fetchone():
                raise HTTPException(409, "Event ID already exists")
            expected_sequence = 1 if previous is None else previous["sequence"] + 1
            if event.sequence != expected_sequence:
                raise HTTPException(409, f"Expected sequence {expected_sequence}")
            allowed = {
                "CREATED": {"STARTED": "RUNNING"},
                "RUNNING": {"HEARTBEAT": "RUNNING", "FINISHED": "AWAITING_BUYER",
                            "ERROR": "FAILED", "ABORTED": "ABORTED"},
            }
            new_status = allowed.get(job["status"], {}).get(event.event_type)
            if new_status is None:
                raise HTTPException(409, f"Cannot accept {event.event_type} from {job['status']}")
            body_hash = hashlib.sha256(body).hexdigest()
            previous_hash = previous["event_hash"] if previous else "0" * 64
            event_hash = hashlib.sha256(f"{previous_hash}:{body_hash}".encode()).hexdigest()
            connection.execute(
                "INSERT INTO machine_events VALUES (?,?,?,?,?,?,?,?,?,?)",
                (event.event_id, event.job_id, event.machine_id, event.sequence,
                 event.event_type, event.observed_at, now, body_hash, previous_hash, event_hash),
            )
            connection.execute("UPDATE jobs SET status=? WHERE id=?", (new_status, event.job_id))
        return {"status": new_status, "event_hash": event_hash}

    @app.post("/api/proofs", status_code=201)
    def ingest_proof(proof: ProductionProof):
        if expected_key is None or proof.node_id != node_id:
            raise HTTPException(403, "Node is not registered")
        if not hmac.compare_digest(bytes.fromhex(proof.public_key), expected_key.public_bytes_raw()):
            raise HTTPException(403, "Public key does not match registered node")
        message = canonical_message(proof)
        try:
            expected_key.verify(bytes.fromhex(proof.signature), message)
        except InvalidSignature:
            raise HTTPException(401, "Invalid proof signature") from None
        with db() as connection:
            job = connection.execute("SELECT * FROM jobs WHERE id=?", (proof.job_id,)).fetchone()
            if job is None:
                raise HTTPException(404, "Job not found")
            if job["machine_id"] != device_id:
                raise HTTPException(403, "Node is not assigned to this job's machine")
            if connection.execute(
                "SELECT 1 FROM production_proofs WHERE node_id=? AND job_id=? AND event=?",
                (proof.node_id, proof.job_id, proof.event),
            ).fetchone():
                raise HTTPException(409, "Proof already exists for this node, job and event")
            if job["status"] not in {"CREATED", "RUNNING", "AWAITING_BUYER"}:
                raise HTTPException(409, f"Cannot accept completion proof from {job['status']}")
            proof_id = str(uuid.uuid4())
            connection.execute(
                "INSERT INTO production_proofs "
                "(proof_id,node_id,job_id,event,timestamp,proof_hash,public_key,signature,"
                "canonical_message,received_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
                (proof_id, proof.node_id, proof.job_id, proof.event, proof.timestamp,
                 proof.proof_hash, proof.public_key, proof.signature, message.decode("utf-8"),
                 int(time.time())),
            )
            connection.execute("UPDATE jobs SET status='PROOF_RECEIVED' WHERE id=?", (proof.job_id,))
        return {"proof_id": proof_id, "node_id": proof.node_id, "job_id": proof.job_id,
                "status": "PROOF_RECEIVED", "signature_verified": True,
                "buyer_confirmation": "NOT_IMPLEMENTED", "chain": "NOT_CONNECTED"}

    def verified_stored_proof(connection, proof_id):
        row = connection.execute("SELECT * FROM production_proofs WHERE proof_id=?", (proof_id,)).fetchone()
        if row is None:
            raise HTTPException(404, "Proof not found")
        try:
            proof = ProductionProof(**{field: row[field] for field in ProductionProof.model_fields})
            message = canonical_message(proof)
            if expected_key is None or proof.node_id != node_id or not hmac.compare_digest(
                bytes.fromhex(proof.public_key), expected_key.public_bytes_raw()
            ) or row["canonical_message"] != message.decode("utf-8"):
                raise ValueError
            expected_key.verify(bytes.fromhex(proof.signature), message)
        except (ValueError, InvalidSignature):
            raise HTTPException(409, "Stored proof is not verified against the registered device") from None
        job = connection.execute("SELECT * FROM jobs WHERE id=?", (proof.job_id,)).fetchone()
        if job is None or job["machine_id"] != device_id:
            raise HTTPException(409, "Stored proof's job does not match the registered machine")
        return proof, job

    def anchor_response(row):
        anchored = row["status"] == "ANCHORED"
        return {"proof_id": row["proof_id"], "anchor_hash": row["anchor_hash"],
                "transaction_signature": row["transaction_signature"], "cluster": row["cluster"],
                "anchored_at": row["anchored_at"], "status": row["status"],
                "confirmation": "finalized" if anchored else None,
                "explorer_url": explorer_url(row["transaction_signature"], row["cluster"]),
                "chain": "SOLANA_DEVNET" if anchored else "NOT_CONFIRMED",
                "buyer_confirmation": "NOT_IMPLEMENTED"}

    @app.get("/api/proofs/{proof_id}/anchor")
    def get_anchor(proof_id: str, x_admin_key: str | None = Header(default=None)):
        require_admin(x_admin_key)
        with db() as connection:
            if not connection.execute("SELECT 1 FROM production_proofs WHERE proof_id=?", (proof_id,)).fetchone():
                raise HTTPException(404, "Proof not found")
            row = connection.execute("SELECT * FROM proof_anchors WHERE proof_id=?", (proof_id,)).fetchone()
        if row is None:
            return {"proof_id": proof_id, "status": "NOT_ANCHORED", "chain": "NOT_CONFIRMED"}
        return anchor_response(row)

    @app.get("/api/demo/jobs/{job_id}")
    def get_demo_job_state(job_id: str, x_admin_key: str | None = Header(default=None)):
        require_admin(x_admin_key)
        with db() as connection:
            job = connection.execute("SELECT * FROM jobs WHERE id=?", (job_id,)).fetchone()
            if job is None:
                raise HTTPException(404, "Job not found")
            events = connection.execute(
                "SELECT event_id,sequence,event_type,observed_at,received_at,event_hash "
                "FROM machine_events WHERE job_id=? ORDER BY sequence", (job_id,)
            ).fetchall()
            proof = connection.execute(
                "SELECT proof_id,node_id,job_id,event,timestamp,proof_hash,received_at "
                "FROM production_proofs WHERE job_id=? ORDER BY received_at DESC LIMIT 1",
                (job_id,),
            ).fetchone()
            anchor = None
            if proof is not None:
                row = connection.execute(
                    "SELECT * FROM proof_anchors WHERE proof_id=?", (proof["proof_id"],)
                ).fetchone()
                anchor = anchor_response(row) if row is not None else {
                    "proof_id": proof["proof_id"],
                    "status": "NOT_ANCHORED",
                    "chain": "NOT_CONFIRMED",
                }
        return {
            "job": dict(job),
            "events": [dict(event) for event in events],
            "proof": dict(proof) if proof is not None else None,
            "anchor": anchor,
            "buyer_confirmation": "NOT_IMPLEMENTED",
        }

    @app.post("/api/proofs/{proof_id}/anchor")
    def anchor_proof(proof_id: str, x_admin_key: str | None = Header(default=None)):
        require_admin(x_admin_key)
        with db() as connection:
            proof, job = verified_stored_proof(connection, proof_id)
            if job["status"] not in {"PROOF_RECEIVED", "PROOF_ANCHORED"}:
                raise HTTPException(409, "Job must have a verified production proof before anchoring")
            digest = anchor_hash(proof)
            row = connection.execute("SELECT * FROM proof_anchors WHERE proof_id=?", (proof_id,)).fetchone()
        if row is not None and row["anchor_hash"] != digest:
            raise HTTPException(409, "Stored production proof differs from its anchor commitment")
        if row is not None and row["status"] == "ANCHORED":
            return anchor_response(row)
        if row is not None and row["status"] == "FAILED":
            raise HTTPException(409, "Anchor failed or expired; operator reconciliation required")
        try:
            service = anchor_service or SolanaAnchorService.from_environment()
        except AnchorConfigurationError as error:
            raise HTTPException(503, str(error)) from None
        if row is None:
            try:
                prepared = service.prepare(digest)
            except AnchorRPCError as error:
                raise HTTPException(502, str(error)) from None
            # Commit signed bytes before any broadcast; a concurrent request must use the winner's bytes.
            with db() as connection:
                current, job = verified_stored_proof(connection, proof_id)
                if anchor_hash(current) != digest:
                    raise HTTPException(409, "Production proof changed during preparation")
                row = connection.execute("SELECT * FROM proof_anchors WHERE proof_id=?", (proof_id,)).fetchone()
                if row is None:
                    if job["status"] != "PROOF_RECEIVED":
                        raise HTTPException(409, "Job is not ready for anchoring")
                    connection.execute(
                        "INSERT INTO proof_anchors "
                        "(proof_id,anchor_hash,transaction_signature,cluster,status,signed_transaction,last_valid_block_height) "
                        "VALUES (?,?,?,?,'PENDING',?,?)",
                        (proof_id, digest, prepared.transaction_signature, service.cluster,
                         prepared.signed_transaction, prepared.last_valid_block_height),
                    )
                    row = connection.execute("SELECT * FROM proof_anchors WHERE proof_id=?", (proof_id,)).fetchone()
        if row["status"] == "ANCHORED":
            return anchor_response(row)
        if row["status"] == "FAILED":
            raise HTTPException(409, "Anchor failed or expired; operator reconciliation required")
        prepared = PreparedAnchor(row["transaction_signature"], row["signed_transaction"], row["last_valid_block_height"])
        try:
            service.submit_and_confirm(prepared, digest)
        except AnchorFailedError as error:
            with db() as connection:
                connection.execute("UPDATE proof_anchors SET status='FAILED' WHERE proof_id=? AND status='PENDING'", (proof_id,))
            raise HTTPException(409, str(error)) from None
        except AnchorRPCError as error:
            raise HTTPException(502, str(error)) from None
        except AnchorPendingError as error:
            raise HTTPException(504, str(error)) from None
        with db() as connection:
            current, job = verified_stored_proof(connection, proof_id)
            if anchor_hash(current) != digest or job["status"] not in {"PROOF_RECEIVED", "PROOF_ANCHORED"}:
                raise HTTPException(409, "Production proof/job changed during confirmation")
            connection.execute(
                "UPDATE proof_anchors SET status='ANCHORED', anchored_at=COALESCE(anchored_at,?) WHERE proof_id=?",
                (int(time.time()), proof_id),
            )
            connection.execute("UPDATE jobs SET status='PROOF_ANCHORED' WHERE id=?", (proof.job_id,))
            row = connection.execute("SELECT * FROM proof_anchors WHERE proof_id=?", (proof_id,)).fetchone()
        return anchor_response(row)

    return app
