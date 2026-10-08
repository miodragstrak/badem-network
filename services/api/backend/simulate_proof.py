"""Sign synthetic completion proofs with an ephemeral, local-only test seed."""

import argparse
import hashlib
import json
import os
import time

import httpx
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

from backend.proofs import ProductionProof, canonical_message


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--public-key", action="store_true", help="Print only the test public key")
    parser.add_argument("--job-id", help="Use an existing job instead of creating a synthetic job")
    args = parser.parse_args()
    seed = os.getenv("BADEM_PROOF_TEST_SEED", "")
    if len(seed) != 64 or any(character not in "0123456789abcdefABCDEF" for character in seed):
        parser.error("Set BADEM_PROOF_TEST_SEED to 32 random test bytes encoded as 64 hex characters")
    key = Ed25519PrivateKey.from_private_bytes(bytes.fromhex(seed))
    public_key = key.public_key().public_bytes_raw().hex()
    if args.public_key:
        print(public_key)
        return

    admin = os.environ["BADEM_ADMIN_KEY"]
    device_id = os.environ["BADEM_DEVICE_ID"]
    node_id = os.getenv("BADEM_NODE_ID", device_id)
    with httpx.Client(base_url=os.getenv("BADEM_API_URL", "http://127.0.0.1:8000"), timeout=10) as client:
        headers = {"X-Admin-Key": admin}
        job_id = args.job_id
        if job_id is None:
            job = client.post("/jobs", headers=headers, json={
                "machine_id": device_id, "title": "Synthetic signed completion proof",
                "file_sha256": hashlib.sha256(b"synthetic-example.gcode").hexdigest(),
            })
            job.raise_for_status()
            job_id = job.json()["job_id"]
        proof = ProductionProof(
            node_id=node_id, job_id=job_id, event="COMPLETED", timestamp=int(time.time()),
            proof_hash=hashlib.sha256(b"synthetic production completion").hexdigest(),
            public_key=public_key, signature="0" * 128,
        )
        proof.signature = key.sign(canonical_message(proof)).hex()
        payload = proof.model_dump()
        invalid_signature = bytearray.fromhex(proof.signature)
        invalid_signature[0] ^= 1
        invalid = client.post("/api/proofs", json={
            **payload, "signature": invalid_signature.hex(),
        })
        if invalid.status_code != 401:
            raise RuntimeError(f"Expected invalid-signature rejection 401, got {invalid.status_code}")
        accepted = client.post("/api/proofs", json=payload)
        accepted.raise_for_status()
        duplicate = client.post("/api/proofs", json=payload)
        if duplicate.status_code != 409:
            raise RuntimeError(f"Expected duplicate rejection 409, got {duplicate.status_code}")
        job = client.get(f"/jobs/{job_id}", headers=headers)
        job.raise_for_status()
        result = job.json()
        if result["job"]["status"] != "PROOF_RECEIVED":
            raise RuntimeError("Accepted proof did not update the job state")
        print(json.dumps({
            "payload": payload, "accepted": accepted.json(), "accepted_status": accepted.status_code,
            "job_status": result["job"]["status"],
            "invalid_signature_status": invalid.status_code, "duplicate_status": duplicate.status_code,
            "buyer_confirmation": result["buyer_confirmation"], "chain": result["chain"],
        }, indent=2))


if __name__ == "__main__":
    main()
