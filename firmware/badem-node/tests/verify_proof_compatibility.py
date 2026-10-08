"""Compile the real proof builder/Solduino signer and verify against FastAPI."""

import argparse
import ctypes.util
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile

from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from fastapi.testclient import TestClient


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--platformio-core-dir", type=Path, default=Path(
        os.getenv("PLATFORMIO_CORE_DIR", str(Path.home() / ".platformio")),
    ))
    args = parser.parse_args()
    firmware = Path(__file__).resolve().parents[1]
    repository = firmware.parents[1]
    sys.path.insert(0, str(repository / "services" / "api"))
    from backend.app import create_app
    from backend.proofs import ProductionProof, canonical_message, registered_public_key

    dependencies = firmware / ".pio" / "libdeps" / "esp32dev"
    wallet = next(dependencies.glob("*/keypair.cpp"), None)
    arduino_json = next(dependencies.glob("*/src/ArduinoJson.h"), None)
    sodium_headers = (args.platformio_core_dir / "packages" /
        "framework-arduinoespressif32" / "tools" / "sdk" / "esp32" /
        "include" / "libsodium")
    sodium_header = next(sodium_headers.rglob("sodium.h"), None)
    sodium_library = ctypes.util.find_library("sodium")
    if not all((wallet, arduino_json, sodium_header, sodium_library)):
        parser.error("Run the esp32dev PlatformIO build first; install host libsodium runtime and g++")

    seed = b"\0" + Ed25519PrivateKey.generate().private_bytes_raw()[1:]
    key = Ed25519PrivateKey.from_private_bytes(seed)
    public_key = key.public_key().public_bytes_raw().hex()

    def base58(data):
        alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"
        value = int.from_bytes(data, "big")
        encoded = ""
        while value:
            value, remainder = divmod(value, 58)
            encoded = alphabet[remainder] + encoded
        return "1" * (len(data) - len(data.lstrip(b"\0"))) + encoded

    wallet_secrets = [base58(seed), base58(seed + bytes.fromhex(public_key))]
    with tempfile.TemporaryDirectory(prefix="badem-firmware-proof-") as directory:
        executable = Path(directory) / "proof-compatibility"
        subprocess.run([
            "g++", "-std=c++11", "-O2", "-I", str(firmware),
            "-I", str(firmware / "tests" / "arduino_stub"),
            "-I", str(wallet.parent), "-I", str(arduino_json.parent),
            "-I", str(sodium_header.parent), "-I", str(sodium_headers / "port_include"),
            str(firmware / "tests" / "proof_compatibility.cpp"),
            str(wallet), str(wallet.parent / "crypto.cpp"),
            f"-l:{sodium_library}", "-o", str(executable),
        ], check=True)

        def generate(node_id, job_id, timestamp, wallet_secret=wallet_secrets[0]):
            result = subprocess.run(
                [str(executable), node_id, job_id, str(timestamp)], input=wallet_secret + "\n",
                capture_output=True, text=True, check=True,
            )
            canonical, body = result.stdout.splitlines()
            payload = json.loads(body)
            proof = ProductionProof(**payload)
            assert canonical.encode("utf-8") == canonical_message(proof)
            metadata = f"{node_id}|{job_id}|COMPLETED|{timestamp}".encode("utf-8")
            assert proof.proof_hash == hashlib.sha256(metadata).hexdigest()
            assert proof.public_key == public_key
            assert proof.signature == key.sign(canonical_message(proof)).hex()
            registered_public_key(public_key).verify(bytes.fromhex(proof.signature), canonical_message(proof))
            return payload

        cases = [("BADEM-001", "JOB-0042", 1760000000),
                 ("BADEM-001", "JOB-0042", 0),
                 ("N" * 80, "J" * 100, 9223372036854775807)]
        for case in cases:
            assert generate(*case) == generate(*case)
            assert generate(*case) == generate(*case, wallet_secret=wallet_secrets[1])
        for node_id, job_id, timestamp in [("BADEM|001", "JOB-0042", 1760000000),
                                          ("BADEM-001", "JOB\n0042", 1760000000),
                                          ("BADEM-001", "JOB-0042", -1)]:
            rejected = subprocess.run([str(executable), node_id, job_id, str(timestamp)],
                input=wallet_secrets[0] + "\n", capture_output=True, text=True)
            assert rejected.returncode == 2

        client = TestClient(create_app(str(Path(directory) / "test.db"), "test-admin",
            "laser-01", "test-secret", "BADEM-001", public_key))
        job = client.post("/jobs", headers={"X-Admin-Key": "test-admin"}, json={
            "machine_id": "laser-01", "title": "Firmware wire compatibility", "file_sha256": "a" * 64,
        })
        assert job.status_code == 201
        payload = generate("BADEM-001", job.json()["job_id"], 1760000000)
        accepted = client.post("/api/proofs", json=payload)
        assert accepted.status_code == 201
        assert accepted.json()["status"] == "PROOF_RECEIVED"
        assert client.post("/api/proofs", json=payload).status_code == 409
        signature = bytearray.fromhex(payload["signature"])
        signature[0] ^= 1
        assert client.post("/api/proofs", json={**payload, "signature": signature.hex()}).status_code == 401
        print("PASS: real Solduino/libsodium signing matches Python Ed25519 byte-for-byte.")
        print("PASS: Base58 32-byte seed and 64-byte keypair imports, including leading-zero seeds.")
        print("PASS: canonical UTF-8, SHA-256, seven-field JSON, integer timestamps, and lowercase hex.")
        print("PASS: FastAPI accepts generated proof (201/PROOF_RECEIVED), duplicate 409, tampering 401.")


if __name__ == "__main__":
    main()
