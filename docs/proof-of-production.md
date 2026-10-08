# BADEM Proof of Production v0.1

Milestone 02 verifies registered-device completion attestations; Milestone 02B
adds compatible ESP32 signing/POSTing. Milestone 03 adds optional backend
Solana Devnet anchoring of a deterministic final production proof hash.
None independently proves physical production or obtains buyer approval.

## Production Flow

1. The machine completes real physical work.
2. The ESP32-based BADEM Node detects completion from the machine/controller.
3. The node constructs a proof for an existing backend job, its node identity,
   completion event, Unix timestamp, and evidence hash.
4. The node signs the canonical message with its Ed25519 private key.
5. The backend validates the fields, registered identity, job existence,
   machine assignment, and Ed25519 signature.
6. The backend stores the verified device proof and sets `PROOF_RECEIVED`.
7. An authorized operator requests a Devnet Memo anchor of the verified proof.
8. After successful transaction finalization, the backend stores its signature
   and changes the job to `PROOF_ANCHORED`.

Steps 1-4 describe the intended hardware flow. The local simulator exercises
steps 3-6 with synthetic data. Real ESP32 integration still needs end-to-end
testing, and inbound job delivery is outside this milestone.

## Payload and Canonical Message

Send JSON to `POST /api/proofs`:

```json
{
  "node_id": "BADEM-001",
  "job_id": "JOB-0042",
  "event": "COMPLETED",
  "timestamp": 1760000000,
  "proof_hash": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "public_key": "<64 hex characters: raw 32-byte Ed25519 public key>",
  "signature": "<128 hex characters: raw 64-byte Ed25519 signature>"
}
```

The identifiers and timestamp here are examples. The API creates UUID job IDs;
the node must know the actual job ID through an operator/out-of-band mapping
before submitting a proof. There is no inbound job-delivery mechanism yet.

The exact signed UTF-8 bytes are:

```text
node_id|job_id|event|timestamp|proof_hash
```

For the example above, the message is:

```text
BADEM-001|JOB-0042|COMPLETED|1760000000|aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
```

There is no newline at the end. Use literal ASCII `|` separators and ordinary
decimal digits for the nonnegative integer timestamp. No JSON, prefix,
whitespace, hidden fields, extra digest, or Solana transaction bytes are
signed. Use standard Ed25519, not Ed25519ph. The public key and signature are
hex-encoded transport fields, not signed fields.

`node_id` and `job_id` begin with an ASCII letter/digit; remaining characters
may be letters, digits, `.`, `_`, `:`, or `-`. Maximum lengths are 80 and 100.
This excludes separators, whitespace, and line breaks from identifiers.
`event` is exactly `COMPLETED`. `timestamp` is a JSON integer from 0 through
9223372036854775807. `proof_hash` is 64 hex characters or 32-44 characters from
the Base58 alphabet `123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz`.
The backend validates the hash text's shape, but does not decode or recompute
the evidence digest. Preserve exact case and spelling in the signed message.
Hex public keys/signatures accept either case but no whitespace. Other fields
are rejected.

## Registered Identity

The operator configures `BADEM_NODE_PUBLIC_KEY` with the trusted node's raw
32-byte Ed25519 public key encoded as 64 hex characters, and optionally sets
`BADEM_NODE_ID` (default: `BADEM_DEVICE_ID`). This single node is bound to the
configured `BADEM_DEVICE_ID`, which must match the job's `machine_id`.

The supplied public key is never trusted by itself. It must match the
operator-configured key, and the configured node must match `node_id`. The
backend verifies with the registered key. There is no unauthenticated key
registration endpoint. Without a registered key, proof submissions fail
closed with 403 while the original HMAC API remains available. Malformed
registered public keys fail startup. Key changes require a service restart.

The existing `X-Admin-Key` authentication for jobs and HMAC authentication for
machine events are unchanged. The new endpoint authenticates the canonical
message with Ed25519 and does not require the node to know the admin key or
HMAC secret.

## Storage and Job State

Successful ingestion returns HTTP 201 with a proof ID, `signature_verified:
true`, and `status: PROOF_RECEIVED`. SQLite stores all seven payload fields,
the canonical message, the proof ID, and the server receipt timestamp in
`production_proofs`, referencing the job.

Proof insertion and the state change happen in the same transaction. A unique
constraint on `(node_id, job_id, event)` prevents duplicate proofs, including
concurrent submissions and retries after restart. Changing the signature,
timestamp, or hash does not bypass duplicate detection; duplicates return 409.

An existing job in `CREATED`, `RUNNING`, or `AWAITING_BUYER` can become
`PROOF_RECEIVED`. Earlier HMAC events are not required for this outbound-only
demo. `FAILED` and `ABORTED` jobs cannot be overwritten. The original HMAC
event transitions and `GET /jobs/{job_id}` response fields are preserved;
that endpoint exposes the updated status but does not add a proof listing.

An invalid signature returns 401; an unauthorized node/key/machine returns
403; an unknown job returns 404; duplicates or invalid job states return 409;
malformed fields and unsupported events return 422. Rejected submissions do
not store a proof or alter the job.

Proof timestamps are signed claims without a freshness check, permitting
delayed delivery. They are distinct from the server receipt timestamp.
The existing HMAC event timestamp tolerance remains five minutes.

`PROOF_RECEIVED` means a registered device signature verified. Responses still
report `buyer_confirmation: NOT_IMPLEMENTED` and `chain: NOT_CONNECTED`.
Buyer confirmation is not part of this milestone, and Solana anchoring is
separate from verified ingestion. Anchoring is performed only by an explicit
admin request; `PROOF_RECEIVED` alone is not an on-chain claim.

## Deterministic Final Anchor

All raw machine telemetry, manufacturing files, event logs and the complete
device-signed record remain **off-chain**. The backend anchors only a SHA-256
commitment to the seven-field verified production proof, not verbose telemetry.
Solana is the immutable verification/provenance layer for that final hash;
Devnet demonstrates the flow but can reset and is not production permanence.

The exact anchor canonical format is:

```text
BADEM_PROOF_ANCHOR_V1|node_id|job_id|event|timestamp|proof_hash|public_key|signature
```

The first token is a fixed domain/version tag. Append the seven values in
that order, joined by ASCII `|`, encoded as UTF-8 with no newline, terminating
NUL, JSON, spaces, or hidden fields. `event` is exactly `COMPLETED`;
`timestamp` is decimal Unix seconds. Preserve the signed node ID, job ID, and
proof-hash text exactly. Only public-key and signature hex are lowercased,
so equivalent hex transport casing produces the same commitment. Do not
normalize `proof_hash`, including uppercase hex or Base58 spelling.

`anchor_hash = SHA256(canonical_anchor_bytes).hexdigest()` (lowercase hex).
This commits to the complete verified production proof and its device
signature. Database proof IDs, server receipt time, job metadata, RPC
settings, backend payer and transaction blockhash are excluded; none are
part of the device's seven-field production record. The existing device
canonical message and signature scheme above are **unchanged**.

The backend constructs a single Memo instruction for
`MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr`, containing only:

```text
BADEM:proof:v1:sha256:<anchor_hash>
```

The backend's separate Devnet payer signs the Solana transaction. The ESP32
signs the production event, not this transaction; its private key is never
sent to the backend. The Memo program records the commitment and payer
signature. Device-signature verification remains off-chain in FastAPI, and
can be repeated by an auditor with the retained signed record and trusted
node-registration information. An auditor recomputes the anchor hash and
compares it with the finalized transaction's Memo. A Memo is not independent
proof that physical work succeeded or an on-chain buyer confirmation.

## Anchor Lifecycle and API

`POST /api/proofs/{proof_id}/anchor` requires `X-Admin-Key`. It requires an
existing, still-verifiable registered-device proof and the matching job in
`PROOF_RECEIVED`. Repeated successful requests return the same receipt.
`GET /api/proofs/{proof_id}/anchor` reads the stored status/receipt with the
same authentication; it does not contact RPC or advance pending state.

SQLite adds `proof_anchors` with one row per proof. It stores `anchor_hash`,
`transaction_signature`, `cluster`, `status`, `anchored_at`, and the signed
transaction bytes/last-valid block height needed for safe recovery. The
signed bytes are persisted as `PENDING` before broadcast and contain no
private keys. Existing device proofs and jobs are not rewritten at startup.

Only RPC `confirmationStatus: finalized` with `err: null` sets `ANCHORED`
and a server Unix `anchored_at` timestamp. Receipt finalization and the job's
`PROOF_RECEIVED -> PROOF_ANCHORED` transition commit together. The response
includes `https://explorer.solana.com/tx/<signature>?cluster=devnet`;
`GET /jobs/{job_id}` reports `chain: SOLANA_DEVNET` only after anchoring.

An RPC send response, `processed`, `confirmed`, failure, or timeout does not
mean anchored. RPC errors return 502; polling timeouts return 504 and leave
the receipt `PENDING` and job `PROOF_RECEIVED`. Repeat the same POST to
query historical signature status and, if necessary, rebroadcast only the
same signed transaction. No fresh blockhash/signature is created for a
pending attempt, including after restart or concurrent requests.

Execution errors or an expired signature absent from the history-aware
lookup produce `FAILED`/409, not an automatic replacement. Operator
reconciliation is required. Missing proofs return 404, unverified/tampered
proofs or incompatible job states 409, invalid admin credentials 401, and
missing/invalid environment configuration 503. There is no background worker
for anchors. Never discard pending receipts just because a request timed out.

RPC URL and the separate payer private key are environment-only configuration
(`SOLANA_RPC_URL`, `SOLANA_CLUSTER=devnet`, and exactly one of
`SOLANA_PAYER_KEYPAIR_PATH` or `SOLANA_PAYER_PRIVATE_KEY`). Prefer a local
Solana CLI JSON keypair file outside the repository; its contents are never
printed or copied into tracked files. The
backend refuses non-Devnet genesis hashes. No key/seed phrase is committed,
and automated tests mock RPC and use ephemeral unfunded keys.

## Current Hardware Assumptions

The inspected sketch is `firmware/badem-node/badem-node-poc.ino`:

- It polls the MKS DLC32 over TCP/Telnet and treats `Run` or `Hold` followed by
  `Idle` as completion. This signal alone does not establish which backend job
  ran, whether work succeeded, or what evidence should be hashed.
- Milestone 02B imports the local Solduino machine wallet, uses raw Ed25519
  signing, prints the raw public key as hex, and POSTs the original proof format.
- Node/job association is manually configured. The demo evidence hash is a
  digest of completion metadata, not an independently validated sensor log.
- NTP synchronization, controller behavior, queue loss/retry assumptions,
  local Wi-Fi and API reachability still need physical end-to-end validation.
- Credentials are in local ignored firmware secrets, not committed source.

The firmware is unchanged by Milestone 03. Agree the job mapping,
completion signal, evidence construction, timestamp source, raw-message
signing, encodings, backend URL, and retry behavior with Nenad before the
physical end-to-end test. A lost successful HTTP response results in a 409
on retry, not a second stored proof.

See [the API README](../services/api/README.md) for setup, node configuration,
the ephemeral signed-proof simulator, and test commands. Milestone 03 adds
only `solders==0.29.0` for maintained Solana transaction encoding/signing;
existing FastAPI, Uvicorn, HTTPX, pytest and cryptography pins are unchanged.
See [Solana setup](../solana/README.md) for the optional manual Devnet script.
No inbound jobs, payments, escrow, custom Solana program, or buyer approval
are implemented.
