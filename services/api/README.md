# BADEM API

FastAPI service for the BADEM manufacturing demo, migrated from
`BADEM-software-milestone-01`. It creates jobs, authenticates machine events,
enforces their lifecycle and sequence, and stores a hash-linked event log in
SQLite. The included simulator sends synthetic events for one laser job.
Milestone 02 also accepts registered-node Ed25519 completion proofs through
`POST /api/proofs`; successful ingestion records a device proof, not blockchain
or buyer verification.
Milestone 03 adds optional, admin-triggered Solana Devnet Memo anchoring of
that verified proof. A job becomes `PROOF_ANCHORED` only after finalization.

## Local Setup

Run these commands from the monorepo root:

```bash
cd services/api
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
export BADEM_ADMIN_KEY="$(openssl rand -hex 32)"
export BADEM_DEVICE_ID=laser-01
export BADEM_DEVICE_SECRET="$(openssl rand -hex 32)"
```

Keep the three environment values available to both the API and simulator.
The service refuses to start if any is missing. `BADEM_DB_PATH` optionally
sets the SQLite file; its default, `badem.db`, is relative to the working
directory, so running here stores it in `services/api/badem.db`.

## Run FastAPI

From `services/api`, with the environment values above set:

```bash
.venv/bin/uvicorn backend.app:create_app --factory --reload
```

The API runs at `http://127.0.0.1:8000`; interactive API documentation is at
`http://127.0.0.1:8000/docs`. `GET /health` reports `status: ok` and
`chain: not_connected`.
The health endpoint does not probe RPC or claim any proof is on-chain.

| Endpoint | Purpose | Authentication |
| --- | --- | --- |
| `GET /health` | Service health | None |
| `POST /jobs` | Create a manufacturing job | `X-Admin-Key` |
| `GET /jobs/{job_id}` | Read a job and its event log | `X-Admin-Key` |
| `POST /machine-events` | Submit a signed machine event | `X-Device-Id` and `X-Signature` |
| `POST /api/proofs` | Verify and store a completion proof | Registered node Ed25519 signature |
| `POST /api/proofs/{proof_id}/anchor` | Anchor/reconcile a verified proof on Devnet | `X-Admin-Key` |
| `GET /api/proofs/{proof_id}/anchor` | Read the stored anchor receipt/status without RPC | `X-Admin-Key` |
| `GET /api/demo/jobs/{job_id}` | Read one job with its latest proof and anchor receipt for the hackathon UI | `X-Admin-Key` |

## Run the Simulator

In a second terminal, change to `services/api` and export the same
`BADEM_ADMIN_KEY`, `BADEM_DEVICE_ID`, and `BADEM_DEVICE_SECRET` values used by
the running API, then run:

```bash
.venv/bin/python -m backend.simulate
```

`BADEM_API_URL` optionally selects a different server; its default is
`http://127.0.0.1:8000`. The simulator creates a job, sends `STARTED`,
`HEARTBEAT`, and `FINISHED`, then prints the job and its three events.
The lifecycle is `CREATED -> RUNNING -> AWAITING_BUYER`. The response explicitly
reports `buyer_confirmation: NOT_IMPLEMENTED` and `chain: NOT_CONNECTED`.

## Signed Completion Proofs

`POST /api/proofs` requires exactly these seven JSON fields:

```json
{
  "node_id": "BADEM-001",
  "job_id": "JOB-0042",
  "event": "COMPLETED",
  "timestamp": 1760000000,
  "proof_hash": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "public_key": "<64 hex characters encoding the raw 32-byte Ed25519 public key>",
  "signature": "<128 hex characters encoding the raw 64-byte Ed25519 signature>"
}
```

This is a format example, not an ingestible proof: replace `job_id` with an
existing job ID returned by `POST /jobs` and sign with that node's registered
key. `event` must be `COMPLETED`. `timestamp` is a JSON integer in the range
0 through 9223372036854775807, representing Unix seconds. `node_id` and `job_id`
start with an ASCII letter or digit and otherwise allow letters, digits, `.`,
`_`, `:`, and `-`; their maximum lengths are 80 and 100 characters respectively.
`proof_hash` is either 64 hex characters or 32-44 Base58-alphabet characters.
Hashes are supplied evidence identifiers; the backend does not recompute them
from physical work. Additional fields, separators, whitespace, and malformed
key/signature encodings are rejected.

The canonical signed message is exactly:

```text
node_id|job_id|event|timestamp|proof_hash
```

Join those five values with literal `|` characters, serialize the integer
timestamp as ordinary decimal digits, and encode as UTF-8. There is no trailing
newline, whitespace, JSON serialization, prefix, hidden field, or additional
hashing step. Sign the resulting bytes with standard Ed25519. Preserve the
exact case and spelling of the five values. `public_key` and `signature` are
hex-encoded transport fields and are not part of the message. Hex key/signature
encodings may use either case; no Base58 decoding of those two fields is done.

### Register the Demo Node

Before starting the API, set:

```bash
export BADEM_NODE_ID=BADEM-001
export BADEM_NODE_PUBLIC_KEY="<trusted device's raw 32-byte public key in hex>"
```

The operator must obtain this public key from the intended node through a
trusted provisioning step. The configured node is bound to `BADEM_DEVICE_ID`,
and can only submit proofs for jobs whose `machine_id` equals that device ID.
The caller's `public_key` must match the configured key; presenting a new key
does not register a node. `BADEM_NODE_ID` defaults to `BADEM_DEVICE_ID` if
omitted. Registration is a single-node startup configuration, not a public
registration endpoint. Restart the service to change the registered key.

Without `BADEM_NODE_PUBLIC_KEY`, proof submissions return 403, but the original
API and HMAC simulator still run with the original three environment settings.
A malformed configured public key prevents startup.

After successful verification, one SQLite transaction stores the proof and
sets the job to `PROOF_RECEIVED`. This is allowed from `CREATED`, `RUNNING`, or
`AWAITING_BUYER`: the outbound-only flow does not require earlier HMAC events.
Failed or aborted jobs cannot be overwritten. The existing HMAC lifecycle and
job response fields are unchanged; `GET /jobs/{job_id}` shows the new status.
Proofs are stored in `production_proofs`, including the canonical message,
signature, event timestamp, and server receipt timestamp. Existing databases
gain this table on startup without rewriting their jobs or machine events.

The 201 response contains `proof_id`, `node_id`, `job_id`, `status:
PROOF_RECEIVED`, `signature_verified: true`, `buyer_confirmation:
NOT_IMPLEMENTED`, and `chain: NOT_CONNECTED`. A verified device signature
does not mean Solana verification or buyer approval.

| Status | Meaning |
| --- | --- |
| 401 | Well-formed signature fails verification |
| 403 | Unregistered node, mismatched public key, or wrong machine assignment |
| 404 | Referenced job does not exist |
| 409 | Duplicate node/job/event combination or incompatible job state |
| 422 | Missing/malformed fields, unsupported event, or unexpected extra fields |

Duplicates remain rejected after restart, even if the timestamp, hash, or
signature changes. Proof timestamps are signed assertions, not checked against
a freshness window, so delayed delivery can be ingested. The existing
five-minute timestamp window for `/machine-events` remains unchanged.

### Run the Signed-Proof Simulator

From `services/api`, before starting FastAPI, create a fresh local-only seed
and register its public key:

```bash
export BADEM_PROOF_TEST_SEED="$(openssl rand -hex 32)"
export BADEM_NODE_ID=BADEM-001
export BADEM_NODE_PUBLIC_KEY="$(.venv/bin/python -m backend.simulate_proof --public-key)"
.venv/bin/uvicorn backend.app:create_app --factory --reload
```

Also set the original `BADEM_ADMIN_KEY`, `BADEM_DEVICE_ID`, and
`BADEM_DEVICE_SECRET` settings from Local Setup. In a second terminal, use the
same admin key, device ID, node ID, and test seed, then run:

```bash
cd services/api
.venv/bin/python -m backend.simulate_proof
```

The helper creates a synthetic job, rejects a deliberately corrupted signature
with 401, submits the valid proof with 201, checks duplicate rejection with
409, and verifies the job is `PROOF_RECEIVED`. It prints the public payload and
results. Use `--job-id <existing-job-id>` to submit for an existing eligible
job, or `BADEM_API_URL` to choose a different server.

The test seed is private, ephemeral demo material held only in the environment;
the helper never prints or writes it. Generate a fresh seed for each local demo
and never use a production wallet here. Never commit test seeds, private keys,
Wi-Fi passwords, seed phrases, or RPC credentials. No device private key is
needed by the backend.

`cryptography==50.0.2` supplies maintained
Ed25519 key generation, signing, and verification; Python's standard library
and the existing requirements do not provide Ed25519 verification.
See [Proof of Production v0.1](../../docs/proof-of-production.md) for the full
contract and current hardware assumptions.

## Solana Devnet Anchoring

Raw machine telemetry remains off-chain. The ESP32 signs the production
event; the backend verifies the registered device's signature and stores it.
An operator can then anchor one deterministic commitment to the complete
seven-field verified proof. Solana provides the final proof's immutable
verification/provenance layer, not machine control, job delivery, or payment.
The Memo program records the hash and payer signature; it does not re-verify
the ESP32 signature or independently establish successful physical work.

Install the requirements again to add the single new direct dependency,
`solders==0.29.0`, for maintained Solana transaction encoding/signing.
No existing dependency is upgraded. HTTPX remains the JSON-RPC transport.

Configure these in the **API process environment** before anchoring:

| Setting | Meaning |
| --- | --- |
| `SOLANA_RPC_URL` | HTTPS Devnet RPC endpoint, e.g. `https://api.devnet.solana.com` |
| `SOLANA_PAYER_KEYPAIR_PATH` | Preferred: readable local Solana CLI JSON keypair file outside the repository; `~` is expanded |
| `SOLANA_PAYER_PRIVATE_KEY` | Alternative: Base58-encoded 64-byte Solana keypair, or JSON array of 64 integer bytes |
| `SOLANA_CLUSTER` | `devnet` only; defaults to `devnet` |

Use a separate test payer with Devnet SOL to pay network fees, not the device
wallet or a production wallet. There are no SOL transfers, payments, escrow,
or automatic airdrops. Do not commit private keys, seed phrases, or RPC
credentials. `.env.example` contains public placeholders only; `.env` and
local wallet/keypair files are ignored. The API does not automatically load
dotenv files. Set exactly one payer source; configuring both is rejected.
Prefer the local keypair file without copying its contents into the environment:

```bash
export SOLANA_RPC_URL=https://api.devnet.solana.com
export SOLANA_CLUSTER=devnet
unset SOLANA_PAYER_PRIVATE_KEY
export SOLANA_PAYER_KEYPAIR_PATH="$HOME/.config/solana/badem-devnet-payer.json"
```

The original BADEM admin/device/node settings are still required. Ingestion
and HMAC events work without Solana configuration; anchoring returns 503 if
it is missing/invalid. The RPC's genesis hash must match the known Devnet
cluster, so a misconfigured mainnet RPC cannot receive a transaction.

### Deterministic Commitment

Canonical field order is exactly:

```text
BADEM_PROOF_ANCHOR_V1|node_id|job_id|event|timestamp|proof_hash|public_key|signature
```

`event` is `COMPLETED`; timestamp is ordinary nonnegative decimal Unix
seconds. Preserve the exact signed `node_id`, `job_id`, and `proof_hash`
text, including proof-hash case or Base58 spelling. Normalize only the
hex-encoded public key and signature to lowercase. Use literal ASCII `|`
separators and UTF-8 encoding, with no newline, NUL, whitespace, JSON, or
extra hashing layer. `anchor_hash` is lowercase hexadecimal **SHA-256** of
these bytes. All seven verified production fields are committed, including
the device signature. Server proof ID/receipt time, job metadata, telemetry,
RPC configuration, payer, and transaction blockhash are not included.
The original five-field ESP32 signing format is unchanged.

The only Memo instruction data is:

```text
BADEM:proof:v1:sha256:<64-character anchor_hash>
```

It targets `MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr`, with the backend
payer as signer. No custom program deployment is needed.

### Anchor Endpoint and Recovery

Use the `proof_id` returned by successful ingestion:

```bash
curl -X POST -H "X-Admin-Key: $BADEM_ADMIN_KEY" \
  "http://127.0.0.1:8000/api/proofs/$PROOF_ID/anchor"
```

The backend re-verifies the persisted proof against the registered device,
its canonical message, and machine assignment. A job must be
`PROOF_RECEIVED`. SQLite gains a separate `proof_anchors` table on startup;
existing proofs and their wire format are not rewritten. The prepared signed
transaction, signature and last-valid block height are durably stored as
`PENDING` **before** broadcast. These bytes contain no private key.

After RPC reports `confirmationStatus: finalized` and `err: null`, one
SQLite transaction sets anchor `status: ANCHORED`, stores `anchored_at`
(server Unix seconds), and changes the job to `PROOF_ANCHORED`. HTTP 200
returns the stored `anchor_hash`, `transaction_signature`, `cluster: devnet`,
timestamp, status, confirmation, and Explorer URL. `GET /jobs/{job_id}` then
reports `chain: SOLANA_DEVNET`; buyer confirmation remains `NOT_IMPLEMENTED`.

| Status | Meaning |
| --- | --- |
| 200 | Finalized anchor receipt, including idempotent repeats |
| 401 | Missing/invalid admin key |
| 404 | Proof does not exist |
| 409 | Unverified/tampered proof, incompatible job state, or failed/expired anchor |
| 502 | RPC/network/response failure; no anchored state is claimed |
| 503 | Missing/invalid Solana environment configuration |
| 504 | Transaction not finalized within polling window; receipt remains `PENDING` |

Read `GET /api/proofs/{proof_id}/anchor` for `NOT_ANCHORED`, `PENDING`,
`FAILED`, or `ANCHORED` without contacting RPC. Reads do not reconcile
pending transactions. Repeat the same POST to reconcile: the backend checks
historical signature status first, validates the stored signed Memo, and
may rebroadcast only the exact same signed bytes/signature while valid.
Concurrent requests share the single persisted transaction. Once anchored,
duplicates return the existing receipt without another RPC call.

An RPC send acknowledgment, `processed`, or even `confirmed` is not enough
for this implementation to mark the job anchored. A timeout/lost response
can mean the transaction actually landed; do not delete pending receipts or
create a replacement. Execution errors and expired transactions not found
by the history-aware check become `FAILED` and require operator review.
There is intentionally no automatic new transaction after failure/expiry,
and no background reconciliation worker in this milestone.

From the repository root, an optional live script calls the same authenticated
endpoint for **one existing proof**, and prints only a finalized receipt's
transaction signature and Devnet Explorer URL:

```bash
services/api/.venv/bin/python solana/scripts/anchor_proof.py "$PROOF_ID"
```

The script uses `BADEM_ADMIN_KEY` and optional `BADEM_API_URL` (default
`http://127.0.0.1:8000`). Solana RPC/payer settings belong to the running
backend, not to the ESP32. See [Solana setup](../../solana/README.md).

## Run Tests

From `services/api`:

```bash
.venv/bin/python -m pytest -q
```

The complete existing suite covers admin/device authentication, ordered
event transitions, sequence validation, duplicate event rejection, and the
explicit buyer/chain limitations. Tests use temporary SQLite databases and
do not require a running API.
The proof tests additionally cover valid signature persistence, state changes,
registered identity and machine binding, malformed inputs, tampering, unknown
jobs, duplicate races/restarts, and existing database compatibility.
The anchoring tests mock all Solana RPC methods and block real RPC transport.
They generate unfunded ephemeral keys in memory, require no internet/Devnet,
and cover deterministic canonical hashes, valid Memo signatures, persistence,
admin authorization, failures, finalization, concurrency, retries and restarts.
Run just these with `.venv/bin/python -m pytest -q tests/test_solana_anchor.py`.

## Hardware Event Contract

Send a POST to `/machine-events` with a UTF-8 JSON body:

```json
{"event_id":"unique-id","job_id":"uuid-from-api","machine_id":"laser-01","sequence":1,"event_type":"STARTED","observed_at":1790590000}
```

Use a current Unix timestamp for `observed_at`. Headers are
`Content-Type: application/json`, `X-Device-Id: laser-01`, and
`X-Signature: <lowercase hex HMAC-SHA256 over the exact request body using
BADEM_DEVICE_SECRET>`. Requests are limited to 4096 bytes. Event IDs must be
unique, and `sequence` starts at 1 per job and increments without gaps.
The device clock must be within five minutes of the server. Events are accepted
in the order `STARTED`, zero or more `HEARTBEAT`, then `FINISHED`, `ERROR`, or
`ABORTED`. `ERROR` produces `FAILED`; `ABORTED` produces `ABORTED`.

This endpoint is an integration contract, not an assertion that a real
controller currently emits these events. Confirm the actual electrical
signal, GRBL status response, timing, and communication channel before writing
firmware against it. Do not attach this software to laser control or safety
interlocks. See [the hardware handoff](docs/hardware-handoff.md) for the
questions needed to wire the adapter.

## Current Limitations

- Real ESP32 integration still needs end-to-end testing. Milestone 02B added
  compatible signing/POSTing; simulator data and a device's completion
  heuristic do not independently prove physical machine operation.
- Buyer confirmation and buyer wallet signing are not part of this milestone.
  HMAC `FINISHED` leaves a job `AWAITING_BUYER`; a valid completion proof changes
  it to `PROOF_RECEIVED`, not buyer-confirmed.
- Devnet Memo anchoring is optional and requires live validation with a funded
  disposable payer. Devnet may reset and is not a production permanence
  guarantee. A Memo commits evidence, not on-chain device-signature validation.
- Pending anchors need an explicit repeated POST to reconcile. Failed/expired
  attempts require operator review; no replacement transaction is generated.
- One device ID, HMAC secret, and optional registered node public key are
  configured for this prototype. Multi-device provisioning, key rotation APIs,
  and separate secrets per device are not implemented.
- Jobs store a supplied file SHA-256, not the manufacturing file itself.
- Buyer rejection, timeout, and dispute handling are not implemented.
