# BADEM — AI-Based DePIN Manufacturing

BADEM turns existing CNC machines, laser cutters, 3D printers and other manufacturing equipment into verifiable production nodes.

## Hackathon Demo Goal

Job → Machine RUNNING → COMPLETED → BADEM Node signed proof → Solana verification

## Repository Layout

```text
badem-network/
├── apps/
│   ├── web/
│   └── landing/
├── services/
│   └── api/
├── firmware/
│   └── badem-node/
├── solana/
│   ├── program/
│   └── scripts/
├── docs/
└── README.md
```

- `apps/web` - React/Vite web demo placeholder.
- `apps/landing` - Independent public BADEM website for `badem.network`; local development on port 5174.
- `services/api` - FastAPI backend placeholder.
- `firmware/badem-node` - ESP32 BADEM node firmware placeholder.
- `solana/program` - Solana program placeholder.
- `solana/scripts` - Solana integration scripts placeholder.
- `docs` - Architecture and project documentation.
