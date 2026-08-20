# Constants Registry

Single source of truth for every static threshold used anywhere in this
codebase, mirroring `docs/PROJECT_PLAN.md` §14 exactly. **If you hardcode
a number anywhere else, it must appear here first** — add the row (and the
corresponding §14 row) in the same PR that introduces the value.

`Status` starts `documented` for every row. A row flips to `implemented`
only once the constant is actually wired into the code location listed.

| Constant | Value | Defined in | Purpose | Status |
|---|---|---|---|---|
| `DENGUE_FAVORABLE_TEMP_MEAN_C` | 27 | `ml/training/config.py`, `packages/types/ml.ts` | breeding-favorability feature flag | documented |
| `DENGUE_FAVORABLE_TEMP_MIN_C` | 22 | `ml/training/config.py`, `packages/types/ml.ts` | breeding-favorability feature flag | documented |
| `DENGUE_FAVORABLE_HUMIDITY_PCT` | 80 | `ml/training/config.py`, `packages/types/ml.ts` | breeding-favorability feature flag | documented |
| `PREDICTION_HORIZONS_WEEKS` | [2, 4] | `ml/training/config.py` | forecast horizons | documented |
| `SURGE_TARGET_THRESHOLD` | +30% WoW case growth | `ml/training/config.py` | classification label definition | documented |
| `RISK_LEVEL_BANDS` | low < .25, moderate < .50, high < .75, severe ≥ .75 | `packages/types/ml.ts`, SQL generated column | UI color coding, alerts | implemented |
| `MIN_RECALL_TARGET` / `MIN_PRECISION_TARGET` | 0.85 / 0.60 | `ml/evaluation/backtest.py` | model promotion gate | documented |
| `ONNX_MODEL_SIZE_BUDGET` | < 2 MB | `ml/training/export_onnx.py` | PWA offline cache feasibility | documented |
| `MODEL_RETRAIN_CADENCE` | monthly, manual promotion | `docs/ml/model-card.md` | drift mitigation | documented |
| `BATCH_PREDICT_CADENCE` | every 24h | `.github/workflows/cron-batch-predict.yml` | freshness of `risk_predictions` | documented |
| `WEATHER_INGEST_CADENCE` | every 3h | `.github/workflows/cron-weather-ingest.yml` | freshness of weather features | implemented |
| `RISK_MAP_CACHE_TTL_S` | s-maxage=300, swr=600 | `apps/api/src/routes/risk-map.ts` | edge cache behavior | implemented |
| `MV_REFRESH_INTERVAL` | triggered post-batch-predict | `ml/serving/predict.py`, `scripts/refresh-materialized-views.ts` | map read freshness | implemented |
| `BREEDING_REPORT_RATE_LIMIT` | 5/min, 20/day per IP | `packages/security` | abuse prevention | implemented |
| `SYMPTOM_CHECK_RATE_LIMIT` | 10/min, 50/day per IP | `packages/security` | Gemini cost control | implemented |
| `BLOOD_UPDATE_RATE_LIMIT` | 10/min per verified user | `packages/security` | write abuse prevention | implemented |
| `GEMINI_DAILY_QUOTA_GUARD` | 1500 req/day (global) | `packages/security/quotaGuard.ts` | free-tier cost circuit breaker | implemented |
| `ALERT_PROXIMITY_RADIUS_DEFAULT_M` | 2000 (bounds: 100–20,000) | `packages/geo`, `alert_subscriptions` check constraint | `ST_DWithin` default/ceiling | implemented |
| `DB_STATEMENT_TIMEOUT_S` | 5 | Supabase API role config | prevents runaway spatial queries | implemented |
| `FRONTEND_BUNDLE_BUDGET_KB` | < 180 KB gzip (shell) | `apps/web/vite.config.ts` bundle analyzer CI check | performance | implemented |
| `MAP_TILE_URL_TEMPLATE` | `https://tile.openstreetmap.org/{z}/{x}/{y}.png` | `apps/web/src/features/map/tileLayer.ts` | basemap tile source; the one value to change when swapping tile providers (ADR-013) | implemented |
| `MAP_TILE_ATTRIBUTION` | `© OpenStreetMap contributors` | `apps/web/src/features/map/tileLayer.ts` | attribution control — required by the OSM tile usage policy, not optional styling | implemented |
| `MAP_TILE_MAX_ZOOM` | 19 | `apps/web/src/features/map/tileLayer.ts` | highest zoom the OSM standard style serves; requesting past it returns blank tiles | implemented |
| `CORS_ALLOWED_ORIGINS` | production Pages domain + PR preview pattern | `apps/api/wrangler.toml` (`CORS_ALLOWED_ORIGINS`, `CORS_PREVIEW_ORIGIN_SUFFIX` vars), read in `apps/api/src/config/cors.ts` | cross-origin write protection | implemented |
| `API_CLIENT_TIMEOUT_MS` | 8000 | `apps/web/src/lib/apiClient.ts` | aborts a hung `apps/api` request instead of leaving a query pending indefinitely | implemented |
| `POSTGIS_LOCAL_IMAGE` | `postgis/postgis:15-3.4` | `compose.yaml`, CI `services:` container | local + CI database parity with Supabase's Postgres 15 / PostGIS 3 (ADR-011) | implemented (`compose.yaml`, `ci.yml`'s `postgis-service` job) |
| `ML_PYTHON_IMAGE` | `python:3.11-slim-bookworm` | `docker/ml.Dockerfile`, cron workflow `python-version` | reproducible ML runtime — identical dependency tree locally and on schedule | implemented (`ml.Dockerfile`, `cron-batch-predict.yml`) |
| `POSTGRES_LOCAL_PORT` | 54322 (host) → 5432 (container) | `compose.yaml` | avoids collision with a host-installed Postgres; matches the Supabase CLI convention | implemented |
| `WEB_IMAGE_BASE` | `nginxinc/nginx-unprivileged:1.27.2-alpine` | `apps/web/Dockerfile` | runtime base for the web image — non-root, listens on 8080 (ADR-012) | implemented |
| `API_IMAGE_BASE` | `node:20.17.0-alpine3.20` | `apps/api/Dockerfile` (both stages) | build + runtime base for the API image | implemented |
| `APP_CONTAINER_PORTS` | web 8080, api 8787, notify 8788 (in-container) | `apps/web/docker/default.conf.template`, `apps/api/server/node-server.ts`, `apps/notify/server/node-server.ts`, `compose.yaml` | fixed in-container ports; host ports overridable via `WEB_PORT`/`API_PORT`/`NOTIFY_PORT` | implemented |
| `CONTAINER_REGISTRY` | `ghcr.io/<owner>/avash-web`, `ghcr.io/<owner>/avash-api` | `.github/workflows/build-images.yml` | published image names; `sha-<short>` tags, plus `latest` on `main` | implemented |
| `WEATHER_CACHE_TTL_S` | `s-maxage=900, swr=1800` | `apps/api/src/routes/weather.ts` | edge cache for weather reads; 15 min against a 3 h ingest cadence never serves a value the source could have refreshed | implemented |
| `WEATHER_HISTORY_WINDOW_DAYS` | 14 | `apps/api/src/routes/weather.ts` | dashboard history window; matches the 14-day rolling features in §5.1 so the chart shows what the model will consume | implemented |
| `WEATHER_INGEST_REQUEST_SPACING_MS` | 1100 | `scripts/jobs/weather-ingest.ts` | paces OpenWeatherMap calls under the free tier's 60/min ceiling | implemented |
| `WEATHER_INGEST_MAX_RETRIES` | 3 | `scripts/jobs/weather-ingest.ts` | per-region retry budget on 429/5xx before that region is skipped | implemented |
| `BBOX_MAX_SPAN_DEG` | 10 | `packages/geo/bbox.ts` | rejects an absurd viewport before it becomes a full-table scan | implemented |
| `MAP_GEOMETRY_SIMPLIFY_TOLERANCE_DEG` | 0.001 | `packages/db/supabase/migrations/20260215000009_api_read_views.sql` | polygon simplification in the map read view; ~100 m at this latitude, invisible at the zoom levels the map serves | implemented |
| `RISK_MAP_DEFAULT_HORIZON_WEEKS` | 2 | `packages/types/ml.ts` | horizon the map opens on when `?horizon=` is absent | implemented |
| `STUB_MODEL_VERSION` | `stub-0.0.0` | `packages/types/ml.ts` | sentinel marking seeded placeholder predictions; the real pipeline writes a semver and this value disappears | implemented |
| `MAP_DEFAULT_CENTER` | `[23.78, 90.40]` | `apps/web/src/features/map/tileLayer.ts` | initial map center (Dhaka) | implemented |
| `MAP_DEFAULT_ZOOM` | 7 | `apps/web/src/features/map/tileLayer.ts` | initial zoom — all seeded regions visible in one view | implemented |
| `APP_ROLE_CLAIM_PATH` | `app_metadata.role` | migration `20260815000012_app_role_and_resource_reads.sql`, `packages/security/roles.ts` | where a custom role lives in a Supabase JWT — server-controlled, unlike `user_metadata` | implemented |
| `JWT_CLOCK_TOLERANCE_S` | 60 | `apps/api/src/lib/jwtVerify.ts` | leeway for clock skew between Supabase's issuer and the Worker | implemented |
| `GEMINI_MODEL_ID` | `gemini-3.1-flash-lite` | `apps/api/src/lib/geminiClient.ts` | the one value to change when swapping Gemini models | implemented |
| `GEMINI_REQUEST_TIMEOUT_MS` | 5000 | `apps/api/src/lib/geminiClient.ts` | bounds a hung Gemini call inside the Worker's request budget | implemented |
| `SYMPTOM_TEXT_MAX_CHARS` | 500 | `packages/types/api.ts` | §5.4 input length cap, prompt-injection surface reduction | implemented |
| `REPORT_DESCRIPTION_MAX_CHARS` | 1000 | `packages/types/api.ts` | §5.4 input length cap | implemented |
| `SPAM_LIKELIHOOD_REJECT_THRESHOLD` | 0.7 | `apps/api/src/routes/reports.ts` | §5.4 — above this a report is flagged, not published | implemented |
| `REPORT_VERIFY_RATE_LIMIT` | 20/min per user | `packages/security/rateLimit.ts` | §6's moderator-verify row, previously absent from §7.3/§14 | implemented |
| `BLOOD_UNITS_MAX` | 500 | `packages/types/api.ts` | §7.2's "wildly implausible values (99999 units)" ceiling | implemented |
| `RESOURCE_SEARCH_RADIUS_DEFAULT_M` | 5000 (bounds 500–50,000) | `packages/types/api.ts`, `blood_within_radius()` | default/ceiling for the `ST_DWithin` blood search | implemented |
| `HOSPITAL_RESULT_LIMIT` | 200 | `apps/api/src/routes/resources.ts` | caps a bbox or radius result set before it becomes a payload problem | implemented |
| `RESOURCES_CACHE_TTL_S` | `s-maxage=60, swr=120` | `apps/api/src/routes/resources.ts` | short edge cache for the initial paint; live updates arrive via Realtime (ADR-010), so a long TTL would fight the ticker | implemented |
| `AppRole` | `citizen \| hospital_staff \| moderator \| admin` | `packages/types/api.ts`, mirrored by `role_assignments`' check constraint | the four roles every layer recognizes; was `moderator \| admin` before the RBAC slice | implemented |
| `DEFAULT_APP_ROLE` | `citizen` | `packages/types/api.ts`, `public.app_role()` | what a **verified** token with no role claim resolves to; anonymous stays `null`, deliberately | implemented |
| `ROLE_CAPABILITIES` | see `docs/features/rbac.md` § grant table | `packages/security/roles.ts`, mirrored by `public.has_capability()` in migration `20260816000013` | the single authorization grant table — not a rank, since moderator and hospital_staff are disjoint | implemented |
| `ROLE_ASSIGNMENT_RATE_LIMIT` | 10/min per user | `packages/security/rateLimit.ts` | role admin is a rare deliberate action; a burst is a mistake or a compromised admin session | implemented |
| `ADMIN_USER_PAGE_SIZE` | 50 | `apps/api/src/routes/admin-users.ts` | default page size for the admin user list | implemented |
| `SUPABASE_LOCAL_API_PORT` | 54321 (db 54329, studio 54323, inbucket 54324) | `packages/db/supabase/config.toml` | the containerized local Supabase stack (ADR-014); deliberately clear of the ADR-011 `db` container on 54322 so both can run | implemented |
| `AUDIT_DETAIL_MAX_KEYS` | 12 | `packages/types/audit.ts` | caps the audit `detail` map — a flat, key-capped scalar map makes it awkward to dump a whole request body into an append-only, admin-readable table | implemented |
| `LIST_PAGE_SIZE_DEFAULT` | 25 | `packages/types/pagination.ts` | page size when `?pageSize=` is absent | implemented |
| `LIST_PAGE_SIZE_MAX` | 100 | `packages/types/pagination.ts` | ceiling on any client-requested page size | implemented |
| `LIST_SEARCH_MAX_CHARS` | 120 | `packages/types/pagination.ts` | bounds the `?q=` filter term | implemented |
| `UPLOAD_MAX_BYTES` | 5242880 (5 MiB) | `packages/types/uploads.ts` | client-side pre-check + signed constraint | implemented |
| `UPLOAD_SIGNATURE_RATE_LIMIT` | 10/min per user | `packages/security/rateLimit.ts` | bounds signature minting per account | implemented |
| `UPLOAD_SIGNATURE_TTL_S` | 600 | `apps/api/src/lib/cloudinarySignature.ts` | how long a returned signature stays valid | documented — not yet read from this location; `signUpload()` has no expiry check today, only the `timestamp` param Cloudinary itself validates |
| `ANNOUNCEMENT_TITLE_MAX_CHARS` | 120 | `packages/types/alerts.ts` | §13.7 announcement title cap | implemented |
| `ANNOUNCEMENT_BODY_MAX_CHARS` | 1000 | `packages/types/alerts.ts` | §13.7 announcement body cap | implemented |
| `ANNOUNCEMENT_RADIUS_DEFAULT_M` | 5000 (bounds 500–50,000) | `packages/types/alerts.ts`, `announcements` check constraint | default/ceiling for announcement targeting radius | implemented |
| `ANNOUNCEMENT_MAX_ACTIVE_PER_AUTHOR` | 20 | `apps/api/src/routes/announcements.ts` | caps how many live announcements one author can hold at once | implemented |
| `ANNOUNCEMENT_PUSH_LEASE_SECONDS` | 300 | `packages/types/alerts.ts` | how long one delivery claim is held before the sweep may reclaim it | documented |
| `ANNOUNCEMENT_PUSH_SWEEP_CADENCE` | every 5 min | `apps/notify` Inngest cron | safety-net scan for undelivered announcements | documented |
| `ANNOUNCEMENT_PUSH_CONCURRENCY` | 10 | `packages/push` | simultaneous in-flight sends per delivery run | documented |
| `ANNOUNCEMENT_PUSH_RUN_CONCURRENCY` | 5 | `packages/types/alerts.ts`, `apps/notify` Inngest function config | simultaneous Inngest function RUNS — distinct from the in-flight-sends number above, and bounded by the Inngest plan rather than by delivery tuning | implemented |
| `INNGEST_PLAN_CONCURRENCY_LIMIT` | 5 | `packages/types/alerts.ts` | the Inngest account's own concurrent-run ceiling; declaring more makes Inngest reject the WHOLE app registration | implemented |
| `ANNOUNCEMENT_PUSH_BATCH_SIZE` | 100 | `packages/push` | targets per Inngest step, keeping each invocation inside the function time limit | documented |
| `ANNOUNCEMENT_PUSH_MAX_PER_USER_PER_HOUR` | 6 | `packages/push` | anti-spam ceiling per subscriber, applied per-user rather than as a global cadence | documented |
| `ALERT_SUBSCRIBE_RATE_LIMIT` | 5/min per user | `packages/security/rateLimit.ts` | §6's `POST /api/alerts/subscribe` and `POST /api/alerts/push-subscription` rows | implemented |
| `ANNOUNCEMENT_CREATE_RATE_LIMIT` | 10/min per user | `packages/security/rateLimit.ts` | §6's `POST /api/announcements` row | implemented |
| `AUDIT_LOG_PAGE_SIZE_DEFAULT` | 50 | `apps/api/src/routes/audit-log.ts` | default page size for `GET /api/admin/audit-log` | implemented |

`CORS_ALLOWED_ORIGINS`'s value in `apps/api/wrangler.toml` is
`https://avash.pages.dev` — the real Cloudflare Pages project domain
(`avash`, production branch `main`), no longer a placeholder.
`wrangler.toml`'s `[vars]` blocks are the local-dev/manual-deploy
fallback only: `deploy-api.yml` overrides both `CORS_ALLOWED_ORIGINS` and
`CORS_PREVIEW_ORIGIN_SUFFIX` at deploy time via `wrangler deploy --var`,
sourced from a same-named GitHub Environment or repository variable
(`docs/ci-cd.md` § Required secrets and repository variables), which is
unset today — the committed fallback is what actually deploys, and it
happens to already be the real domain. If a custom domain replaces
`avash.pages.dev` later, either set that GitHub variable (no commit
needed) or update all three `[vars]` blocks in `wrangler.toml` for the
local-dev default — nothing else needs to change since the code reads
the vars, never a hardcoded literal. The same real origin must be kept in
sync by hand in `apps/web/public/_headers`'s `connect-src` (no build-time
substitution there — Cloudflare Pages only reads that file as static
config) and, for the Docker image path, is substituted automatically from
`VITE_PUBLIC_API_BASE_URL` into `apps/web/docker/security-headers.conf.template`.
`CORS_PREVIEW_ORIGIN_SUFFIX` is always a bare suffix (e.g.
`avash.pages.dev`), never a glob like `*.avash.pages.dev` —
`apps/api/src/config/cors.ts` builds the subdomain wildcard itself and
escapes this value as a literal string.

That is 54 rows covering all 55 named constants from §14 — one row,
`MIN_RECALL_TARGET`/`MIN_PRECISION_TARGET`, carries two names, matching
how §14 itself pairs them. (Rows whose *value* is a pair, such as the
per-window rate limits and `PREDICTION_HORIZONS_WEEKS`, are one constant
each, not two.) `API_CLIENT_TIMEOUT_MS`
was added with the frontend/backend integration per R9 — new constant,
added to both this table and `PROJECT_PLAN.md` §14 in the same change that
introduced its use in `apiClient.ts`. The three container pins
(`POSTGIS_LOCAL_IMAGE`, `ML_PYTHON_IMAGE`, `POSTGRES_LOCAL_PORT`) were
added with the local Docker infrastructure (ADR-011) for the same reason:
an image tag that drifts silently is exactly the failure R9 exists to
prevent — a migration suite passing against a different database engine
than the one it will deploy to. Bumping either image means changing the
pin here, in §14, in `compose.yaml`/`docker/ml.Dockerfile`, and in the CI
job that mirrors it, in one PR.

The four app-image rows (`WEB_IMAGE_BASE`, `API_IMAGE_BASE`,
`APP_CONTAINER_PORTS`, `CONTAINER_REGISTRY`) arrive with ADR-012 and are
`documented` until the Dockerfiles and `build-images.yml` exist. The port
row matters more than it looks: 8080 and 8787 appear in the nginx server
block, the Node entry's `PORT` default, `compose.yaml`, both `HEALTHCHECK`
lines, and the CSP the web image serves — five places that must agree, and
five places where a bare literal would drift.

The three map rows (`MAP_TILE_URL_TEMPLATE`, `MAP_TILE_ATTRIBUTION`,
`MAP_TILE_MAX_ZOOM`) arrive with ADR-013. They are registry constants rather
than environment variables on purpose: OpenStreetMap tiles need no
credential, so these values are identical in every environment and secret
in none — an env var would imply a per-environment difference that does
not exist. `MAP_TILE_URL_TEMPLATE` is also the seam ADR-013 relies on:
changing the tile provider is an edit to this one row plus the CSP
`img-src` entry, and nothing else.

## The rule

A number hardcoded anywhere in the codebase (a route handler, a migration,
a config file, a test) must appear in this table **and**
`docs/PROJECT_PLAN.md` §14 before it is used. If a task needs a new
constant that isn't here, add the row to both places in the same change —
do not introduce a bare literal and document it "later."

## Flipping a row to `implemented`

A row's `Status` flips to `implemented` once the constant is actually read
from its documented location in shipped code (not just referenced in a
comment or a doc). The PR that wires it in records the flip in the same
change. Expected flip points:

- `FRONTEND_BUNDLE_BUDGET_KB` — frontend scaffold (bundle budget CI check).
- `RISK_LEVEL_BANDS`, `ALERT_PROXIMITY_RADIUS_DEFAULT_M`,
  `DB_STATEMENT_TIMEOUT_S`, `MV_REFRESH_INTERVAL` — database schema build-out.
- `CORS_ALLOWED_ORIGINS` — backend scaffold.
- The remaining ML, rate-limit, and cadence constants flip as their owning
  vertical slice ships (`docs/PROJECT_PLAN.md` §13, slices 3, 4, 5, 7).

The weather dashboard and risk map read path flipped fifteen rows in one
change: the ten rows registered alongside that slice's contract
(`WEATHER_CACHE_TTL_S` through `MAP_DEFAULT_ZOOM`), plus five pre-existing
rows the slice's implementation finally wired in
(`WEATHER_INGEST_CADENCE`, `RISK_MAP_CACHE_TTL_S`, `MAP_TILE_URL_TEMPLATE`,
`MAP_TILE_ATTRIBUTION`, `MAP_TILE_MAX_ZOOM`).

The auth, symptom-checker, breeding-report, and resource-ticker slices
flipped the remaining sixteen `documented` rows once their vertical
slices shipped: the two rate-limit and quota rows now read by
`symptom-check.ts` (`SYMPTOM_CHECK_RATE_LIMIT`, `GEMINI_DAILY_QUOTA_GUARD`),
the two now read by `reports.ts` (`BREEDING_REPORT_RATE_LIMIT`,
`REPORT_VERIFY_RATE_LIMIT`), the one read by `resources.ts`
(`BLOOD_UPDATE_RATE_LIMIT`), `APP_ROLE_CLAIM_PATH` (`roles.ts` /
`auth.ts`), the four Gemini/symptom-text constants (`JWT_CLOCK_TOLERANCE_S`,
`GEMINI_MODEL_ID`, `GEMINI_REQUEST_TIMEOUT_MS`, `SYMPTOM_TEXT_MAX_CHARS`),
and the six report/resource constants
(`REPORT_DESCRIPTION_MAX_CHARS`, `SPAM_LIKELIHOOD_REJECT_THRESHOLD`,
`BLOOD_UNITS_MAX`, `RESOURCE_SEARCH_RADIUS_DEFAULT_M`,
`HOSPITAL_RESULT_LIMIT`, `RESOURCES_CACHE_TTL_S`).

The RBAC slice added seven rows, all `implemented` on arrival: `AppRole`,
`DEFAULT_APP_ROLE`, `ROLE_CAPABILITIES`, `ROLE_ASSIGNMENT_RATE_LIMIT`,
`ADMIN_USER_PAGE_SIZE`, and `SUPABASE_LOCAL_API_PORT` (ADR-014). It also
**changed** an existing value: `GEMINI_MODEL_ID` moved from
`gemini-2.5-flash` to `gemini-3.1-flash-lite`. Three compounding reasons,
all found together: Google retired `gemini-2.5-flash` for new API
consumers (still listed by `GET /v1beta/models`, 404 on every
`generateContent`); the `responseSchema` being sent was never valid
anyway (`z.toJSONSchema()` emits `$schema`/`additionalProperties`, which
Gemini 400s — so the 404 was masking a second bug); and the obvious
replacement, `gemini-3.5-flash`, measured 14–30s per call because it
reasons before answering, blowing both `GEMINI_REQUEST_TIMEOUT_MS` (5s)
and `API_CLIENT_TIMEOUT_MS` (8s). The `-lite` pin measures 1.3–1.5s.
Both Gemini-assisted features had therefore been silently running in
their fallback mode since they shipped. `AppRole` is the second
value change: `moderator | admin` → the four-role set, with `citizen`
becoming a real assignable value rather than an absence.
