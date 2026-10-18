# BADEM Manufacturing Network App

React/Vite product entry point for BADEM, preserving Discovery and the
Proof-of-Production demo.

## App Routes

- `/`: focused app home with Discovery and Proof entry cards and the compact
  DISCOVER -> QUALIFY -> PRODUCE -> PROVE product flow. Qualification is not
  implemented by this navigation milestone.
- `/discovery`: Private Beta sign-in, followed by the existing partner wizard
  only after server-validated authentication and invited-email access.
- `/proof`: existing public Proof demo, including `?mode=debug` and
  `?mode=fallback`. Old root demo URLs now display the app home; move demo
  query parameters to `/proof`.

Navigation uses normal same-origin links; all three paths support direct
refresh through the existing Vercel SPA fallback. Unknown app paths show the
home's product links with an unavailable-page heading, not a Proof receipt.
The four-operation discovery allowlist is unchanged. A separate
`GET /badem-api/auth/session` function checks access without touching FastAPI.
The HTML metadata and favicon use BADEM; the favicon is an exact copy of the
existing landing brand mark. Supabase Auth handles identity only; shortlist,
qualification and manufacturing-database migration are not included.

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
   dimensions in mm, requirements and location. Quantity and explicitly
   comma-separated location are copied from the request; no AI or description
   parsing takes place. Laser engraving/plywood are editable initial selections.
3. **Partners:** show nearby public-data matches in a synchronized map/list,
   with simple potential-match labels, straight-line distance when available,
   a short evidence summary, source and the unchanged disclaimer.
   `View partner profile` opens an accessible modal with inferred capabilities,
   public evidence and optional public listing enrichment. Raw scores and fit
   confidence remain in the accessible **Technical fit details** disclosure.

### Nearby UX V1.2B

Both entry steps use a single Location field. Manual text such as `Belgrade,
Serbia` is sent as `location.display_name` alongside the existing city/country
fallback. With Google discovery enabled, the authenticated specification save
resolves it server-side through one Places Text Search request (`pageSize: 1`,
five-second provider timeout, no retries, pagination or details requests).
Successful resolution stores and returns a canonical display name, city, country
and coordinates; the draft then uses these coordinates for geo discovery and
subsequent submissions. Editing Location clears them. Resolution failure keeps
the text fallback and allows discovery to continue, including the existing
no-coordinate map state. There is no autocomplete or browser location-resolution
request; `GOOGLE_PLACES_API_KEY` remains on the backend. Specification saves and
discovery retain their existing quota behavior.

**Use my location** requests browser geolocation only
after a click, with a 10-second timeout; denial, unsupported devices and failures
leave manual entry available. Coordinates are held only in the current draft and
sent in the authenticated specification payload, not URLs, request descriptions,
local storage, analytics, reverse geocoding or a browser Places call. The label is
`Current location`; no city or country is inferred. A coordinate-only request has
no country filter. Editing its Location text clears coordinates to avoid using a
stale device point for a new manual location. Submitting waits for location sharing
to finish or be cancelled by editing.

The backend's ranking is preserved; the browser does not sort by proximity or
invent a distance. Distances below 10 km have one decimal, others are rounded km,
and missing distances are omitted. Partial process signals remain explicitly
unconfirmed; wood-only signals do not become laser engraving claims. Empty results
never substitute unrelated businesses or fixtures. Sparse and unlocated results
remain usable as a list. Numbered markers and cards share a selected state,
including a checkmark/text indicator and keyboard access. On mobile the compact map
precedes the list. The map never receives the customer's device point.

For maps, set these **build-time** variables in the Vercel `apps/web` project:

```text
VITE_GOOGLE_MAPS_BROWSER_KEY=<separate restricted browser key>
VITE_GOOGLE_MAPS_MAP_ID=<JavaScript map ID with Advanced Markers enabled>
```

Enable Maps JavaScript API and configure billing/budgets in the Google Cloud
project. Restrict this separate key to **Maps JavaScript API** and **Websites /
HTTP referrers**, including `https://app.badem.network/*`; approve preview/local
origins separately only when needed. Use an origin-level referrer restriction,
not a path-specific one. This key and map ID are intentionally public, not
credentials for BADEM or server Places. Never copy `GOOGLE_PLACES_API_KEY` into a
`VITE_` variable. If both are accidentally configured with the same value in the
build environment, map configuration is discarded. No automatic VITE exposure is
enabled. See [Google key restrictions](https://developers.google.com/maps/api-security-best-practices)
and [Advanced Markers](https://developers.google.com/maps/documentation/javascript/advanced-markers/overview).

With either variable missing, or an SDK/auth/loading error, the UI shows an honest
map-unavailable state and preserves all list/profile functionality. The SDK loads
only for an authenticated results view with usable workshop coordinates, and only
plots returned public workshop points. No geocoder, Places browser library,
directions service or extra per-candidate profile fetch is used. Existing Google
attribution is left visible. Real map rendering still needs the restricted key,
map ID and production browser validation; unit/smoke tests mock the SDK and make
no paid Google calls.

Candidate list/profile responses expose nullable `latitude`/`longitude`, copied
from already stored public profile data. Legacy profiles return nulls; ownership
checks still apply. Manual resolution supplies an origin to the existing geo
path; scoring, radius expansion, relevance filtering, discovery query limits,
quota and protocol behavior are unchanged.

See [Private Beta setup](../../docs/private-beta.md) before running Discovery.
Google OAuth and existing-user email magic links return to `/discovery`.
The browser sends a Supabase access token only to the same-origin gateway;
every gateway request verifies the current identity with Supabase Auth and
checks the server email allowlist. Only then can the gateway inject the private
backend key and the verified user UUID in the server-only internal identity
header. FastAPI stores request ownership in SQLite and checks it for every
request/specification/discovery/candidate operation; cross-user and archived
ownerless resources return 404. Neither header nor ownership may be chosen by
the browser. The local Vite middleware uses the same protections, not a direct
admin proxy. `BADEM_API_PROXY_TARGET` selects a loopback API (default port 8000);
use disposable backend credentials and an isolated test Supabase project.
Local Vite discovery does not require `BADEM_API_ORIGIN`: its validated
`BADEM_API_PROXY_TARGET` is passed explicitly to the server-side gateway and
revalidated as an HTTP/HTTPS localhost, 127.0.0.1 or ::1 origin, without a path,
credentials, query or fragment. Invalid targets fail closed before Auth/quota or
backend dispatch; the admin key remains required. Vercel ignores this local
environment variable and still requires a public HTTPS `BADEM_API_ORIGIN`.

Only the project URL and publishable/legacy anon key may use `VITE_SUPABASE_*`.
The former `VITE_BADEM_ADMIN_KEY` is ignored even in development. The
path-segment functions under `api/discovery/` inject `X-Admin-Key` from
server-only `BADEM_SERVER_ADMIN_KEY` and target server-only `BADEM_API_ORIGIN`.
Vercel rewrites preserve UUIDs in the destination path, not a `path` query string.
The functions share one strict allowlisted handler; filesystem `id` parameters
must match the path. Vite uses explicit `[id]` routes, not Next.js catch-all files.
Automatic VITE exposure is disabled and all builds strip the local key, including
development-mode builds. No backend authentication behavior is changed.
Keep local environment files untracked and do not share real keys.

Each invited Auth user can dispatch **three discoveries per UTC day**. Only
`POST .../{id}/discover` reserves quota; creation, specification and profiles
do not. A private Supabase table and service-only atomic SQL function persist
the counter across Vercel instances/restarts. Attempts are reserved before
backend dispatch, including mock discoveries, errors and timeouts; there are
no ambiguous-failure refunds or automatic retries. Quota failure blocks dispatch.
Sign-out does not reset usage. The manufacturing SQLite database stays on Render.

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

The existing `/proof` Proof-of-Production demo and its `?mode=debug` and
`?mode=fallback` modes remain available. Public builds use the documented receipt
without live proof requests. Browser admin credentials are no longer supported,
including the legacy local proof-admin configuration. Discovery ignores proof-demo fallback
parameters and always requests the backend. No execution jobs, machine commands,
wallets, Solana operations, outreach or payments are initiated by discovery.

Validation (no external HTTP in the unit tests):

```bash
npm run test
npm run lint
npm run build
```

Tests use Node's built-in runner, with injected fetch responses for API errors,
ordering, empty results, cancellation and validation. Nearby tests also cover
geolocation, manual fallback, evidence/distance labels, SSR sparse/empty views and
a mocked SDK selection/cleanup adapter. Routing tests use the
existing Vercel rewrite compiler. Supabase JS is the only new dependency.
The SQL regression test starts an isolated Unix-socket-only PostgreSQL cluster,
races 24 connections, checks restricted roles and restarts it. Install PostgreSQL
17/18 binaries (or set `BADEM_TEST_POSTGRES_BIN`) and run as a non-root user;
without them this one test is explicitly skipped, not replaced by a JS mock.

## Visual System

The app shares `apps/shared/brand.css` with the landing site: its original
off-white/green palette, DM Sans/Manrope fonts, CTA treatment and three-layer
logo. The token audit and contrast decisions are in `docs/design-system.md`.
The logo in `public/brand/` is an unchanged copy of the landing asset.

Discovery and the profile modal use light surfaces. The proof receipt and active
anchored state retain dark green technical emphasis. The existing wizard's
manufacturing fields and fit results, plus Proof debug/fallback modes and receipt
values, are preserved. Private Beta adds the sign-in surface and account indicator.

Build from the full repository so `apps/shared/` is present. For a Vercel project
rooted at `apps/web`, enable **Include source files outside of the Root Directory
in the Build Step**. No hosting settings are changed here.

## Public Deployment

See `docs/deployment.md` for the audited architecture, exact project/backend
settings, environment ownership and launch checklist. `vercel.json` routes only
the four discovery operations, then SPA paths. Jobs and proof/anchor routes are
not proxied. Use Node 22.x and a 120s function budget with Fluid compute.
`vite preview` is static, without a generic API proxy.

Discovery now requires server-validated, allowlisted Private Beta access and
persistent quota. These are not substitutes for provider billing limits, WAF
controls or privacy/retention review. Per-request ownership is enforced in the
existing backend SQLite database, not Supabase. Configure Supabase
Auth, apply the isolated quota SQL and set runtime secrets before deploying the
web gate; follow the order in [Private Beta setup](../../docs/private-beta.md).
Start with the mock provider and isolated preview data. No deployment is
performed here.
