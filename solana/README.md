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
- `SOLANA_PAYER_PRIVATE_KEY`: disposable funded Devnet payer, either a
  Base58-encoded 64-byte Solana keypair or JSON array of 64 integer bytes.
- `SOLANA_CLUSTER`: `devnet` only (the default).

Use a separate test wallet, never the device/production wallet. Private keys,
seed phrases and RPC credentials must never be committed or printed. Local
dotenv/keypair files are ignored; the service does not automatically read
dotenv files. The API validates the RPC's Devnet genesis hash before use.
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
