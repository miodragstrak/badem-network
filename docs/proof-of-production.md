# BADEM Proof of Production v0.1

Software Milestone 02 implements outbound signed completion proof ingestion.
It verifies a registered device's attestation. It does not independently prove
physical production, obtain buyer approval, or anchor evidence on Solana.

## Production Flow

1. The machine completes real physical work.
2. The ESP32-based BADEM Node detects completion from the machine/controller.
3. The node constructs a proof for an existing backend job, its node identity,
   completion event, Unix timestamp, and evidence hash.
4. The node signs the canonical message with its Ed25519 private key.
5. The backend validates the fields, registered identity, job existence,
   machine assignment, and Ed25519 signature.
6. The backend stores the verified device proof and sets `PROOF_RECEIVED`.
7. Solana anchoring is a later step and is not performed by this milestone.

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
not implemented yet.

## Current ESP32 Prototype Gaps

The inspected sketch is `firmware/badem-node/badem-node-poc.ino`:

- It polls the MKS DLC32 over TCP/Telnet and treats `Run` or `Hold` followed by
  `Idle` as completion. This signal alone does not establish which backend job
  ran, whether work succeeded, or what evidence should be hashed.
- It loads a Solduino wallet and prints its Base58 public address. The backend
  accepts the same raw Ed25519 public key bytes in hex, not a Base58 address.
- It does not currently assign `node_id`/`job_id`, produce a Unix timestamp or
  evidence hash, sign the canonical message, or POST a proof to `/api/proofs`.
- Its signing code is a commented-out Solana transaction prototype. A
  signature over serialized transaction bytes will not verify against the
  BADEM canonical message. Raw-message signing with the wallet still needs
  implementation and testing on the actual ESP32 library.
- Its Wi-Fi and private-key literals are placeholders. Actual credentials
  must stay outside tracked files; never replace them with production secrets
  in a commit.

The firmware is unchanged by this backend milestone. Agree the job mapping,
completion signal, evidence construction, timestamp source, raw-message
signing, encodings, backend URL, and retry behavior with Nenad before the
physical end-to-end test. A lost successful HTTP response results in a 409
on retry, not a second stored proof.

See [the API README](../services/api/README.md) for setup, node configuration,
the ephemeral signed-proof simulator, and test commands. The single new direct
dependency is `cryptography==50.0.2` for maintained Ed25519 primitives; the
existing FastAPI, Uvicorn, HTTPX, and pytest pins are unchanged.
