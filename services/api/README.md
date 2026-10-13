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

## Manufacturing Discovery

`backend/discovery/` adds an isolated manufacturing discovery flow. Milestone 01
introduced the mock provider; Milestone 02 adds opt-in Google Places searches.
Discovery does not create execution jobs, contact machines, verify suppliers,
perform cryptographic operations, scrape websites, or call Solana.
The existing proof, event and anchor routes are unchanged. These new routes
reuse the API's SQLite transaction helper and `X-Admin-Key` authentication.

| Endpoint | Purpose |
| --- | --- |
| `POST /api/manufacturing-requests` | Create a `DRAFT` manufacturing request; HTTP 201 |
| `GET /api/manufacturing-requests/{id}` | Read the manufacturing request |
| `POST /api/manufacturing-requests/{id}/specification` | Store structured JSON; HTTP 201 initially, 200 on replacement |
| `GET /api/manufacturing-requests/{id}/specification` | Read the current specification and its JSON `payload` |
| `POST /api/manufacturing-requests/{id}/discover` | Build and persist ranked public-data partner candidates |
| `GET /api/manufacturing-requests/{id}/candidates` | Read persisted rankings without running discovery |
| `GET /api/partner-candidates/{candidate_id}` | Read a detailed `partner_profile` |

The four additive tables are `manufacturing_requests`,
`manufacturing_specifications`, `partner_candidates` and
`public_capacity_profiles`. Specifications and derived profiles are stored as
JSON, with foreign keys and one current specification/profile per parent.
Public Capacity Profile is the internal derived model, not a Google business
profile. Sources are `MOCK_PUBLIC_DATA` or `GOOGLE_PLACES`; no schema migration
is required for the Google provider.

State flow: `DRAFT -> SPECIFIED -> DISCOVERY_READY -> DISCOVERY_COMPLETE`.
Provider I/O runs outside SQLite write transactions. Discovery readiness,
replacement and completion commit atomically; failures keep the previous status
and results. A specification changed during a search returns 409 instead of
persisting stale rankings. Discovery without a specification also returns 409.
Unknown entities and missing specifications return 404.

A specification requires nonempty `process` and `materials` string lists;
taxonomy terms are not an enum. Quantity, dimensions, requirements and location
are optional. Additional JSON fields round-trip, with a 64 KiB limit and finite
JSON values. Request quantity/location metadata may initially be omitted.
Specifications are supplied directly: no LLM parsing or location geocoding.
Scoring uses specification location, not parsing of request `location_text`.

The fictional fixtures cover laser, CNC, maker, 3D-print and sparse workshop
signals. API results are explicitly `MOCK_PUBLIC_DATA` and `is_mock: true`.
Every candidate/profile reports `PUBLIC_DATA_ONLY` and the disclaimer:
"Potential fit based on public data. Production capability has not been verified."
Scores and inferred capabilities never establish real production capability.
Profile confidence is a conservative signal-coverage heuristic (`low`/`medium`),
not a calibrated probability or supplier verification.

Scoring is deterministic, with `score_breakdown` and `reasoning` exposed:

| Category | Maximum |
| --- | --- |
| Process match | 40 |
| Material signal | 20 |
| Equipment/capability signal | 15 |
| Business specialization | 10 |
| Location suitability | 10 |
| Public activity signal | 5 |

Multi-process/material requests receive proportional, rounded credit; duplicate
normalized terms do not inflate scores. Wood/plywood share a coarse public-signal
family. Location earns 10 for the same city (without conflicting country), 5 for
the same country only, or zero when unknown/mismatched; no distance is invented.
Labels are `Strong potential fit` (82-100), `Potential fit` (60-81), `Possible fit`
(40-59) and `Low-confidence fit` (below 40). Quantities, tolerances, current
availability and output quality are not validated by this heuristic.

Rediscovery atomically replaces only that request's results. Candidate/profile
IDs and creation times remain stable for unchanged source/place IDs;
`last_refreshed_at` advances. Ranking ties use source place IDs.
Replacing a specification keeps its ID and creation time, returns the request
to `SPECIFIED`, and deletes stale candidates/profiles until discovery is rerun.
There is no result history, onboarding, outreach, quote, payment or marketplace
workflow in this milestone.

### Google Places Discovery (Milestone 02)

| Environment variable | Behavior |
| --- | --- |
| `BADEM_DISCOVERY_PROVIDER` | `mock` (default) or `google_places`; read at API startup |
| `GOOGLE_PLACES_API_KEY` | Required only for `google_places`; server-side environment only |

Google selection without a nonempty key, or an unknown provider name, raises a
clear startup configuration error. It never silently falls back to fictional
results. Restart after changing provider configuration. Existing API/device
environment settings and admin authentication are still required. Enable Places
API (New) and billing in the Google project, and restrict the server key to the
appropriate API and backend deployment. Never put it in frontend configuration,
source control, a URL or application logs.

Both providers implement `discover(specification) -> list[PublicPartnerData]`.
The service derives Public Capacity Profiles and applies the same scoring
weights/thresholds regardless of source. Google results are `GOOGLE_PLACES`,
`is_mock: false`, and carry the actual Place ID in detailed `source_place_id`.
Stored nonempty results retain their source even after switching providers.
For empty results, `provider` identifies the currently configured provider;
the existing domain does not store historical provider metadata for empty runs.
Every candidate/profile remains `PUBLIC_DATA_ONLY` with the unchanged disclaimer:
"Potential fit based on public data. Production capability has not been verified."
Google Places is only a discovery source, not a capability inventory or supplier
verification service.

The deterministic query builder uses structured specification processes,
materials and explicit city/country. It ignores quantity, dimensions and free-text
requirements; it does not parse request `location_text`. Supported query families
include laser engraving/cutting, CNC machining/wood, 3D printing, prototyping and
maker workshops. Multiple processes share the query budget round-robin, in
stable normalized process order. Unknown-only process taxonomies return an
empty completed discovery without a generic paid search. Canonical scoring
taxonomy remains unchanged (`cnc_milling`, for example).

For laser engraving on plywood in Belgrade, RS, the queries are:

```text
laser engraving service wood Belgrade RS
laser engraving workshop wood Belgrade RS
custom laser engraving wood Belgrade RS
```

CNC on wood starts with `CNC wood machining service Belgrade RS`; 3D printing
starts with `3D printing service Belgrade RS`.

The client sends `POST https://places.googleapis.com/v1/places:searchText` with
`pageSize: 5`, `languageCode: en` and this exact `X-Goog-FieldMask`:

```text
places.id,places.displayName,places.addressComponents,places.primaryType,places.types
```

Structured address components provide locality and country without guessing from
a formatted address or assigning the requested location to search results.
Unused formatted addresses and coordinates are not requested. Names, address
components and type fields use the Text Search Pro tier, not ID-only pricing;
see [Google's field-mask and billing documentation](https://developers.google.com/maps/documentation/places/web-service/text-search).
No wildcard, website, reviews, ratings, phone numbers, opening hours, photos,
pagination or automatic retries are used in base Text Search. Milestone 03
adds the separate bounded Place Details stage below, without widening this mask.

Hard limits (constants, not unbounded environment overrides):

- Maximum 3 queries per discovery run.
- Maximum 5 results per query, also enforced when reading the response.
- Maximum 10 unique candidates; stop searching once reached.
- HTTPX timeout of 5 seconds for each connect/read/write/pool operation.
- Clients close after each request; environment proxy settings are ignored.

Place IDs deduplicate listings across queries; the first valid listing wins.
Normalization uses returned names, structured locations and listing types only.
Types populate the existing public specialization signals; explicit material
words in names supply conservative material keywords. Business names/types
may suggest a process; search query terms never become evidence. No equipment,
website/review evidence, activity, capacity or availability is invented. Missing
signals receive no score, so these minimal Google profiles often have low
confidence and lower scores than richer fictional fixtures. Only existing
normalized profile fields and source IDs are persisted, not raw Places payloads.
The selected top candidates can additionally carry the derived enrichment
metadata described below.

Timeouts return HTTP 504; upstream non-2xx, connection/protocol failures, invalid
JSON and malformed response containers return HTTP 502 with sanitized messages.
Upstream bodies, headers and credentials are not returned or logged. Valid
empty searches (including Google's omitted `places` field) complete normally.
Malformed individual entries/IDs are skipped; missing optional fields are
tolerated without inferring location or capabilities. A failed refresh never
partially replaces candidates or changes the completed request's status.

Before public production use, review applicable Google Maps Platform storage,
attribution, Terms of Use and Privacy Policy requirements. Place IDs are exempt
from caching restrictions; that exemption does not automatically cover business
names/locations/types retained inside these derived profiles. This prototype's
existing persistent profile model has no automatic expiry or attribution UI;
do not assume it meets production retention/display rules merely because raw
payloads are not stored. See [Places API policies](https://developers.google.com/maps/documentation/places/web-service/policies).

### Multilingual Public Signals (Milestone 02C)

`discovery/signals.py` extracts English and Serbian Latin public signals from
the existing display name and primary/type values. Case folding, Unicode NFKD
normalization, combining-mark removal and punctuation/underscore tokenization
make Serbian Latin diacritics match ASCII equivalents (`secenje`, `stampa`,
`sperploca`; D-with-stroke becomes `dj`).
Matches use whole tokens/phrases, not fuzzy matching or company-name lookups.
Bounded word forms allow graver/engraver suffix compounds and wood-derived
forms such as woodworking, woodcraft and wooding; unrelated words such as
graverobber, Hollywood and plasticity do not match.

Process families are laser engraving, laser cutting, CNC machining (the existing
canonical `cnc_milling`), 3D printing and prototyping. Material families cover
wood/plywood, metal/steel/aluminum and plastic/acrylic/PLA/ABS. Specific material
words may support their broader family, but generic metal/plastic does not
establish a specific alloy/polymer. The existing coarse wood/plywood match is
retained. Location/address context contributes only to location scoring, never
to manufacturing process/material evidence. Google location comparisons also
normalize Latin diacritics while still rejecting conflicting countries.

Furniture/carpentry terms (`namestaj`, including its accented Serbian spelling,
`stolar`, `stolarija`, `furniture`, `woodwork`, `woodworking`) contribute a
wood-related material signal only, not process, equipment or process-specific
specialization evidence. For example, the Woodproject furniture-name fixture
earns 20 material points for wood/plywood (30 total with a matching city), with
zero process/equipment/specialization points. This is a coarse public signal,
not confirmation of plywood stock, production capability or product quality.

For Google profiles, explicit process phrases can earn 40 process and 10
specialization points. Engraving/milling-only terms earn 60% of those categories;
generic CNC earns 80%. A generic laser-only signal earns 25% process credit and
50% specialization credit. Multiple requested processes receive proportional
credit; duplicate terms/sources do not accumulate points. Explicit laser
engraving/cutting does not also imply the other laser process. Category maxima,
fit thresholds, quantity/capacity caveats and the API response structure are
unchanged. Mock fixtures retain their existing extraction, scores and reasoning.

Inferred capabilities retain `capability`, `confidence` and `evidence`, now
including matched normalized phrases and their name/type source. Confidence is
a rule-based specificity heuristic, not a verified capability or calibrated
probability: explicit phrases use .75; weaker engraving/milling .55, CNC .60,
and generic laser .30. Stronger repeated evidence wins rather than stacking
confidence. Profile confidence remains `low`/`medium`; equipment/activity fields
remain zero at base discovery. No new Google fields or network calls are
introduced by extraction; optional enrichment changes only public activity and
public-business signal coverage, never inferred process evidence or equipment.

Deterministic name fixtures below use generic place types, Belgrade/RS, and a
laser-engraving/plywood request. These are unit-test examples, not another live
Google validation:

| Public name | Previous score | New score |
| --- | --- | --- |
| Penda lasersko graviranje | 10 | 60 |
| graver doo | 10 | 40 |
| Tenzor Laser | 10 | 25 |
| Laser Print - Reklamni materijal i brendiranje | 10 | 25 |
| Wooding Studio | 10 | 30 |
| General repair workshop | 10 | 10 |

All results remain `PUBLIC_DATA_ONLY` with the exact existing disclaimer.
Stored results are snapshots: rerun the existing authenticated discovery POST
to rebuild profiles and rankings; GET does not rescore or contact Google.

### Top-Candidate Enrichment (Milestone 03)

With the Google provider, the existing discovery POST ranks the complete base
candidate set, then enriches only the base top 3 by default. Ties use Place ID,
as in persisted rankings. The selection is frozen before enrichment; there is
no feedback loop that fetches more candidates after their scores change.
Successful enrichment is rescored and final rankings are persisted atomically.
All search/detail I/O remains outside SQLite write transactions. Mock discovery
is unchanged, and existing stored/non-enriched profiles remain valid.

`BADEM_DISCOVERY_ENRICH_TOP_N` is read at Google provider startup: default `3`,
allowed integer range `0` through `5`. `0` disables details while preserving
Google Text Search; invalid/out-of-range values fail clearly instead of silently
raising the budget. The service also enforces the hard maximum of 5. Mock mode
does not use this setting. For example, set it before starting the API:

```bash
export BADEM_DISCOVERY_PROVIDER=google_places
export BADEM_DISCOVERY_ENRICH_TOP_N=3
```

Each selected candidate gets at most one request:

```text
GET https://places.googleapis.com/v1/places/{source_place_id}
X-Goog-FieldMask: websiteUri,rating,userRatingCount,businessStatus
```

The same server-side environment key goes in `X-Goog-Api-Key`, never the URL.
The client retains the 5-second connect/read/write/pool timeouts, closes after
each request, ignores environment proxies, and does not follow redirects,
paginate, retry or follow moved-place IDs. No reviews, photos, phone numbers,
opening hours, summaries, duplicate name/type fields, website crawling, scraping
or LLMs are requested or used. Only URI presence is checked; the website is
never fetched and its text/URL terms do not become manufacturing evidence.

The mask invokes the Place Details Enterprise SKU because website and rating
fields are included; these are additional potentially billable requests beyond
the unchanged Text Search Pro calls. See the verified
[Place Details field masks](https://developers.google.com/maps/documentation/places/web-service/place-details)
and [field/SKU table](https://developers.google.com/maps/documentation/places/web-service/data-fields).
Maximum requests per discovery: 3 searches plus 3 details by default (6 total),
or 3 searches plus 5 details with the largest setting (8 total). Empty/smaller
result sets consume no unused detail budget. Use `0`, Google project quotas and
billing limits when details are not appropriate for your deployment.

Detail enrichment contributes only inside the existing 0-5 public-activity
category: a valid HTTP(S) website URI contributes 1, a listed-operational
business 2, and rating coverage contributes 1 for 1-9 ratings or 2 for 10 or more.
Rating coverage requires a valid rating and positive count; rating magnitude
does not affect the score. Counts indicate cumulative public activity, not
recency, output quality or verified demand. Known closed/future-opening listings
receive zero activity credit regardless of historical website/ratings, while
their base candidate and manufacturing-name signals remain intact. Missing or
unknown business status supplies no operational points and no availability
claim. All process/material/equipment/specialization/location categories,
weights, maxima, fit thresholds and the exact disclaimer remain unchanged.
For example, a base score of 60 can become 65, not a verified capability.

Overall profile confidence can rise from `low` to `medium` only when an existing
process-name/type inference has confidence at least .5 and all three corroborate
the listing: a website, listed-operational status and at least 10 ratings with a
valid rating. A large rating count alone never upgrades confidence. Generic
laser-only or unrelated names remain low; medium never becomes high. Inferred
capability confidence/evidence is unchanged: this is public-business coverage,
not stronger proof of manufacturing ability, equipment, capacity or availability.

Only derived metadata is stored in the existing `profile_json` and exposed
through the existing detailed `partner_profile`; summary API fields are unchanged:

```json
{
  "enrichment": {
    "status": "ENRICHED",
    "signals": ["website_present", "operational_listing", "public_activity"],
    "public_evidence": {
      "website_present": true,
      "rating_present": true,
      "public_activity_signal_strength": "ESTABLISHED",
      "business_operational_signal": "LISTED_OPERATIONAL"
    }
  }
}
```

Evidence strength is `NONE`, `LIMITED` or `ESTABLISHED`; operational evidence is
`UNKNOWN`, `LISTED_OPERATIONAL` or `LISTED_NON_OPERATIONAL`. URLs, raw ratings,
exact counts, raw status strings and entire Google detail payloads are transient,
not stored or logged. Missing optional fields can yield an `ENRICHED` result
with no signals and no score change. A timeout, non-2xx (including disappeared
places/404), transport error, invalid JSON or malformed fields records
`{"status":"UNAVAILABLE","signals":[]}` and preserves that candidate's base
score, confidence and reasoning; the remaining selections continue. It does
not fail discovery. Base provider-wide failures retain HTTP 502/504 and previous
persisted results. No background enrichment, caching or automatic refresh exists.

Profiles remain BADEM-derived, `PUBLIC_DATA_ONLY`, with the exact disclaimer.
Persisting coarse booleans/categories rather than raw details reduces retained
Google content, but is not an assertion of exemption from Google Maps Platform
terms. Before production use, review whether your agreement permits these
derived flags and existing profile storage, and address retention/attribution
requirements from the linked Places policies above. No long-term storage
permission for raw detail fields is assumed by this prototype.

### Try Google Discovery Locally

From `services/api`, after the existing Local Setup environment is configured:

```bash
export BADEM_DISCOVERY_PROVIDER=google_places
read -r -s -p 'Google Places API key: ' GOOGLE_PLACES_API_KEY
printf '\n'
export GOOGLE_PLACES_API_KEY
.venv/bin/uvicorn backend.app:create_app --factory --reload
```

In another terminal with the same admin key, create and specify a request using
the curl examples below, then run:

```bash
REQUEST_ID='<id of a request with a stored specification>'
curl -sS -X POST -H "X-Admin-Key: $BADEM_ADMIN_KEY" \
  "http://127.0.0.1:8000/api/manufacturing-requests/$REQUEST_ID/discover"
curl -sS -H "X-Admin-Key: $BADEM_ADMIN_KEY" \
  "http://127.0.0.1:8000/api/manufacturing-requests/$REQUEST_ID/candidates"
```

The curl call triggers bounded, potentially billable Google requests. Automated
tests instead use `httpx.MockTransport`; shared test fixtures clear discovery
credentials/configuration and block real sync/async HTTP transports. No live
Google or RPC validation is performed by the test suite.

### Try Discovery With Curl

Start the API using the existing Local Setup / Run FastAPI instructions above.
No Google or Solana settings are needed. In a terminal with the same admin key:

```bash
curl -sS -H "X-Admin-Key: $BADEM_ADMIN_KEY" -H 'Content-Type: application/json' \
  -d '{"title":"Wooden logo pendant","description":"30 plywood pendants with an engraved logo","location_text":"Belgrade, Serbia","quantity":30}' \
  http://127.0.0.1:8000/api/manufacturing-requests

REQUEST_ID='<id from the create response>'
curl -sS -H "X-Admin-Key: $BADEM_ADMIN_KEY" \
  "http://127.0.0.1:8000/api/manufacturing-requests/$REQUEST_ID"
curl -sS -H "X-Admin-Key: $BADEM_ADMIN_KEY" -H 'Content-Type: application/json' \
  -d '{"process":["laser_engraving"],"materials":["plywood"],"quantity":30,"dimensions_mm":{"width":80,"height":80,"thickness":3},"requirements":["engraved logo"],"location":{"city":"Belgrade","country":"RS"}}' \
  "http://127.0.0.1:8000/api/manufacturing-requests/$REQUEST_ID/specification"

curl -sS -H "X-Admin-Key: $BADEM_ADMIN_KEY" \
  "http://127.0.0.1:8000/api/manufacturing-requests/$REQUEST_ID/specification"

curl -sS -X POST -H "X-Admin-Key: $BADEM_ADMIN_KEY" \
  "http://127.0.0.1:8000/api/manufacturing-requests/$REQUEST_ID/discover"
curl -sS -H "X-Admin-Key: $BADEM_ADMIN_KEY" \
  "http://127.0.0.1:8000/api/manufacturing-requests/$REQUEST_ID/candidates"

CANDIDATE_ID='<candidate_id from discovery>'
curl -sS -H "X-Admin-Key: $BADEM_ADMIN_KEY" \
  "http://127.0.0.1:8000/api/partner-candidates/$CANDIDATE_ID"
```

Discovery tests: `.venv/bin/python -m pytest -q tests/test_discovery*.py tests/test_google_discovery.py`.
The complete `.venv/bin/python -m pytest -q` suite also exercises the unchanged
Proof-of-Production and mocked Solana anchoring flows, without network access.
