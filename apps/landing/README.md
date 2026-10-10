# BADEM public website

Independent React/Vite landing application for `badem.network`. The product demo remains in `apps/web`.

## Local development

```bash
cd apps/landing
npm ci
npm run dev
```

Open http://localhost:5174. Validation: `npm run lint` and `npm run build`.

Set `VITE_DEMO_URL=http://localhost:5173` in the ignored `.env.local` to link to
the local demo during development. Never commit this file. URL-policy tests:
`npm test`.

## Demo URL policy

- Development preserves the configured demo URL, including local HTTP URLs.
- Every build, preview, and production-mode run accepts only an absolute HTTPS
  URL with a public host. Localhost names, loopback, private/reserved IP addresses,
  local-only hostnames, malformed URLs and embedded credentials are rejected.
- Validation occurs in the Vite configuration before replacement, so rejected
  demo URLs are not embedded in the production JavaScript.
- An absent or rejected URL keeps the hero CTA linked to `#prototype` and hides
  the "Open production demo" button. Visitors see no configuration messages.
- Host validation does not check DNS, TLS or demo availability; verify those
  separately before enabling a public demo URL.

## Vercel

Create a separate Vercel project from the existing `badem-network` repository:

- Root directory: `apps/landing`
- Framework: Vite
- Build command: `npm run build`
- Output directory: `dist`
- Domain: `badem.network`

In Project Settings -> Environment Variables, configure `VITE_DEMO_URL`:

| Environment | Value |
| --- | --- |
| Production | Leave unset/empty until the public demo is available; then use `https://demo.badem.network`. |
| Preview | Leave unset/empty, or use the same publicly available HTTPS demo. Never use localhost. |
| Development | `http://localhost:5173` |

Environment changes require a fresh build/deployment. Do not upload an old local
`dist`. Confirm the production artifact contains no `http://localhost:5173` and
test both CTA states before publishing. Domain purchase, DNS changes and
deployment are not performed by this change.

## Content and assets

- English copy for hackathon judges, potential partners and developers.
- Implemented components, simulator validation and the network roadmap are
  labeled separately. The workflow describes the architecture, not a validated
  physical end-to-end run.
- The current reference integration is MKS DLC32 V2.1 / ESP32; additional CNC
  and 3D printer integrations are roadmap work.
- The proof pipeline was validated with a simulator-generated record anchored
  to real Solana Devnet. Physical ESP32 end-to-end validation is the next milestone.
- The existing wooden-tag asset is presented as a manufacturing visualization, not evidence of a specific run.
- Header and footer use the original `/brand/badem-three-layer-lockup.png`,
  preserving all three symbols, labels, aiBADEM, colors, background and proportions.
  The favicon remains provisional.
- The hardware gallery uses `/prototype/machine.jpeg`, `/prototype/controller.jpeg`
  and `/prototype/enclosure.jpeg`, without cropping. These photographs document
  hardware development, not completed-job evidence or a Solana transaction.
- The six-step interactive walkthrough illustrates READY -> RUNNING -> COMPLETED
  -> RECORD SIGNED -> SIGNATURE VERIFIED -> ANCHOR EXPLAINED. One stable-size
  visual container holds the AI machine media for the first three steps and
  the React/CSS BADEM Production Console for the digital steps. No separate
  proof-flow diagram remains beneath the media. All images/video are uncropped;
  a minimum container height keeps console text readable on narrower screens.
- AI assets live in `public/walkthrough/`: `machine-ready.jpg`,
  `machine-production.mp4` and `machine-completed.jpg`. They are illustrative,
  not evidence of a physical run. The console retains a small, uncropped
  completed-scene thumbnail, not the real prototype-output photo. The scene's
  generic controller enclosure is not identified as actual BADEM Node hardware.
- Production video plays once, muted and inline, without looping. Only its
  `ended` event or explicit skip advances to completion, never a fixed timer.
  Pause/resume and playback-error fallback are provided. Reduced-motion mode
  uses static proof transitions and requires explicit play or skip for video.
  A missing still image falls back to the ready scene with an explicit caveat;
  reset retries the images. The right-hand step explanation sits directly above
  the primary action; the visual and controls stack on mobile.
- A persistent badge identifies the simulation and absence of live transactions.
  The console illustrates a completion record with job, example
  node identity, event and signature placeholder, then sequential checks for
  registered device identity, job association and device signature. Signing
  and checks are explicitly simulated, not physical output/quality validation.
- The final step illustrates canonicalization, SHA-256 hashing, sending only
  `anchor_hash` to a Solana Memo, and a descriptive illustrative receipt. No
  cryptographic operations are performed and no realistic hash, signature,
  timestamp, transaction ID or new Explorer URL is generated. No API/RPC calls,
  wallet interactions, actual transactions, machine commands or job delivery.
- `proof_hash` is the device-supplied evidence field; it is not `anchor_hash`.
  Per `docs/proof-of-production.md` and `solana/README.md`, the real backend's
  anchor canonical order is `BADEM_PROOF_ANCHOR_V1|node_id|job_id|event|timestamp|proof_hash|public_key|signature`.
  SHA-256 commits to all seven verified fields, including the public key and
  device signature. Only key/signature hex is lowercased; signed identifiers
  and `proof_hash` text retain their original spelling. These are UTF-8 bytes
  with no trailing newline. The console displays field names/placeholders only.
  The full record stays off-chain; its hash is a reference for checking changes,
  not an independent proof that physical production or buyer acceptance occurred.
- Reset stops and rewinds the video, invalidates stale playback callbacks and
  cancels active animations/action timers. Rapid and repeated-key actions are
  guarded. Current-step progress, polite status announcements, keyboard controls
  and visible focus states remain available throughout.
- Real-photo controls are outside the AI scene and do not advance it.
  `/prototype/engraved-mark.png` remains physical prototype-test output, with
  its caveat: "This photograph is not linked to a specific proof record."
- The final Explorer link, "View documented simulator transaction", is the exact
  simulator Devnet transaction documented in `solana/README.md`. It is separate
  from the AI scene; the walkthrough never submits a transaction. Physical ESP32
  end-to-end validation is still pending, and Devnet can reset.
- Proof copy describes event source and integrity, without claiming physical quality verification.
- Solana references are Devnet demonstrations, not production permanence guarantees.
- No fabricated partner logos, customer numbers, token claims or contact address.
  The only transaction reference is the documented simulator Devnet validation.
- DM Sans / Manrope load from Google Fonts, with local system fallbacks.

Before public launch, review wording against the final demo, verify public URLs,
review the favicon and add a real contact channel. The linked early hardware
video is not presented as the finished demo.
