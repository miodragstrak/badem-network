# BADEM Node Firmware

ESP32 BADEM Node firmware workspace.

Expected board: **ESP32-based BADEM Node**. Machine/controller context:
**MKS DLC32 V2.1**.

Current responsibilities:

- Read machine status.
- Maintain machine/device identity.
- Provide wallet/signing support.
- Produce signed production-completion events.

Hackathon scope: **outbound proof flow only**. Inbound job delivery is not
required yet.

Nenad should work on branch `feature/badem-node-firmware`. Keep firmware
changes under `firmware/badem-node/`. Never commit private keys, seed phrases,
Wi-Fi passwords, or RPC secrets.
