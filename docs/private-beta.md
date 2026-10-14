# Discovery Private Beta

App UX Step 2 uses Supabase **Auth only for identity/session**, plus one isolated
usage-counter table. FastAPI, discovery requests/profiles and SQLite remain on
the existing backend. Proof of Production and Solana are unchanged.
Step 2B adds per-user manufacturing-request ownership in that existing SQLite
database; no manufacturing-domain ownership data is copied into Supabase.

## Access Flow

`/` and `/proof` remain public and do not instantiate the Auth client. `/discovery`
shows the BADEM Private Beta screen until its access check succeeds. Google OAuth
uses PKCE and returns to the same origin's `/discovery`. Email magic links use
`shouldCreateUser: false`: an administrator must first create/invite that Auth
user. There is no signup or invitation-management UI. The SDK persists/refreshes
the identity session locally; browser storage is never authoritative for access
or quota. Sign out clears the local session and unmounts the wizard.

The browser sends only `Authorization: Bearer <access token>` to the same-origin
gateway. `GET /badem-api/auth/session` verifies access without calling FastAPI or
reserving quota. Every one of the four allowlisted discovery operations then:

1. Checks the existing route/method, origin and body constraints.
2. Rejects malformed/expired tokens and wrong issuer/audience/role.
3. Calls the configured Supabase Auth `/auth/v1/user` endpoint to verify the token
   and obtain the current confirmed, non-anonymous, non-banned user. Parsing JWT
   claims is **not** signature verification. A client-side `getSession()` is not
   trusted by the gateway. See [Supabase getUser](https://supabase.com/docs/reference/javascript/auth-getuser).
4. Matches the verified email against `BADEM_BETA_EMAIL_ALLOWLIST` (trimmed,
   case-insensitive exact entries; no wildcard/plus/dot rewriting). Empty denies
   everyone. Client metadata/email/user ID cannot grant access.
5. For `POST .../{UUID}/discover` only, reserves persistent quota.
6. Injects the server-only backend `X-Admin-Key` and `X-BADEM-User-Id` from the
   freshly verified Auth user UUID, never from browser headers, query or body.
   The browser token/cookie is never forwarded to FastAPI.

Auth failure is 401; uninvited identity is 403 with the invited-beta message;
quota exhaustion is 429 with the exact user-facing daily-limit message. The
machine-readable `X-BADEM-Error` distinguishes this limit from a provider 429.
Missing/invalid Auth or quota configuration and service errors fail closed.
An allowlist removal is enforced on the next request; there is no authorization
cache. Provider token revocation/sign-out may still leave an issued access JWT
valid until its expiry; remove the email from the allowlist for immediate beta
access withdrawal. Google may create an Auth identity for a non-beta user, but
that identity cannot enter Discovery or call its gateway.

The same four FastAPI paths remain allowlisted, with real UUID path segments.
The access-check route is separate, not an additional backend-proxy capability.
SPA refresh, bounds, no-store headers, origin checks, redirects blocked,
timeouts and credential-echo protection remain in place. No direct Render,
Google Places, Supabase database or RPC requests are made by the browser.

## Manufacturing Ownership (Step 2B)

Every discovery route in FastAPI requires valid existing admin authentication
**before** trusting exactly one internal `X-BADEM-User-Id` UUID. Missing, malformed
or duplicate identity headers return 401. There is no admin-only discovery bypass.
The UUID is normalized and stored as `manufacturing_requests.owner_user_id`
when creating a request; create payloads must not contain this field. Ownership
cannot be transferred by a specification payload, query or browser header.
The gateway rejects top-level `owner_user_id` payloads and constructs both
internal headers afresh, ignoring any caller-supplied copies. Its strict four
backend endpoints are unchanged; internal headers do not enter browser code.

Get request, save/get specification, discover and get candidates all require
the request's stored owner to equal the trusted user. Candidate profile queries
join the parent request and apply the same owner constraint. Cross-user and
ownerless objects return the **same 404 as nonexistent objects**. Ownership is
checked before any provider I/O and rechecked inside the result-write transaction.
There is no new endpoint for listing everyone's records or claiming old data.

On API startup, the existing SQLite transaction helper checks
`PRAGMA table_info(manufacturing_requests)` and, only if missing, runs:

```sql
ALTER TABLE manufacturing_requests ADD COLUMN owner_user_id TEXT;
```

New databases include the same nullable column in their create schema. Existing
rows remain `NULL` and **inaccessible to all beta users**, including candidate
and specification reads. No first-access assignment, default shared owner,
destructive table rebuild, data deletion or automatic backfill is performed.
The change is transactional, additive and safe to repeat on restart. Legacy
data stays archived in the existing database; any future assignment must be a
separate audited operator procedure based on proven ownership, not a public API.
Requests are bound to the stable Auth UUID, not email. Deleting/recreating an Auth
user does not transfer its old SQLite requests to the new identity.

The Proof/job/event/anchor tables and their authentication are unaffected; the
public `/proof` receipt stays public. Only discovery uses the internal user header.
No new environment variables or Supabase tables/migrations are needed for 2B.
Use a consistent SQLite backup of the persistent Render disk before rollout.
Do not roll back the ownership checks to an admin-only discovery build: that
would reopen access to the preserved records.

Quota remains **three discover dispatch attempts/user/UTC day**. The existing
reservation still precedes the backend call, so even a backend 404 (foreign,
ownerless or missing request) consumes an attempt; it never triggers Google
discovery. The quota RPC, table, credentials and zero-cost operations are unchanged.

## Persistent Quota

Apply `apps/web/supabase/private-beta.sql` as the database owner in the dedicated
Supabase project. It creates `badem_beta_private.discovery_usage`, keyed by Auth
user UUID and **UTC calendar day**, with a count restricted to 1-3. No request,
specification, candidate or proof data is stored there.

`public.consume_badem_discovery(UUID)` atomically inserts or increments the
user/day row with `ON CONFLICT ... WHERE discoveries < 3`. Row locking prevents
parallel Vercel instances from admitting more than three attempts. It returns
true for a reserved attempt and false at the cap. The gateway calls it using
only the freshly verified user ID; clients cannot choose quota identity/day/count.
Counters survive sign-out, redeployment and server restarts. A new UTC day has
a new row. A new request UUID does not reset the user quota.

The private table enables RLS and grants no browser-role access. The RPC has an
empty `search_path` and is executable only by `service_role`, not `PUBLIC`, `anon`
or `authenticated`. See [Supabase function security](https://supabase.com/docs/guides/database/functions).
For modern secret keys the server sends `apikey` only; for the legacy service-role
JWT it sends `apikey` plus its JWT Authorization. Do not configure both keys.
See [Supabase API keys](https://supabase.com/docs/guides/getting-started/api-keys).

**Charged operation:** every authenticated, allowlisted discover dispatch attempt,
including the mock provider. Creation, specification saves, profile reads and
access checks cost zero quota. Reservation precedes backend/provider work;
failures, cancellation and timeouts are not refunded because an ambiguous
upstream result may already have incurred cost. There are no automatic retries.
This is a conservative operation cap, not a Google billing meter. Do not retry
the quota RPC on ambiguous network errors. The cap is fixed at three; no provider
limits/scoring settings are changed.

Counters are small but accumulate per active day; define backup/retention policy
operationally. Auth-user deletion cascades its counters. Deleting/recreating a
user is an administrative action and can reset identity-based usage.

## Environment and Auth Setup

Use ignored `apps/web/.env.local` locally and Vercel's environment settings for
hosting. `.env.example` documents names, not credentials. Configure:

| Side | Variables | Purpose |
| --- | --- | --- |
| Browser-safe build | `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY` | Canonical project HTTPS origin and publishable key; legacy anon JWT also accepted |
| Server runtime | `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` | Same canonical project and public key for verified Auth user retrieval |
| Server runtime | `SUPABASE_SECRET_KEY` OR `SUPABASE_SERVICE_ROLE_KEY` | One privileged credential for quota RPC |
| Server runtime | `BADEM_BETA_EMAIL_ALLOWLIST` | Comma-separated invited, verified emails |
| Server runtime | `BADEM_API_ORIGIN`, `BADEM_SERVER_ADMIN_KEY` | Existing HTTPS backend origin and private backend admin key |
| Local server only | `BADEM_API_PROXY_TARGET` | Loopback HTTP/HTTPS backend origin, default `http://127.0.0.1:8000` |

Use the canonical `https://<project-ref>.supabase.co` URL, not a custom Auth
domain: the gateway pins the JWT issuer to `${SUPABASE_URL}/auth/v1`.
Browser/server project settings must agree. Only the public URL and
publishable/anon key are explicitly exposed to Vite. An opaque secret or legacy
service-role JWT accidentally configured as the public key is rejected/stripped.
No privileged credential may use `VITE_*`. The old `VITE_BADEM_ADMIN_KEY` is ignored
even locally; no private key is sent by the proof or Discovery browser client.

The pinned Supabase JS SDK contains a test-only localhost Auth default. A scoped
Vite AST transform replaces just that unused default with the configured Auth
origin (or a non-networking `.invalid` origin). Actual client creation requires
valid configuration. It fails the build if the pinned SDK constant changes,
requiring review; token handling and protocol are not modified.

In Supabase Auth configure Google with its client ID/secret **in Supabase only**.
Use the project's `/auth/v1/callback` as the Google OAuth authorized redirect URI.
See [Google provider setup](https://supabase.com/docs/guides/auth/social-login/auth-google).
Configure working SMTP/email delivery and existing invited users for magic links;
use the standard confirmation-link template and test it in the initiating browser
(PKCE). This is not an unrestricted email-signup path.

Set Site URL to `https://app.badem.network`. Add these exact allowed Auth redirects:

- Production: `https://app.badem.network/discovery`.
- Local: `http://localhost:5173/discovery` and, when used, `http://127.0.0.1:5173/discovery`.
- Preview: each trusted `https://<deployment>.vercel.app/discovery`; prefer explicit
  URLs rather than broad wildcards. Use a separate preview/test Auth project and
  backend, with its own allowlist, quota SQL and credentials. Keep previews protected.

The app derives the return URL from its current origin. See [Auth redirect URLs](https://supabase.com/docs/guides/auth/redirect-urls).
Set all required browser and server values for the appropriate **Production** or
**Preview** Vercel environment; changes to browser configuration need a rebuild.
The gateway permits the exact Vercel-provided deployment origin without widening
its backend routes. Google/SMTP credentials stay in Supabase; Places keys stay
in FastAPI. The landing project needs no Auth variables and remains unchanged.

For local development, start FastAPI on loopback with disposable keys and mock
discovery. Set matching server-only web credentials, use the isolated Auth
project and run `npm run dev` in `apps/web`. The Vite middleware uses the same
Auth/allowlist/quota checks and forwards only allowlisted paths to loopback.
It never silently forwards an invalid local target to the production backend.
`vite preview` is static: it cannot validate real sessions or proxy requests.

## Validation and Rollout

Run `npm test`, `npm run lint`, `npm run build` in `apps/web`, and
`git diff --check`. Tests inject Auth/provider responses; no live external HTTP.
The PostgreSQL test starts a temporary Unix-socket-only cluster, races 24 real
connections (exactly three permitted), checks roles/UTC/user isolation and
restarts it to verify persistence. Install non-root PostgreSQL 17/18 binaries or
set `BADEM_TEST_POSTGRES_BIN`; otherwise that test explicitly reports a skip.
CI/release validation should provide binaries and require no skips.
Canary builds test valid and accidentally privileged public configuration,
unknown VITE values, server secrets and absence of localhost URLs in artifacts.
Run the full backend `.venv/bin/python -m pytest -q` from `services/api` too.
Ownership tests cover two users, all reads/writes, no provider calls on denied
requests, forged/missing/duplicate identity, restart, in-flight reauthorization
and additive legacy migration. Existing Proof/Solana tests remain unchanged.

Recommended deployment order (operator actions, not performed by this change):

1. Create/configure the isolated Supabase project, Google provider, email delivery
   and exact redirect URLs; create invited email users as needed.
2. Apply quota SQL and verify browser roles cannot call it/read counters.
3. Set preview build/runtime variables and the explicit invited-email allowlist;
   point to isolated FastAPI mock-provider data with the matching private key.
4. Deploy a protected preview. Verify genuine Google/email round trips, fresh
   session checks, denied/uninvited access, three discoveries/fourth 429,
   profile reads, refresh, sign-out and public home/proof on desktop/mobile.
5. For the 2B upgrade, temporarily close beta access, take a consistent SQLite
   backup and deploy the ownership-aware backend first. Startup applies the
   additive migration; older gateways without the user header fail closed. Deploy
   the matching gateway next, test two real users (including cross-user 404s and
   legacy-row denial), then restore the reviewed beta allowlist. Configure
   production Auth/quota settings before reopening. Verify hosted routing,
   no-store and denied access; keep Google billing/spend controls enabled.

## Remaining Boundaries

Step 2B isolates discovery data by owner even when another UUID is known. The
server admin credential remains a privileged trust boundary: its holder can
assert a user identity, so keep it isolated and rotate any previously exposed
key. This does not add shared/team access, transfer/claiming, deletion or account
lifecycle management. There is no general request rate/WAF limit, per-user
storage limit, billing/shortlist/qualification UI or manufacturing database move
to Supabase. Provider attribution, privacy and retention
requirements still apply. Auth/provider outages deny access rather than bypass
protection. Genuine Supabase/Google/SMTP and hosted Vercel/Render validation
require configured services and are deployment-time checks.
