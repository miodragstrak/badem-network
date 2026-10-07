# BADEM API

FastAPI service for the BADEM manufacturing demo, migrated from
`BADEM-software-milestone-01`. It creates jobs, authenticates machine events,
enforces their lifecycle and sequence, and stores a hash-linked event log in
SQLite. The included simulator sends synthetic events for one laser job.

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

| Endpoint | Purpose | Authentication |
| --- | --- | --- |
| `GET /health` | Service health | None |
| `POST /jobs` | Create a manufacturing job | `X-Admin-Key` |
| `GET /jobs/{job_id}` | Read a job and its event log | `X-Admin-Key` |
| `POST /machine-events` | Submit a signed machine event | `X-Device-Id` and `X-Signature` |

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

## Run Tests

From `services/api`:

```bash
.venv/bin/python -m pytest -q
```

The complete existing suite covers admin/device authentication, ordered
event transitions, sequence validation, duplicate event rejection, and the
explicit buyer/chain limitations. Tests use temporary SQLite databases and
do not require a running API.

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

- Real ESP32 integration is not implemented; simulator events are synthetic
  and do not prove physical machine operation.
- Buyer confirmation and buyer wallet signing are not implemented. A finished
  job remains `AWAITING_BUYER`.
- Solana anchoring and verification are not implemented. The machine proof is
  a local hash-linked event log whose hash has not been anchored onchain.
- One device ID and secret are configured for this prototype. Multi-device
  provisioning and separate secrets per device are not implemented.
- Jobs store a supplied file SHA-256, not the manufacturing file itself.
- Buyer rejection, timeout, and dispute handling are not implemented.
