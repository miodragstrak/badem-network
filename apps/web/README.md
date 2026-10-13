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

The wizard uses the existing `VITE_BADEM_API_URL` (default `/badem-api`) and
`VITE_BADEM_ADMIN_KEY` / `X-Admin-Key` integration. Vite's development proxy
forwards `/badem-api` to the local API on port 8000. In production configure a
same-origin API proxy or a deployment-specific API base URL with appropriate
cross-origin support. No localhost URL is added to frontend source.
For an isolated development API on a different port, set the server-only
`BADEM_API_PROXY_TARGET` when starting Vite. It is not shipped to the browser
and does not affect the production build or the default port-8000 proxy.

`VITE_*` values are shipped to the browser. The existing admin-key pattern is
for trusted local/demo use only: do not put a production admin secret in a public
bundle. A public deployment needs server-side authentication/proxy handling;
this milestone does not add accounts or change backend authentication. Keep
local environment files untracked and do not share real keys.

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
`?mode=fallback` modes are unchanged. Discovery ignores proof-demo fallback
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
