# BADEM Solana Integration

Milestone 03 uses the existing Solana Memo program on **Devnet**, with no
custom program deployment. `program/` remains a placeholder.

## Proof Flow

ESP32-signed production event -> FastAPI verification -> `PROOF_RECEIVED`
-> admin-triggered Memo transaction -> successful finalization ->
stored transaction signature and `PROOF_ANCHORED`.

Raw machine telemetry, files and the complete signed production record remain
off-chain. The ESP32 signs the event; the backend verifies it. Only the
deterministic final production proof hash is anchored to Solana. Solana is
the immutable verification/provenance layer, not job delivery or machine
control. The Memo commits the verified record; it does not itself verify
the device signature or prove physical manufacturing success. Devnet can
reset and is not a production permanence guarantee.

## Canonical Commitment

Exact UTF-8 anchor bytes, with no trailing newline or NUL:

```text
BADEM_PROOF_ANCHOR_V1|node_id|job_id|event|timestamp|proof_hash|public_key|signature
```

Timestamp is decimal Unix seconds; event is `COMPLETED`. Preserve the signed
node ID, job ID and proof-hash text exactly. Lowercase only public-key and
signature hex. `anchor_hash` is lowercase hex SHA-256 of those bytes.
It includes all seven verified proof fields but excludes database IDs,
receipt time, job metadata, telemetry and transaction/RPC configuration.
The existing device-signing message is not changed.

The transaction contains one instruction for
`MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr`, whose text is:

```text
BADEM:proof:v1:sha256:<anchor_hash>
```

The backend payer signs it and pays only normal network fees. There are no
payments, escrow, automatic airdrops, or inbound jobs.

## Environment and Manual Devnet Test

Use the existing API virtual environment and requirements, which add
`solders==0.29.0` without upgrading existing packages. Set these in the
**running backend's environment**, alongside the existing BADEM settings:

- `SOLANA_RPC_URL`: HTTPS Devnet RPC endpoint.
- `SOLANA_PAYER_KEYPAIR_PATH`: preferred local Solana CLI JSON keypair file
  outside the repository, e.g. `~/.config/solana/badem-devnet-payer.json`.
- `SOLANA_PAYER_PRIVATE_KEY`: alternative disposable Devnet payer, either a
  Base58-encoded 64-byte Solana keypair or JSON array of 64 integer bytes.
- `SOLANA_CLUSTER`: `devnet` only (the default).

Use a separate test wallet, never the device/production wallet. Private keys,
seed phrases and RPC credentials must never be committed or printed. Local
dotenv/keypair files are ignored; the service does not automatically read
dotenv files. The API validates the RPC's Devnet genesis hash before use.
Set exactly one payer source; both together are rejected. Keypair file
contents are read locally, never printed or copied into the repository.
Missing Solana settings do not disable signed-proof ingestion.

Ingest one valid signed proof for an existing job first. Take its `proof_id`
from the HTTP 201 response; the job must be `PROOF_RECEIVED`. Then, from the
monorepo root with `BADEM_ADMIN_KEY` matching the running API:

```bash
services/api/.venv/bin/python solana/scripts/anchor_proof.py "$PROOF_ID"
```

`BADEM_API_URL` optionally changes the script's backend URL (default
`http://127.0.0.1:8000`). The script calls the admin-protected backend anchor
endpoint, rather than bypassing verification or independently spending a
second transaction. It prints the transaction signature and
`https://explorer.solana.com/tx/<signature>?cluster=devnet` only for a valid
finalized Devnet receipt. No configured payer means no real transaction;
mocked test receipts must never be presented as live Devnet results.

## Confirmation and Recovery

The backend persists signed transaction bytes/signature as `PENDING` before
broadcast. Only a history-aware RPC lookup reporting `finalized` and no
execution error permits `ANCHORED`, `anchored_at`, and `PROOF_ANCHORED`.
Send acknowledgments and timeouts are not confirmation. Repeat the same
anchor POST to reconcile or rebroadcast the same signed bytes, never a new
transaction. Successful repeats return the stored receipt without RPC.

`GET /api/proofs/{proof_id}/anchor` reads status without contacting RPC;
both anchor endpoints require `X-Admin-Key`. Failed/expired attempts require
operator review, not replacement transactions. No background reconciliation
or production key rotation/provisioning workflow is implemented.

All automated anchor tests mock RPC, block real transport and generate
ephemeral unfunded keys in memory. No internet or Devnet is required:

```bash
cd services/api
.venv/bin/python -m pytest -q
```

See [the API README](../services/api/README.md) for setup, status codes and
recovery, and [Proof of Production](../docs/proof-of-production.md) for the
complete record/canonical contract.

Protocol references: [Memo program](https://www.solana-program.com/docs/memo),
[sendTransaction](https://solana.com/docs/rpc/http/sendtransaction), and
[getSignatureStatuses](https://solana.com/docs/rpc/http/getsignaturestatuses).

## Milestone 03A Validation

On 2026-10-08, one synthetic production proof from the existing simulator
was anchored to real Devnet and finalized. This validates the backend/chain
flow, not physical ESP32 manufacturing. Firmware was unchanged.

- Job: `04cedb7c-2e0a-4ea7-b81f-75fb211510ee` (`PROOF_ANCHORED`).
- Proof: `bf2702dc-3e36-427a-9869-1271dbb7743c`.
- Anchor hash: `d77ed828f96f1627958232c525876a97f52636d7966a62f36d2238e93fdc7a85`.
- Transaction: `5wrd2ktRb9hGEnt26fkfTZo9pgDhx17LgKRAZfBPz25AGG3kcLw6Xw3rjJniNHnGQpUsmys6Dauyu1KhBaKHMWZJ`.
- [Solana Explorer (Devnet)](https://explorer.solana.com/tx/5wrd2ktRb9hGEnt26fkfTZo9pgDhx17LgKRAZfBPz25AGG3kcLw6Xw3rjJniNHnGQpUsmys6Dauyu1KhBaKHMWZJ?cluster=devnet).

RPC reported `finalized`, no execution error, slot `508908914`, and a
5,000-lamport fee. Fetching the transaction confirmed its Memo was exactly
`BADEM:proof:v1:sha256:<anchor_hash>` and its bytes matched SQLite's persisted
signed transaction. The receipt stores `cluster=devnet` and
`anchored_at=1791484508`. Repeating the existing anchor script returned an
identical receipt; payer signature history and balance were unchanged.

The local validation database is retained at
`services/api/badem-devnet-validation-65d6e88118bc.db` (ignored by Git).
The disposable payer remained outside the repository, was loaded through
`SOLANA_PAYER_KEYPAIR_PATH`, and was never printed or copied. The temporary
validation API was stopped after the checks. Full backend tests: 124 passed,
with one existing Starlette/HTTPX deprecation warning.
