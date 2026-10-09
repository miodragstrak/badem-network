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
- The interactive walkthrough runs entirely in the browser, without API/RPC calls
  or machine control. Its completion and signature-verification steps are
  illustrative; `/prototype/engraved-mark.png` is physical prototype-test output,
  not evidence tied to a specific proof. The optional Explorer link is the exact
  simulator transaction documented in `solana/README.md`, not a new anchor.
- Hardware detail controls do not advance the walkthrough. Reset and unmount
  cancel the active timer; reduced-motion preferences disable animations.
- Proof copy describes event source and integrity, without claiming physical quality verification.
- Solana references are Devnet demonstrations, not production permanence guarantees.
- No fabricated partner logos, customer numbers, token claims or contact address.
  The only transaction reference is the documented simulator Devnet validation.
- DM Sans / Manrope load from Google Fonts, with local system fallbacks.

Before public launch, review wording against the final demo, verify public URLs,
review the favicon and add a real contact channel. The linked early hardware
video is not presented as the finished demo.
