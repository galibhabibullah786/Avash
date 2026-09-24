# Secrets & Environment Matrix

**Read when:** adding, renaming, rotating, or obtaining any environment variable or credential.

**Decides:** What each variable is, where it may appear, and how to obtain and rotate it.

Full environment variable inventory (`docs/PROJECT_PLAN.md` §7.1), with
exposure classification, consumers, how to set each in each environment,
and rotation procedure.

## The `VITE_PUBLIC_` prefix rule

Any environment variable **without** a `VITE_PUBLIC_` prefix must never be
imported into `apps/web` source. This is enforced by two independent
mechanisms — a deliberate double lock, not a single point of failure:

1. **ESLint boundary rule** (`packages/config/eslint-config`) — a
   `no-restricted-syntax` rule fails the build if any `import.meta.env` /
   `process.env` access appears anywhere under `apps/web/src` where the key
   does not start with `VITE_PUBLIC_`.
2. **Vite's default env-inlining behavior** — Vite itself refuses to
   inline non-`VITE_`-prefixed vars into the client bundle by default,
   independent of whether the ESLint rule catches the source-level
   reference.

A CI step additionally scans the **built** `apps/web/dist` output
for any accidentally-leaked secret value or non-public env key as a third,
defense-in-depth check against the compiled artifact rather than only
source code.

## Environment matrix

**Why four secrets now list `.env` as well as `apps/api/.dev.vars`.**
`wrangler dev` reads `.dev.vars`; the `api` **container** cannot —
`.dockerignore` keeps `**/.dev.vars` out of every build context, and
Compose interpolates only the repo-root `.env`. So `compose.yaml` forwards
`SUPABASE_JWT_SECRET`, both `UPSTASH_*`, and `TURNSTILE_SECRET_KEY` into
the container from `.env`, and they have to exist in both files.

They were previously absent from `.env.example` entirely, so
`pnpm docker:apps` passed empty strings: every symptom check and every
breeding-site report 429'd (the rate limiter fails closed on unreachable
Redis) and every report additionally 403'd (Turnstile siteverify rejects
an empty secret). Both surfaced in the browser as a generic error, which
is correct behaviour (R10) and made the cause invisible. `apps/api/server/node-server.ts`
now refuses to start without them rather than warning.

| Variable | Exposure | Consumers | Local file |
|---|---|---|---|
| `SUPABASE_URL` | server-only | `apps/api`, GH Actions job scripts, `ml/serving/predict.py` — same value as `VITE_PUBLIC_SUPABASE_URL`, read under this name server-side | `.env` |
| `SUPABASE_SERVICE_ROLE_KEY` | server-only | `apps/api`, GH Actions job scripts, **and now `apps/notify`** (ADR-016 — talks to Supabase directly per ADR-007, never through `apps/api`) — a third home for this key; see the note below the table | `apps/api/.dev.vars`, `.env` |
| `SUPABASE_JWT_SECRET` | server-only | `apps/api` (local JWT verification, ADR-009) | `apps/api/.dev.vars`, `.env` |
| `VITE_PUBLIC_SUPABASE_URL` | client (`apps/web`) | citizen reads, Realtime subscriptions — real gate is RLS, not secrecy | `apps/web/.env` |
| `VITE_PUBLIC_SUPABASE_ANON_KEY` | client (`apps/web`) | citizen reads, Realtime subscriptions — real gate is RLS, not secrecy | `apps/web/.env` |
| `VITE_PUBLIC_API_BASE_URL` | client (`apps/web`) | base URL of the `apps/api` Worker, used by `apps/web/src/lib/apiClient.ts` | `apps/web/.env` |
| `GEMINI_API_KEY` | server-only | `apps/api` routes, `scripts/jobs/news-scan.ts` | `apps/api/.dev.vars`, `.env` |
| `OPENWEATHERMAP_API_KEY` | server-only | `scripts/jobs/weather-ingest.ts` | `.env` |
| `UPSTASH_REDIS_REST_URL` | server-only | `apps/api` rate limiter + Gemini quota guard | `apps/api/.dev.vars`, `.env` |
| `UPSTASH_REDIS_REST_TOKEN` | server-only | `apps/api` rate limiter + Gemini quota guard | `apps/api/.dev.vars`, `.env` |
| `TURNSTILE_SECRET_KEY` | server-only | `apps/api` (server-side verification call) | `apps/api/.dev.vars`, `.env` |
| `CLOUDINARY_CLOUD_NAME` | server-only | `apps/api` (`POST /api/uploads/signature`, ADR-015) — `apps/web` learns this value from the signature response, never from a `VITE_PUBLIC_*` var (R2) | `apps/api/.dev.vars`, `.env` |
| `CLOUDINARY_API_KEY` | server-only | `apps/api` (`POST /api/uploads/signature`, ADR-015) | `apps/api/.dev.vars`, `.env` |
| `CLOUDINARY_API_SECRET` | server-only | `apps/api` (`POST /api/uploads/signature`) — the value `signUpload()` hashes into the signature; never logged, never returned in any response | `apps/api/.dev.vars`, `.env` |
| `VITE_PUBLIC_TURNSTILE_SITE_KEY` | client | widget render only | `apps/web/.env` |
| `VITE_PUBLIC_VAPID_PUBLIC_KEY` | client (`apps/web`) | Push subscription registration | `apps/web/.env` |
| `VAPID_PUBLIC_KEY` | server-only | `ml/serving/predict.py` **and** `apps/notify` (ADR-016) — Web Push signing needs both halves of the keypair; same value as `VITE_PUBLIC_VAPID_PUBLIC_KEY` | `.env` |
| `VAPID_PRIVATE_KEY` | server-only | `ml/serving/predict.py` **and** `apps/notify` (ADR-016) — sends push notifications, never in any deployed app reachable by a browser | `.env` |
| `INNGEST_EVENT_KEY` | server-only | `apps/notify` — authenticates event sends to Inngest (the announcement-published trigger and the sweep both send through this) | none yet (§ below) |
| `INNGEST_SIGNING_KEY` | server-only | `apps/notify` — verifies that an inbound Inngest function invocation actually came from Inngest, not a forged request | none yet (§ below) |
| `ANNOUNCEMENT_WEBHOOK_SECRET` | server-only | `apps/notify`'s Supabase Database Webhook receiver — the shared-secret header compared in constant time; the webhook body itself is untrusted (critique §11, `temp/live-announcement-push.md`) | none yet (§ below) |
| `VERCEL_TOKEN` | CI/deploy-only, a real secret | `.github/workflows/deploy-notify.yml` — authenticates `vercel pull` / `vercel build` / `vercel deploy` | GitHub Actions secret only |
| `VERCEL_ORG_ID` | CI/deploy-only | `.github/workflows/deploy-notify.yml` — identifies the Vercel org/team `apps/notify` deploys under | GitHub Actions secret only |
| `VERCEL_PROJECT_ID` | CI/deploy-only | `.github/workflows/deploy-notify.yml` — identifies the Vercel project `apps/notify` deploys to | GitHub Actions secret only |
| `DATABASE_URL_LOCAL` | local-only | migration/seed tooling pointed at the `compose.yaml` `db` container (ADR-011) — a disposable localhost database, never a deployed one | `.env` |
| `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` / `POSTGRES_PORT` | local-only | optional overrides for the `db` container's defaults (`postgres` / `postgres` / `avash` / `54322`), read by Compose | `.env` |
| `DATABASE_URL_HOSTED` | server-only, a real secret | `scripts/seed-db.ts` when passed `--hosted` (§ 9a) — full superuser access to a real Supabase project's Postgres | `.env` |

A client-consumed value must carry the `VITE_PUBLIC_` prefix **in its own
name** — both locks above key off the identifier, not off intent, so a
browser-bound value under a bare name is simply unreadable. That is why
the VAPID public key is listed twice, under two names for two consumers,
rather than once under a bare name (`docs/PROJECT_PLAN.md` §7.1 corollary).

**`SUPABASE_SERVICE_ROLE_KEY` now has a third home.** Before ADR-016 it
lived in exactly two places: GitHub Actions secrets (job scripts) and
Cloudflare Worker secrets (`apps/api`). `apps/notify` adds a third —
Vercel's environment variable store — because it talks to Supabase
directly with the service-role key rather than through `apps/api`
(ADR-007's rule: jobs/services talk to Supabase directly, never proxy
through the request-serving Worker). This key bypasses Row Level
Security entirely in all three places; the rotation procedure below now
has a third target to update in step 2, and `apps/notify` must never be
the app that logs it, echoes it in an error response, or leaks it into a
webhook reply.

**The `local-only` class** is narrower than `server-only`: these values
address the disposable PostGIS container defined in `compose.yaml`
(ADR-011), which is bound to `127.0.0.1`, holds nothing but seed data, and
has no deployed counterpart. They have working defaults, are not rotated,
and are never set as a GitHub Actions or Cloudflare secret — if a
`local-only` variable ever appears in a deployment environment, something
is pointed at the wrong database. They are still repo-root `.env` values
and still never reach `apps/web`.

## Obtaining each secret — step by step

Every credential below is free-tier-obtainable and takes under five
minutes per provider. Do these in order — later steps assume earlier ones
are done — then jump to § Local development files to load them.

**Before you start:** create a dedicated, disposable Supabase project and
Cloudflare account (or a scoped sub-account) for local development rather
than reusing a production one. Every credential here should be one you
can revoke without affecting anything else.

### 1. Supabase — `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_JWT_SECRET`, `VITE_PUBLIC_SUPABASE_URL`, `VITE_PUBLIC_SUPABASE_ANON_KEY`

1. Create a project at [supabase.com](https://supabase.com) (free tier is
   sufficient for development).
2. In the project dashboard: **Settings → API**.
3. Copy **Project URL** → this is both `SUPABASE_URL` and
   `VITE_PUBLIC_SUPABASE_URL` (same value, two names for two consumers —
   see the note below the environment matrix).
4. Under **Project API keys** (Legacy anon, service_role API keys), copy:
   - **`anon` `public`** → `VITE_PUBLIC_SUPABASE_ANON_KEY`. Safe to expose
     in the client bundle by design; Row Level Security is the real gate
     (§4.1), not secrecy of this key.
   - **`service_role`** → `SUPABASE_SERVICE_ROLE_KEY`. **This key bypasses
     Row Level Security entirely.** Never expose it to `apps/web`, never
     log it, never paste it anywhere outside `apps/api/.dev.vars` and
     GitHub Actions secrets.
5. Still on **Settings → API**, scroll to **JWT Settings** and copy the
   **JWT Secret** (Legacy JWT Secret) → `SUPABASE_JWT_SECRET`. `apps/api` uses this to verify
   Supabase-issued JWTs locally without a network round-trip (ADR-009).

### 2. Google Gemini — `GEMINI_API_KEY`

1. Go to [Google AI Studio](https://aistudio.google.com/app/apikey) and
   sign in with a Google account.
2. **Get API key → Create API key**, choosing (or creating) a Google Cloud
   project to attach it to.
3. Copy the generated key → `GEMINI_API_KEY`.
4. In the [Google Cloud Console](https://console.cloud.google.com/apis/credentials),
   open the key and, under **API restrictions**, scope it to the
   Generative Language API only — an unrestricted key is a wider blast
   radius than this project needs.
5. The free tier's request quota is the enforcement point behind
   `GEMINI_DAILY_QUOTA_GUARD` (`docs/constants-registry.md`) — set a
   budget alert in the Cloud Console if you want a second warning before
   the quota circuit-breaker in `docs/security/rate-limiting.md` engages.

### 3. OpenWeatherMap — `OPENWEATHERMAP_API_KEY`

1. Sign up at [openweathermap.org/api](https://openweathermap.org/api).
2. **API keys** tab on your account page → copy the **Default** key, or
   generate a new one scoped to this project.
3. Copy it → `OPENWEATHERMAP_API_KEY`.
4. **New keys take up to a couple of hours to activate.** A `401` from
   `scripts/jobs/weather-ingest.ts` immediately after signup is expected
   propagation delay, not a misconfiguration — retry later before
   debugging further.

### 4. Upstash Redis — `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`

1. Create a database at [console.upstash.com](https://console.upstash.com)
   (Regional, not Global — this project needs neither multi-region
   replication nor its added latency for rate-limit counters).
2. Open the database → **REST API** section.
3. Copy **UPSTASH_REDIS_REST_URL** and **UPSTASH_REDIS_REST_TOKEN**
   directly — Upstash names them identically to what this project expects.
4. These back every sliding-window guard in
   `docs/security/rate-limiting.md` (`BREEDING_REPORT_RATE_LIMIT`,
   `SYMPTOM_CHECK_RATE_LIMIT`, `BLOOD_UPDATE_RATE_LIMIT`) — without them
   set, `apps/api`'s rate limiter has nothing to count against.

### 5. Cloudflare Turnstile — `TURNSTILE_SECRET_KEY`, `VITE_PUBLIC_TURNSTILE_SITE_KEY`

1. In the [Cloudflare dashboard](https://dash.cloudflare.com), open
   **Turnstile** (no domain/zone required to use it standalone).
2. **Add site** — enter a display name and `localhost` as the domain for
   local development (add the real production domain as a second
   allowed domain once one exists; Turnstile widgets support multiple
   domains per site).
3. Copy the **Site Key** → `VITE_PUBLIC_TURNSTILE_SITE_KEY` (safe to
   expose — it only renders the challenge widget).
4. Copy the **Secret Key** → `TURNSTILE_SECRET_KEY` (server-only —
   `apps/api` uses it to verify the token the widget produces; §7.2,
   ADR-005).

### 5a. Cloudinary — `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`

1. Create a free account at [cloudinary.com](https://cloudinary.com) (the
   free tier's storage/bandwidth is sufficient for development).
2. On the **Dashboard** landing page, copy the three values shown under
   **Product Environment Credentials**:
   - **Cloud name** → `CLOUDINARY_CLOUD_NAME`. Not secret on its own —
     it's part of every upload/delivery URL — but kept server-only here
     because `apps/web` learns it from the `POST /api/uploads/signature`
     response, never from a `VITE_PUBLIC_*` variable (decision G,
     ADR-015; R2).
   - **API Key** → `CLOUDINARY_API_KEY`.
   - **API Secret** → `CLOUDINARY_API_SECRET`. **This is what
     `apps/api/src/lib/cloudinarySignature.ts` hashes into every signed
     upload.** Never log it, never return it in any response, never
     paste it anywhere outside `apps/api/.dev.vars` and GitHub Actions
     secrets.
3. These back every call to `POST /api/uploads/signature`
   (`docs/features/platform-primitives.md`) — without them set, that
   route cannot mint a valid signature and every upload attempt fails
   closed (a Cloudinary-rejected upload, not a leaked or malformed one;
   ADR-015).

### 6. Map tiles — no credential required

**There is nothing to obtain for this section.** The risk map renders
with Leaflet over OpenStreetMap's standard raster tiles, which need no
account, no API key, and no token (ADR-013). The three values the tile
layer needs — `MAP_TILE_URL_TEMPLATE`, `MAP_TILE_ATTRIBUTION`,
`MAP_TILE_MAX_ZOOM` — are §14 registry constants read from
`apps/web/src/features/map/tileLayer.ts`, not environment variables:
they are identical in every environment and secret in none.

This section is kept rather than deleted because its absence is the
point. A reader following this file top-to-bottom should not go looking
for the map credential that §7.1 used to list; earlier revisions carried
`VITE_PUBLIC_MAPBOX_TOKEN` here, and ADR-013 removed it along with the
Mapbox dependency itself.

Two consequences worth knowing before you build the map slice:

- **CSP.** The tile host is allow-listed under **`img-src`**, not
  `connect-src` — Leaflet's raster `TileLayer` fetches tiles as `<img>`
  elements. The entry lands in `apps/web/public/_headers` and
  `apps/web/docker/security-headers.conf.template` with the risk-map
  slice, not before (§7.4).
- **Usage policy, not a credential, is the constraint.** OSM's tile
  servers are a donated community resource with a published
  [usage policy](https://operations.osmfoundation.org/policies/tiles/).
  Respect the `CacheFirst` service-worker policy for tiles (§8), never
  bulk-download or pre-scrape, and keep attribution visible. Sustained
  real-world traffic is the trigger to move to a keyed or self-hosted
  provider — a one-constant change plus a CSP edit, per ADR-013.

Nothing about the credential-free basemap limits what the map can show.
Region polygons, risk shading, hospital markers, and breeding-report
pins are drawn from `apps/api`'s own GeoJSON as Leaflet layers **on top
of** the tiles — that data path is authenticated and rate-limited like
any other API read, and is entirely independent of the tile provider.

### 7. Web Push VAPID keypair — `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VITE_PUBLIC_VAPID_PUBLIC_KEY`

No external account needed — this is a keypair you generate yourself, once, locally:

```bash
npx web-push generate-vapid-keys
```

This prints a **Public Key** and a **Private Key**:

- Public key → both `VAPID_PUBLIC_KEY` (root `.env`, read by
  `ml/serving/predict.py`) **and** `VITE_PUBLIC_VAPID_PUBLIC_KEY`
  (`apps/web/.env`, read by the browser to register a subscription) — the
  same value under two names, the same pattern as the Supabase URL above.
- Private key → `VAPID_PRIVATE_KEY` (root `.env` only). **Never** give
  this a `VITE_PUBLIC_` name or place it in `apps/web/.env` — it signs
  push payloads server-side and must never reach a browser.

Generate this once per environment (local, preview, production) and treat
each as a distinct keypair — do not reuse a local development keypair in
production.

### 8. `VITE_PUBLIC_API_BASE_URL` — not a third-party credential

This is the URL of your own running `apps/api`, not something to obtain
from a provider:

- Local development: `http://localhost:8787` (the `wrangler dev` default;
  already the value in `apps/web/.env.example`).
- Preview/production: the deployed Worker's origin, set as a Cloudflare
  Pages build environment variable (§ How to set each secret per
  environment below) — not something you edit in a committed file.

### 9. Local-only Postgres variables — no provider, defaults are usually fine

`DATABASE_URL_LOCAL`, `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`,
and `POSTGRES_PORT` address the disposable container in `compose.yaml`
(`docs/docker.md`). Leave them blank unless you need to override a
default — `pnpm docker:db` works with all five unset.

### 9a. `DATABASE_URL_HOSTED` — hosted database, manual ops only

A real Postgres connection string for a real Supabase project — full
superuser access, not RLS-gated. Obtain it from the Supabase Dashboard for
the specific project (preview or production have separate projects and
separate passwords, per the environment table in `docs/manual-deploy.md`):
**Project → Project Settings → Database → Connection string** (use the
pooler/session-mode URI).

Deliberately a separate variable from `DATABASE_URL_LOCAL`, not a
fallback for it — a value left sitting in `.env` must never be able to
silently redirect a plain `pnpm db:seed` at a real database. It is only
read by `scripts/seed-db.ts` when explicitly passed `--hosted`:

```bash
pnpm db:seed -- --hosted
```

Migrations against a hosted project go through `supabase db push`
instead (`packages/db/scripts/push-hosted.mjs`, `docs/manual-deploy.md` §
Service 3), which authenticates via the linked `supabase` CLI session and
never reads this variable.

Leave blank day-to-day. Fill it in only for the duration of a manual
hosted operation, then blank it again — treat it exactly like any other
credential you would not want sitting in a plaintext file longer than
necessary. It is exempt from the "local-only, not a secret" treatment
`DATABASE_URL_LOCAL` gets: `scripts/scan-client-env.mjs` (R2 gate) lists
it as server-only alongside `SUPABASE_SERVICE_ROLE_KEY`.

### Fastest path to a running local stack

If you only want `pnpm dev` up and the frontend/backend talking to each
other, sections 1 and 8 are the minimum — every other credential gates a
specific feature (symptom checker → Gemini, weather dashboard →
OpenWeatherMap, rate limiting → Upstash, breeding reports → Turnstile,
push alerts → VAPID) and can be added when you actually build or test
that feature, not before. The risk map is the one feature that gates on
nothing — it needs no credential at all (§ 6 above).

## Local development files

Each runtime context loads its own gitignored file. Every one has a
committed `*.example` template that serves as the tracked inventory of
required keys — the templates are the only copies in version control, and
they never contain a real value.

| Context | Real file (gitignored) | Tracked template | Loaded by |
|---|---|---|---|
| `apps/web` browser bundle | `apps/web/.env` | `apps/web/.env.example` | Vite at build time — `VITE_PUBLIC_` keys only |
| `apps/api` Worker | `apps/api/.dev.vars` | `apps/api/.dev.vars.example` | `wrangler dev`, injected as the typed `Bindings` in `apps/api/src/types.ts` |
| Job scripts + `ml/` | `.env` (repo root) | `.env.example` | `scripts/jobs/*` and `ml/serving/*` when run locally; Docker Compose also reads it for `compose.yaml` interpolation |

Set up a fresh clone with:

```bash
cp .env.example .env
cp apps/api/.dev.vars.example apps/api/.dev.vars
cp apps/web/.env.example apps/web/.env
```

`.gitignore` ignores `.env`, `.env.*`, `.dev.vars`, and `.dev.vars.*`
while re-including the `*.example` templates via negation. Following the
setup instructions therefore cannot result in a committed credential.
Verify at any time with:

```bash
git check-ignore -v .env apps/api/.dev.vars apps/web/.env
```

These files are **local development only**. No deployed environment reads
them — production and preview use the mechanisms in the next section.

## How to set each secret per environment

| Environment | Mechanism |
|---|---|
| `apps/api` (Cloudflare Workers), local dev | `apps/api/.dev.vars` (gitignored; copy from `.dev.vars.example`) |
| `apps/api` (Cloudflare Workers), production/preview | `wrangler secret put <NAME> --env production` / `--env preview` (never committed to `wrangler.toml`) |
| `apps/web` (Cloudflare Pages), local dev | `apps/web/.env` (gitignored; copy from `.env.example`) — `VITE_PUBLIC_*` only |
| `apps/web` (Cloudflare Pages), production/preview | `VITE_PUBLIC_*` vars only, set as Cloudflare Pages build environment variables (public by design — they end up in the client bundle regardless) |
| Job scripts + `ml/`, local dev | root `.env` (gitignored; copy from `.env.example`) |
| GitHub Actions (job scripts, CI, deploy workflows) | **GitHub Actions secrets**, referenced as `${{ secrets.NAME }}`, injected as ephemeral env vars into the runner. Repository scope today; migrating to **environment** scope (`preview` / `production`), each holding its own separately-issued credential — step-by-step procedure in `docs/security/github-environments.md` |

`wrangler.toml`'s `[vars]` block lists every required secret name as a
**commented inventory only** — real values are never committed to the
repository under any circumstance (R2).

## Rotation procedure

1. Generate the new credential at the source (Supabase project settings,
   Gemini/Google Cloud console, OpenWeatherMap dashboard, Upstash console,
   Cloudflare Turnstile dashboard, Cloudinary dashboard, or a freshly
   generated VAPID keypair).
2. Update the secret in every environment that consumes it, in this order,
   to avoid a window where the old credential is already revoked but the
   new one isn't live yet:
   a. GitHub Actions secret (repository scope; once the environment split
      lands, `preview` first and `production` only after preview is
      verified healthy — `docs/security/github-environments.md` § Rotation).
   b. `wrangler secret put` for each Cloudflare Workers environment
      (`preview`, `production`).
   c. Vercel project environment variables (`preview`, `production`), for
      `apps/notify` — required for `SUPABASE_SERVICE_ROLE_KEY`,
      `VAPID_PRIVATE_KEY`/`VAPID_PUBLIC_KEY`, `INNGEST_EVENT_KEY`,
      `INNGEST_SIGNING_KEY`, and `ANNOUNCEMENT_WEBHOOK_SECRET`.
   d. Cloudflare Pages build environment variable, for any `VITE_PUBLIC_*`
      value that changed (requires a new deploy to take effect, since it's
      baked into the static bundle at build time).
3. Trigger a redeploy of `apps/api` (and `apps/web`, if a public var
   changed, and `apps/notify`, if a Vercel-held value changed) so the new
   value is actually in use, not just stored.
4. Revoke/delete the old credential at the source **after** confirming the
   new one is live (health check, or a manual smoke test of the affected
   route).
5. Record the rotation date and reason in the incident/change log used by
   the team (not committed to this repository).

Any credential suspected of being compromised skips the "confirm new one
is live first" ordering — revoke immediately, accept a short window of
degraded service, then follow steps 1–3 to restore it.
