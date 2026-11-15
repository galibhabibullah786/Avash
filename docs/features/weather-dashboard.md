# Weather Dashboard

Follows the mandatory template from `docs/PROJECT_PLAN.md` §12.

**Gist:** A read-only page at `/weather` shows the latest weather reading
for every seeded region and, once a region is picked, a short history
chart for that region. It answers "what is the weather doing right now,
and over the last couple of weeks, in the areas this app tracks" — the
same weather signal the risk model consumes, made visible so a reader can
sanity-check the model against what actually happened.

**Technical Detail:**
- Data flow: `scripts/jobs/weather-ingest.ts` (scheduled GitHub Actions
  job) pulls per-region observations from OpenWeatherMap and writes rows
  into `weather_observations`, using `region_ingest_targets` (a read view
  in `packages/db/supabase/migrations/20260215000009_api_read_views.sql`)
  to get one lat/lng centroid per region without decoding geometry in the
  job. `apps/api` then serves two read-only endpoints:
  - `GET /api/weather/latest?regionCode=` reads `region_latest_weather`
    (the latest row per region, `select distinct on (region_id) ...` over
    `region_weather_observations`) and returns
    `latestWeatherResponseSchema` (`packages/types/api.ts`) —
    `{ observations: [], generatedAt, requestId }`. `observations` is
    always an array, `[]` when empty, never `null`.
  - `GET /api/weather/history?regionCode=&days=` reads
    `region_weather_observations` filtered to one region and returns
    `weatherHistoryResponseSchema` — `{ regionCode, regionName,
    windowDays, points: [], generatedAt, requestId }`, `points` ascending
    by `observedAt`. `regionCode` is required; a missing value is a
    generic `400` before any query runs. `days` is clamped server-side to
    `WEATHER_HISTORY_WINDOW_DAYS` (14) regardless of what the caller asks
    for — there is no way to request a longer window than the dashboard
    itself shows.
  - Both endpoints set `Cache-Control` to `WEATHER_CACHE_TTL_S`
    (`s-maxage=900, stale-while-revalidate=1800`).
- Running the Ingest Job:
  `scripts/jobs/weather-ingest.ts` (alias `pnpm job:weather`) supports flexible execution:
  - `pnpm job:weather --mock --dry-run`: Runs full transformation on synthetic data without calling OpenWeatherMap or Supabase.
  - `pnpm job:weather --mock`: Ingests synthetic weather readings directly into local Supabase.
  - `pnpm job:weather --live`: Calls OpenWeatherMap API and persists observations to Supabase.
  - `pnpm job:weather --live --dry-run`: Queries OpenWeatherMap API and displays observations without writing to Supabase.
- `apps/web`'s `/weather` page (React Router, `apps/web/src/pages/Weather.tsx`)
  fetches `latest` on load to populate a region selector (options come
  from the `regionCode`/`regionName` pairs already present in the
  `latest` payload — there is no separate `/api/regions` endpoint; see
  §6's amendment note in `docs/PROJECT_PLAN.md` for why one was not
  added), then fetches `history` for whichever region is selected to
  render a sparkline of mean temperature (`tempMeanC`) over the window —
  the single hand-rolled inline-SVG sparkline this slice's "minimal
  frontend" scope calls for, not one per weather field. `history.points`
  also carries `humidityPct`/`precipitationMm` on the wire for a future
  slice to chart; today only `tempMeanC` is plotted.
- Every numeric field on `weatherObservationDtoSchema`
  (`tempMeanC`, `tempMinC`, `tempMaxC`, `humidityPct`, `precipitationMm`)
  is nullable — a region can have a row with partial data (e.g. an
  upstream field the provider didn't return that ingest cycle). The
  dashboard renders a missing value as an explicit "no data" marker, not
  a zero or a blank chart gap that could be misread as "measured as
  zero."
- Edge cases handled by the contract: an unknown `regionCode` on
  `history` is well-formed input with no matching rows, not a malformed
  request — the route does not 404 on it (there is no per-region
  existence check in the stub contract); a region with genuinely no
  ingested observations yet returns `points: []` with `windowDays` still
  set, which the UI renders as an explicit empty state rather than an
  error state.

**Critical Constants:**

| Constant | Value | Defined in | Purpose |
|---|---|---|---|
| `WEATHER_CACHE_TTL_S` | `s-maxage=900, stale-while-revalidate=1800` | `apps/api/src/routes/weather.ts` | edge cache for weather reads; 15 min against a 3 h ingest cadence never serves a value the source could have refreshed |
| `WEATHER_HISTORY_WINDOW_DAYS` | 14 | `apps/api/src/routes/weather.ts` | dashboard history window; also the server-side ceiling on `?days=` |
| `WEATHER_INGEST_REQUEST_SPACING_MS` | 1100 | `scripts/jobs/weather-ingest.ts` | paces OpenWeatherMap calls under the free tier's 60/min ceiling |
| `WEATHER_INGEST_MAX_RETRIES` | 3 | `scripts/jobs/weather-ingest.ts` | per-region retry budget on 429/5xx before that region is skipped for the cycle |
| `API_CLIENT_TIMEOUT_MS` | 8000 | `apps/web/src/lib/apiClient.ts` | aborts a hung `/api/weather/*` request instead of a query pending indefinitely |

**Security Considerations:**

STRIDE analysis, mirrored into `docs/security/threat-model.md`:

- *Tampering:* a forged `regionCode`/`days` value reaching a SQL query.
  Mitigated by zod-schema parsing before any query, and PostgREST
  parameterizing every filter it builds from those values — there is no
  string-concatenated SQL anywhere on this path.
- *Information disclosure:* a PostgREST error body (which can include
  table/column names) echoed straight back to the client. Mitigated by
  `buildGenericErrorBody()` (`@avash/logger`) on every error branch —
  the caller only ever sees `{ error: { message, requestId } }`, and the
  real error is logged server-side keyed by `requestId`.
- *Information disclosure:* `OPENWEATHERMAP_API_KEY` appearing in a job
  log via the fully-qualified request URL (the key is a query parameter
  on that provider's API). Mitigated by the ingest job logging only the
  region code and the HTTP status per attempt, never the request URL —
  and GitHub Actions independently masks any literal `secrets.*` value
  that does end up in output.
- *Denial of service:* an oversized `?days=` value, or a flood of
  requests, forcing a large scan. Mitigated by the server-side clamp to
  `WEATHER_HISTORY_WINDOW_DAYS`, the existing 5 s DB statement timeout
  (`docs/PROJECT_PLAN.md` §8), and reads going through the
  `region_weather_observations`/`region_latest_weather` views rather than
  ad hoc joins.
- *Spoofing:* none new — both weather routes are unauthenticated public
  reads with no identity to spoof. Stated explicitly rather than left
  silent, per `docs/PROJECT_PLAN.md` §7.2's convention.

**Open item — rate-limit column discrepancy (flagged, not resolved).**
`docs/PROJECT_PLAN.md` §6 lists `60/min/IP` in the Rate Limit column for
both weather routes, but their Middleware Chain column reads only `cors,
headers` — no `rate-limit` entry runs on these paths, and that is what is
actually implemented. This predates the weather routes and is left open
for the security-hardening slice; it is not something this document
resolves.

**Predictions are not part of this page.** The weather dashboard renders
observed weather only, not risk. Anything the risk model derives from
this data — including whether a given prediction is a placeholder — is
covered in `docs/features/risk-map.md`, which documents the
`modelVersion === 'stub-0.0.0'` (`STUB_MODEL_VERSION`) / `isStub` signal.

**Manual Test Log:**

2026-08-15, integration pass. Full results and evidence in
`docs/testing/verification-report.md` §8.2. Summary: all three passes ran
to completion; every check not requiring a live Supabase project (no
hosted project is reachable from this local checkout) passed with direct
evidence (curl output, a live `wrangler dev` instance, or the Playwright
suites). Checks that specifically require a live database read are marked
"not run locally" in the report and are instead covered by
`apps/api/test/routes/weather.test.ts`'s fake-PostgREST-double suite and
`apps/api/e2e/weather.spec.ts`'s schema-valid-200 tests (which do run
against a real deployment). Reviewer sign-off pending.
