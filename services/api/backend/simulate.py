"""Send one synthetic run against a local BADEM API; no physical machine involved."""

import hashlib
import hmac
import json
import os
import sys
import time
import uuid

import httpx


base = os.getenv("BADEM_API_URL", "http://127.0.0.1:8000")
admin = os.environ["BADEM_ADMIN_KEY"]
device_id = os.environ["BADEM_DEVICE_ID"]
secret = os.environ["BADEM_DEVICE_SECRET"]
client = httpx.Client(base_url=base, timeout=10)
job = client.post("/jobs", headers={"X-Admin-Key": admin}, json={
    "machine_id": device_id, "title": "Synthetic laser test",
    "file_sha256": hashlib.sha256(b"example.gcode").hexdigest(),
})
job.raise_for_status()
job_id = job.json()["job_id"]
for sequence, event_type in enumerate(("STARTED", "HEARTBEAT", "FINISHED"), 1):
    payload = {"event_id": str(uuid.uuid4()), "job_id": job_id,
               "machine_id": device_id, "sequence": sequence,
               "event_type": event_type, "observed_at": int(time.time())}
    body = json.dumps(payload, separators=(",", ":")).encode()
    signature = hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()
    response = client.post("/machine-events", content=body, headers={
        "Content-Type": "application/json", "X-Device-Id": device_id,
        "X-Signature": signature})
    response.raise_for_status()
result = client.get(f"/jobs/{job_id}", headers={"X-Admin-Key": admin})
result.raise_for_status()
print(json.dumps(result.json(), indent=2))
