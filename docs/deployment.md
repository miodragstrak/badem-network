# Deployment Milestone 01

This prepares deployment; it does not deploy. Discovery scoring/provider limits,
device proof verification and Solana behavior are unchanged. The later App UX
Step 2 adds Private Beta identity and quota; see [Private Beta setup](private-beta.md).
No manufacturing-database migration or machine control is introduced.

## Audit and Architecture

Previously, the trusted-demo integration could embed `VITE_BADEM_ADMIN_KEY` in
the browser and send it as `X-Admin-Key`. That credential also authorizes backend
admin operations. The Vite proxy was development-only; production had only SPA
routing. SQLite defaulted to a relative, potentially ephemeral file. Shared
brand imports require access outside each app's Root Directory.

```text
badem.network -> Vercel: apps/landing (static)
app.badem.network -> Vercel: apps/web (static + discovery function)
  browser -> /badem-api/auth/session -> server function -> Supabase Auth
  browser -> /badem-api/api/... -> server function
    -> Supabase Auth + invited email + atomic discovery quota -> api.badem.network
api.badem.network -> persistent external host: services/api
```

Only the function injects `X-Admin-Key` and the freshly verified Auth user's
`X-BADEM-User-Id`. FastAPI validates admin authentication before trusting that
internal identity; discovery requests and derived resources are owner-scoped in
the existing SQLite database. Public builds ignore trusted-local API
URL/key and live proof configuration. Both apps disable automatic `VITE_*`
exposure and explicitly define approved public variables. Even a build with
`--mode development` strips the local key and unknown VITE values.

Public `/` is the app home; `/discovery` now requires invited Private Beta access. `/proof`,
`/proof?mode=debug` and `/proof?mode=fallback` use the existing documented proof
receipt. No live proof, health, jobs, device ingestion or anchor routes are
publicly proxied. Browser admin keys are ignored in all modes. Receipt
values, transaction links and proof protocols are unchanged.

## Vercel Settings

| Setting | Landing | Web |
| --- | --- | --- |
| Domain | `badem.network` | `app.badem.network` |
| Root Directory | `apps/landing` | `apps/web` |
| Framework / Node | Vite / 22.x | Vite / 22.x |
| Install | `npm ci` | `npm ci` |
| Build | `npm run build` | `npm run build` |
| Output | `dist` | `dist` |
| Shared-source access | Enabled | Enabled |
| Fluid compute | Not needed | Enabled; function max duration 120s |

Confirm **Include source files outside of the Root Directory in the Build Step**
is enabled. Keep `apps/shared/brand.css` in the checkout; the function also reuses
the landing public-HTTPS URL validator. No CSS duplication is needed. See the
[Vercel monorepo FAQ](https://vercel.com/docs/monorepos/monorepo-faq).

Committed `vercel.json` files specify build settings. Web rewrites place the access-check route and four
API routes before SPA fallback, keep `/discovery` directly addressable, reject
unknown `/badem-api` routes, and exclude `/api` from SPA fallback. The function's
destination path is strictly allowlisted; it is never an arbitrary URL. UUIDs
are interpolated into path segments under `/api/discovery/`, not query strings.
Explicit `[id]` function files support the Vite app's filesystem routing.

Confirm Fluid compute supports the configured 120s budget; see
[Vercel function limits](https://vercel.com/docs/functions/limitations).
Protect previews and use isolated backend data/mock discovery. The function
also admits the Vercel-provided preview URL as a request origin.

## Environment Ownership

Set secrets in platform environment settings, never Git or `VITE_*`.

| Platform | Variable | Configuration |
| --- | --- | --- |
| Landing Vercel | `VITE_DEMO_URL` | `https://app.badem.network` once available; otherwise unset |
| Web Vercel, server only | `BADEM_API_ORIGIN` | `https://api.badem.network`; public HTTPS origin, no path/query/credentials |
| Web Vercel, server only | `BADEM_SERVER_ADMIN_KEY` | Same private value as backend `BADEM_ADMIN_KEY` |
| Web Vercel, browser-safe build values | `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY` | Canonical Supabase HTTPS project URL and publishable/legacy anon key |
| Web Vercel, server only | `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` | Same Auth project as browser; used for fresh user verification |
| Web Vercel, server only | `SUPABASE_SECRET_KEY` OR `SUPABASE_SERVICE_ROLE_KEY` | One privileged credential for service-only quota RPC; never `VITE_*` |
| Web Vercel, server only | `BADEM_BETA_EMAIL_ALLOWLIST` | Comma-separated invited emails; empty denies all |
| Backend host | `BADEM_ADMIN_KEY` | Generated private admin credential |
| Backend host | `BADEM_DEVICE_ID` | Configured device identity |
| Backend host | `BADEM_DEVICE_SECRET` | Private machine-event HMAC secret |
| Backend host | `BADEM_DB_PATH` | `/var/data/badem.db` on persistent disk |
| Backend host | `BADEM_NODE_ID` | Configured signed-proof node identity |
| Backend host | `BADEM_NODE_PUBLIC_KEY` | Registered 32-byte device public key in hex; set for physical proof ingestion |
| Backend host | `BADEM_DISCOVERY_PROVIDER` | `mock` initially; `google_places` after quota/privacy review |
| Backend host | `GOOGLE_PLACES_API_KEY` | Required only for Google provider; server-only, restricted/budgeted |
| Backend host | `BADEM_DISCOVERY_ENRICH_TOP_N` | Existing bounded 0-5 setting, default 3; unchanged |
| Backend host | `SOLANA_RPC_URL`, `SOLANA_CLUSTER` | Existing optional Devnet configuration, never frontend |
| Backend host | `SOLANA_PAYER_KEYPAIR_PATH` OR `SOLANA_PAYER_PRIVATE_KEY` | Existing optional private payer; never both |

Do not configure `VITE_BADEM_ADMIN_KEY` publicly, even though builds strip it.
Server-only values are read by the function at runtime, not by React. Landing
has no backend secret. Templates contain no actual keys; local env/key/SQLite
files are ignored and excluded from uploads.

If an old public bundle ever contained a real key, rotate it on the API and
function and remove old public deployments. A source fix cannot revoke an
already leaked key. Restrict source/log access; never log environment values,
request auth/bodies or raw upstream errors.

## Gateway Security

Only these backend operations are reachable under same-origin `/badem-api`:

```text
POST /api/manufacturing-requests
POST /api/manufacturing-requests/{UUID}/specification
POST /api/manufacturing-requests/{UUID}/discover
GET  /api/partner-candidates/{UUID}
```

UUID format matches generated backend IDs. Other paths/methods, duplicate/extra
query parameters, traversal and URL overrides fail before upstream I/O. The only
accepted query metadata is Vercel's filesystem `id`, which must agree with the
destination UUID; it cannot choose a different upstream path. Legacy `?path=`
routing is rejected.
Incoming auth/cookies are not forwarded. JSON requests are capped at 64 KiB and
responses at 1 MiB. Redirects are never followed. The only target is the fixed,
server-configured public HTTPS origin. Upstream timeout is 110s, below the 120s
function budget and existing browser timeout. No automatic retries or provider
limit changes are introduced.

Errors are generic JSON, never raw backend/Google/stack bodies. Success preserves
the backend payload, but credential echoes and Google-key-shaped strings fail
closed. Responses use `no-store`; upstream headers and secrets are not emitted.

**Discovery is Private Beta.** Every discovery operation requires fresh Supabase
Auth verification and server-side invited-email access. Only discover dispatches
reserve the persistent, atomic three-per-user/UTC-day quota. Missing configuration
or an unavailable quota service fails closed. See [Private Beta setup](private-beta.md)
for SQL permissions, charged-attempt semantics and identity limitations.
Step 2B rejects foreign and legacy-ownerless discovery resources with 404 before
provider I/O. Browser headers/body/query cannot select an owner. The existing
quota reservation precedes the backend call and is not refunded for these 404s.
Origin/Fetch-Metadata checks still reduce cross-site browser misuse, but callers
can forge/omit those headers. Configure platform/WAF limits, provider spend
alerts and storage/retention controls too. Keep the mock provider until these are
verified. Google attribution/licensing/privacy/retention requirements in the API
documentation still need review before publishing Google-derived profiles.

## CORS and Host Behavior

The browser calls its own app origin and the function calls FastAPI server to
server: no backend CORS is needed and no wildcard is added. Public origins are
`https://app.badem.network` and `https://badem.network`; landing only links to the
app. The function admits these origins but does not return cross-origin CORS
headers or forward browser cookies. Direct browser-to-backend access is not part
of this deployment.

Use the backend host's TLS endpoint/reverse proxy. The startup below does not
trust forwarded headers. If later needed for URL generation/redirects, enable
Uvicorn proxy headers only for known proxy IPs that overwrite client-supplied
forwarded headers, not arbitrary internet callers.

## Persistent FastAPI Host

Recommended current-demo host: one paid Render web service with a disk mounted
at `/var/data`, or one VPS with persistent local storage and HTTPS reverse proxy.
Railway is suitable only with a persistent volume. An ephemeral host loses
SQLite requests, candidates, proofs and anchor records on restart/redeploy.

Render Root Directory: `services/api`. Build:
`python -m pip install -r requirements.txt`. Start:

```bash
python -m uvicorn backend.app:create_app --factory --host 0.0.0.0 --port "${PORT:-8000}" --workers 1 --no-proxy-headers
```

Use a Python runtime compatible with pinned dependencies; local regression
validation uses Python 3.14. Configure required backend variables above and
health path `/health`. Health confirms startup, not disk durability, Google/RPC
availability, finalized anchoring or physical production. Startup creates the
tables. Step 2B also adds the nullable `owner_user_id` column transactionally on
startup if missing; legacy discovery data remains ownerless and inaccessible.
No destructive rebuild or automatic ownership assignment occurs. Take a
consistent persistent-disk backup before upgrading. Discovery config is checked at startup
and Solana config is needed only for existing operator-triggered anchoring.

Only writes under the mounted disk survive. Persistent disks are single-instance
and affect zero-downtime deploys; see [Render disks](https://render.com/docs/disks).
Keep one instance/worker for this demo's SQLite write model, never independent
scaled SQLite files. Use consistent SQLite backup tooling, test restore and
protect the optional payer key separately. Postgres migration is out of scope.

## Local Development and Launch

Keep the backend on `127.0.0.1:8000` and the Vite development proxy. Use
disposable local backend/device keys and `BADEM_DISCOVERY_PROVIDER=mock`, without
production or Google credentials. Set the matching local key in ignored web
`.env.local` as server-only `BADEM_SERVER_ADMIN_KEY`. Configure an isolated
Supabase Auth project, quota SQL and allowlist using [Private Beta setup](private-beta.md).
`BADEM_API_PROXY_TARGET` can select another loopback port. The local middleware
enforces the same Auth/allowlist/quota checks as production. Invalid targets
fail closed; browser admin credentials are not supported.

`vite preview` is static and deliberately has no generic API proxy. Exercise the
function with the offline tests or a local adapter and disposable server-only
values, without deploying. A local adapter must explicitly admit only its own
loopback test origin; do not relax the production origin allowlist. Production
browser requests must not carry `X-Admin-Key`.

Before launch:

- Verify shared-source access, Node version, function budget and protected previews.
- Configure DNS/TLS, platform-only keys, persistent storage and tested backups.
- Configure Auth providers/redirects and invited emails, and apply quota SQL
  before exposing the new web gateway. Test denied access and the fourth-discovery
  limit in a protected preview; follow [Private Beta setup](private-beta.md).
- Verify app -> function -> API wiring and denied job/anchor routes on the host.
- For Step 2B, close beta access, back up SQLite, deploy the ownership-aware
  backend before the matching gateway, then verify two users' cross-user 404s
  and legacy-row denial before reopening. Do not roll back to admin-only
  discovery authorization; see [Private Beta setup](private-beta.md).
- Configure rate/spend/storage controls and Google-data compliance before Google mode.
- Inspect fresh bundles and rotate any previously published credentials.

Validation: both apps' tests/lint/build, full backend pytest and whitespace checks.
Web tests build both apps with synthetic credential canaries and inject all
gateway fetches; no live Google/Solana calls occur. Actual hosting, function
packaging, DNS/TLS and durable storage still require deployment-time verification.
