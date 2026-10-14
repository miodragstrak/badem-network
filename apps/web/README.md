# BADEM Web/Demo Application

React/Vite web demo for BADEM, migrated from `cube-depin` with its existing UI and functionality.

Run from `apps/web`:

```bash
npm ci
npm run dev
```

Build the production bundle:

```bash
npm run build
```

## Production Partner Discovery

Open `/discovery` for the buyer-facing, single-route wizard:

1. **Request:** create a manufacturing request with title, description, location
   and quantity. The example values are editable, not a submitted job.
2. **Specification:** manually review process, material, quantity, optional
   dimensions in mm, requirements and city/country. Quantity and explicitly
   comma-separated location are copied from the request; no AI or description
   parsing takes place. Laser engraving/plywood are editable initial selections.
3. **Partners:** display the backend's ranked candidates, scores out of 100,
   fit labels, **Fit confidence**, exact reasoning, source and disclaimer.
   `View partner profile` opens an accessible modal with inferred capabilities,
   public evidence, score breakdown and optional public listing enrichment.

Trusted local development uses `VITE_BADEM_API_URL` (default `/badem-api`) and
`VITE_BADEM_ADMIN_KEY` / `X-Admin-Key`. Vite's development proxy
forwards `/badem-api` to the local API on port 8000. Production uses
the same-origin discovery function described below and ignores direct
API URL overrides and strips the local key. No localhost URL enters a build.
For an isolated development API on a different port, set the server-only
`BADEM_API_PROXY_TARGET` when starting Vite. It is not shipped to the browser
and does not affect the production build or the default port-8000 proxy.

`VITE_*` values must be browser-safe. The admin-key pattern is development-only.
Public discovery uses `api/discovery.js`, which injects `X-Admin-Key` from
server-only `BADEM_SERVER_ADMIN_KEY` and targets server-only `BADEM_API_ORIGIN`.
Automatic VITE exposure is disabled and all builds strip the local key, including
development-mode builds. No accounts or backend-auth changes are introduced.
Keep local environment files untracked and do not share real keys.

Endpoints used:

- `POST /api/manufacturing-requests`
- `POST /api/manufacturing-requests/{id}/specification`
- `POST /api/manufacturing-requests/{id}/discover`
- `GET /api/partner-candidates/{candidate_id}`

Request and discovery errors preserve form entries and provide a retry through
the same submit action. Rediscovery reuses the request ID. Empty results are a
separate state. There is no frontend candidate fallback: if the backend is
configured with its mock provider, the live API results are explicitly marked
as fictional mock data. Google failure is never replaced with mock candidates.

Scores and fit confidence are public-signal heuristics, not probabilities or
verified production capability. All results retain `PUBLIC_DATA_ONLY` and:
"Potential fit based on public data. Production capability has not been verified."
Before public use of Google-derived profiles, review the backend documentation's
Google attribution, retention and privacy limitations; this UI identifies the
source but does not resolve those deployment requirements.

The existing `/` Proof-of-Production demo and its `?mode=debug` and
`?mode=fallback` modes remain available. Public builds use the documented receipt
without live proof requests; trusted local live reads remain available.
Discovery ignores proof-demo fallback
parameters and always requests the backend. No execution jobs, machine commands,
wallets, Solana operations, outreach or payments are initiated by discovery.

Validation (no external HTTP in the unit tests):

```bash
npm run test
npm run lint
npm run build
```

Tests use Node's built-in runner, with injected fetch responses for API errors,
ordering, empty results, cancellation and validation. No new dependencies.

## Visual System

The app shares `apps/shared/brand.css` with the landing site: its original
off-white/green palette, DM Sans/Manrope fonts, CTA treatment and three-layer
logo. The token audit and contrast decisions are in `docs/design-system.md`.
The logo in `public/brand/` is an unchanged copy of the landing asset.

Discovery and the profile modal use light surfaces. The proof receipt and active
anchored state retain dark green technical emphasis. Layouts, wording, API
configuration, fit results, debug/fallback modes and receipt values are unchanged.

Build from the full repository so `apps/shared/` is present. For a Vercel project
rooted at `apps/web`, enable **Include source files outside of the Root Directory
in the Build Step**. No hosting settings are changed here.

## Public Deployment

See `docs/deployment.md` for the audited architecture, exact project/backend
settings, environment ownership and launch checklist. `vercel.json` routes only
the four discovery operations, then SPA paths. Jobs and proof/anchor routes are
not proxied. Use Node 22.x and a 120s function budget with Fluid compute.
`vite preview` is static, without a generic API proxy.

Public discovery is intentionally unauthenticated. Origin checks are not a
global anti-abuse quota: configure WAF/platform rate and storage controls before
any public launch, plus Google spend controls before selecting Google discovery. Start with the existing
mock provider and isolated preview data. No deployment is performed here.
