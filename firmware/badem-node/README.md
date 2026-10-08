# BADEM Node Firmware

ESP32 BADEM Node firmware workspace.

Milestone 02B adds signed completion proofs compatible with the FastAPI
`POST /api/proofs` endpoint. Firmware changes remain outbound-only; no Solana
transaction submission or inbound job delivery is implemented.

Expected board: **ESP32-based BADEM Node**. Machine/controller context:
**MKS DLC32 V2.1**.

Current responsibilities:

- Read machine status.
- Maintain machine/device identity.
- Provide wallet/signing support.
- Produce signed production-completion events.

Hackathon scope: **outbound proof flow only**. Inbound job delivery is not
required yet.

## Proof Generation

The existing controller behavior is preserved: connect to MKS DLC32 over
TCP/Telnet port 23, query `?` every 500 ms, treat `Run` or `Hold` as running,
and detect completion when a subsequent response contains `Idle`. Reconnect
attempts remain three seconds apart. This is the existing demo heuristic,
not independent confirmation of successful physical work.

At completion the node captures Unix UTC seconds from its NTP-synchronized
clock and queues the timestamp. A separate FreeRTOS worker constructs, signs,
and POSTs the proof, so HTTP requests do not block controller polling.
The deterministic demo evidence digest is lowercase hex SHA-256 of exactly:

```text
node_id|job_id|COMPLETED|timestamp
```

Those metadata bytes are UTF-8 with no newline. The digest identifies this
completion assertion; it is not a hash of a manufacturing file or sensor log.
The canonical bytes signed with standard Ed25519 are exactly:

```text
node_id|job_id|COMPLETED|timestamp|proof_hash
```

There is no trailing newline, terminating NUL, JSON serialization, extra
digest, transaction wrapper, or hidden field in the signed message.
The same `Keypair` loaded from the existing machine wallet signs arbitrary
bytes through `Keypair::sign(const uint8_t*, size_t, uint8_t*)`. Its raw 32-byte
public key and raw 64-byte signature are encoded consistently as lowercase
hex. The firmware verifies its own signature before POSTing.

The JSON body contains exactly `node_id`, `job_id`, `event: COMPLETED`, integer
`timestamp`, `proof_hash`, `public_key` (64 hex characters), and `signature`
(128 hex characters). Delivery is to `BADEM_API_URL` plus `/api/proofs`.
HTTP 201 with `PROOF_RECEIVED`, `signature_verified: true`, and matching job
and node IDs is logged as success. HTTP 409 is reported as duplicate/conflict,
not assumed successful. Other rejections and transport errors are failures.
Only public identity, canonical data, status, and delivery results are logged;
private keys and Wi-Fi credentials are never printed.

## Local Configuration

Create local, ignored `secrets.h` from `secrets.example.h` and configure:

| Setting | Meaning |
| --- | --- |
| `WIFI_SSID`, `WIFI_PASSWORD` | Local Wi-Fi credentials |
| `MKS_DLC32_IP` | Actual controller IP; Telnet remains port 23 |
| `MACHINE_PRIVATE_KEY_B58` | Local test wallet's Base58 32-byte seed or 64-byte seed/public-key pair |
| `NODE_ID` | Registered node identity, default `BADEM-001` |
| `JOB_ID` | Existing backend job ID; default `JOB-0042` is a placeholder |
| `BADEM_API_URL` | API base URL reachable from the ESP32, such as `http://192.168.1.100:8000` |
| `NTP_SERVER` | Reachable NTP server, default `pool.ntp.org` |
| `BADEM_API_CA_CERT` | Trusted root CA PEM for HTTPS; empty for the local HTTP demo |

The checked-in example contains placeholders, including an empty private
key. Without `secrets.h`, it can compile but cannot run the hardware demo.
HTTPS requires a configured trusted CA; certificate verification is never
disabled. Plain HTTP is intended for the controlled local-network demo.

The backend must have an existing eligible job with the actual machine ID.
Its normal `POST /jobs` returns a UUID, so replace the default `JOB-0042` with
that value before flashing. Configure backend `BADEM_NODE_ID` to match the
firmware and `BADEM_NODE_PUBLIC_KEY` to the public-key hex printed at startup.
The job's `machine_id` must match backend `BADEM_DEVICE_ID`. The node does not
need the backend admin key or HMAC secret. Make FastAPI reachable on the LAN,
for example with `--host 0.0.0.0`, and use the host's LAN address, not the
ESP32's `127.0.0.1`. Provisioning/job association is manual for this demo.

## Build and Compatibility Checks

`platformio.ini` provides a generic ESP32 Dev Module (`esp32dev`) build using
Espressif32 6.12.0 / Arduino ESP32 2.0.17, ArduinoJson 6.21.5, and Solduino
2.0.0 pinned to upstream commit `ad0d621f954a1a4eb1870cd62e8f9c839953280c`.
The Arduino ESP32 SDK supplies libsodium. Confirm the actual BADEM Node board,
flash configuration, and upload port with Nenad before flashing; the MKS
DLC32 is the separately contacted controller.

From this folder, with PlatformIO installed:

```bash
pio run -e esp32dev
pio run -e esp32dev -t upload
pio device monitor -b 115200
```

No real credentials are required for compilation. For the actual upload,
configure `secrets.h` first. Use a local development environment for PlatformIO;
the backend requirements are not modified.

The upstream Solduino `Keypair::sign` implementation delegates to libsodium
`crypto_sign_ed25519_detached`, which signs arbitrary bytes without a Solana
transaction prefix. `getPublicKey` returns the required raw key bytes. This
implementation is technically compatible with the backend's standard Ed25519
verifier. Nenad's locally installed library/fork must expose the same API and
real implementation; do not substitute transaction signing or dummy signatures.

After building, a Linux host check uses the actual shared proof builder,
Solduino keypair/crypto sources, and host libsodium. Only Arduino platform
types/logging are shimmed; signing is not mocked. It requires `g++`, the host
libsodium runtime, and the existing backend virtual environment. From the
repository root:

```bash
services/api/.venv/bin/python firmware/badem-node/tests/verify_proof_compatibility.py
```

Set `PLATFORMIO_CORE_DIR` or pass `--platformio-core-dir <path>` if your
PlatformIO packages are stored elsewhere. The check generates an ephemeral
test seed in memory, compares canonical bytes, SHA-256, JSON, and signatures
against Python, checks Base58 imports of both 32-byte seeds and 64-byte
keypairs (including leading-zero seeds), then submits the generated payload
to FastAPI's test client.
It checks acceptance, duplicate rejection, and signature tampering. No test
seed is printed or written. This does not replace an on-board network test.

## Demo Assumptions and Limitations

- `Run`/`Hold` followed by `Idle` is preserved as the completion heuristic;
  actual job identity, success, and physical production still need validation.
- A fixed manually configured job is used. Each subsequent completion for the
  same node/job/event will be rejected as a duplicate; update the job ID for
  another demo run. There is no inbound job delivery.
- NTP must synchronize before completion. If UTC is unavailable, the event is
  logged and not queued; `millis()` is never substituted for a Unix timestamp.
- The pending queue holds four timestamps in RAM. Queue overflow, reboot,
  network failure, or a failed POST can lose a proof. There is no persistent
  outbox or automatic retry yet; a lost successful response cannot be assumed
  accepted merely from a later 409.
- Physical ESP32/MKS DLC32 testing is still required: confirm the actual board,
  controller signal, Wi-Fi and NTP connectivity, local wallet, registered
  public key, eligible backend job, reachable API, and HTTPS CA when applicable.
- Proof acceptance means verified device signature and `PROOF_RECEIVED` only.
  Buyer confirmation and Solana anchoring are not implemented.

## Contributing

Nenad should work on branch `feature/badem-node-firmware`. Keep firmware
changes under `firmware/badem-node/`. Never commit private keys, seed phrases,
Wi-Fi passwords, or RPC secrets.
