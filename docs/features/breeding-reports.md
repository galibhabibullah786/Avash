# Breeding-Site Reports

Follows the mandatory template from `docs/PROJECT_PLAN.md` §12.

**Gist:** A page at `/report` lets anyone — signed in or not — report a
suspected mosquito breeding site (standing water, a blocked drain, a
discarded container, a construction site) by pin-dropping a location and
an optional description. A Gemini-backed plausibility/spam screen runs on
the description, but it never blocks a submission: every well-formed
report is stored, and a report Gemini flags as implausible or spam-like is
simply marked for a moderator's attention rather than rejected or
silently dropped. A page at `/moderation` (moderator/admin only) lists
pending reports read directly from Supabase and lets a moderator mark one
`verified`, `rejected`, or `resolved`.

**Technical Detail:**
- **Anonymous reporting is deliberate, not an oversight.** `POST
  /api/reports/breeding-site` (`apps/api/src/routes/reports.ts`) has no
  `auth` middleware in its chain — a citizen reporting a breeding site
  outside a public building at 2am should never be blocked by not having
  (or not wanting to create) an account. If a valid `Authorization:
  Bearer` header happens to be present, the route verifies it inline
  (`jwtVerify` from `apps/api/src/lib/jwtVerify.ts`, imported directly —
  the `auth` *middleware* is still never added to this route) and records
  `reporter_id`; a missing, malformed, or expired token is silently
  treated as "anonymous", never a `401` — a stale token sitting in the
  browser must never be able to block a report.
- The middleware chain that *is* present: `turnstile()` (bot/abuse
  screen, runs first — a malformed body or an out-of-range lat/lng still
  gets Turnstile's `403` before the schema is ever parsed, since
  Turnstile reads `turnstileToken` off the raw body itself), then two
  `rateLimit()` layers keyed by IP (`BREEDING_REPORT_RATE_LIMIT`: 5/min,
  20/day — `packages/security`). Only then does the handler parse the
  body with `breedingReportRequestSchema` (`packages/types/api.ts`).
- **Spam-flagged, never silently dropped.** The description (if any) is
  screened by `validateReportDescription()`
  (`apps/api/src/lib/reportValidation.ts`) — a fixed, non-interpolated
  system instruction plus `callGeminiStructured` (§5.4 prompt-injection
  defenses: delimited untrusted-data block, sanitized input, structured
  output re-validated against `aiValidationSchema`, bounded timeout).
  Whatever comes back (`isPlausible`, `category`, `spamLikelihood`) is
  stored as-is in the `ai_validation` jsonb column. `status` is always
  `'pending'` on create — the create schema does not even expose a
  `status` field, so a client-supplied `status` value is silently
  stripped by zod before it ever reaches the insert.
  `spamLikelihood > SPAM_LIKELIHOOD_REJECT_THRESHOLD` (0.7, §14) does not
  reject the report — it only sets `flaggedForReview: true` in the
  response. There is no separate "flagged" column: a flagged report is
  derived at read time as `ai_validation.spamLikelihood > 0.7`, both in
  the create response and on the moderation queue page.
- **A Gemini outage degrades the same way spam does, never a `500`.** If
  `callGeminiStructured` returns `{ ok: false }` (HTTP failure, quota
  exhaustion, timeout, malformed response), the route inserts the report
  anyway with a fallback `ai_validation` payload
  (`AI_VALIDATION_UNAVAILABLE`, `spamLikelihood: 1`) so it surfaces as
  flagged-for-review by the same derived rule, without inventing a second
  "AI unavailable" code path a moderator has to special-case.
- **Geometry over PostgREST — GeoJSON, no RPC needed.** `breeding_reports.geom`
  is `geometry(Point, 4326)`. The create route inserts
  `geom: { type: 'Point', coordinates: [lng, lat] }` directly through the
  Supabase client (note the GeoJSON lon/lat order, opposite of the
  request schema's `lat`/`lng` field order). This was the riskiest open
  question in this slice's brief and was verified against the real local
  Postgres/PostGIS container before relying on it: PostgREST's insert
  path effectively runs the JSON payload through
  `json_populate_recordset`, which stringifies the `geom` field's JSON
  object and hands that text to the column's own input function —
  PostGIS's `geometry_in` accepts GeoJSON text natively (confirmed with
  `select (json_populate_recordset(null::breeding_reports,
  '[{"geom":{"type":"Point","coordinates":[90.4,23.78]}, ...}]'::json)).*`
  against the project's Postgres container, which correctly produced
  `SRID=4326;POINT(90.4 23.78)`). No RPC function or migration was
  needed.
- `PATCH /api/reports/breeding-site/:id/verify` — chain: `auth({ role:
  'moderator' })`, then `rateLimit()` (20/min, keyed by user id,
  `REPORT_VERIFY_RATE_LIMIT`). The handler **re-checks the caller's role
  in the handler body itself** (`isModerator(c.get('user')?.role)`) even
  though the `auth` middleware already gates this — intentional defense
  in depth, not dead code, so a future middleware refactor can't silently
  reopen this route. `breedingReportVerifyRequestSchema` deliberately
  excludes `'pending'` from its status enum — a verify action can only
  move a report forward, never back to pending. An unknown `:id` is a
  generic `404` (queried via `.maybeSingle()` rather than `.single()`, so
  "zero rows updated" is a clean branch, not a thrown PostgREST error to
  catch).
- **The moderation queue bypasses `apps/api` entirely.** `/moderation`
  (`apps/web/src/pages/Moderation.tsx`, backed by
  `apps/web/src/features/reports/usePendingReports.ts`) reads
  `breeding_reports` straight from Supabase with the browser's anon key +
  the signed-in user's session — the same pattern other public-read
  features in this repo use — because the frozen migration already ships
  a `breeding_reports_select_moderation` RLS policy (`for select using
  (public.app_role() in ('moderator','admin'))`). Only the verify
  *action* (a write) goes through the Worker, where the service-role
  client and rate limiting live. This means a moderator with an expired
  session sees a real, RLS-shaped empty/error result reading the queue —
  not a fake "no reports" state — and the verify buttons are disabled
  outright whenever `useSession().accessToken` is absent.
- **The queue is now paginated, filtered, and sorted — still entirely
  through PostgREST, never `apps/api`.** The direct-Supabase-read
  rationale above still holds and is now load-bearing for *how* paging
  works, not just *whether* it does: `usePendingReports.ts` adds
  `.range(from, to)` and `{ count: 'exact' }` to the same query, plus a
  `status` filter and `created_at`/`status` sorting. It maps the result
  into the shared `PageMeta` shape (`docs/features/platform-primitives.md`)
  by hand, since there is no Hono route here to run `parseListQuery`/
  `buildPageMeta` for it — a page 3 request at size 25 becomes
  `.range(50, 74)`. PostgREST's `count` is nullable (a failed count plan
  returns `null`, not `0`), and it is optional-chained straight into
  `pageMeta.total` rather than coerced — `DataTable`'s footer treats "0
  reports" and "count unknown" as different states, and the two transports
  in this project (this one, and `apps/api`'s Hono-side `parseListQuery`)
  produce the identical `PageMeta` shape from different sources, which is
  the entire point of the shared contract.
- **Report form** (`apps/web/src/pages/Report.tsx`): description textarea
  capped at `REPORT_DESCRIPTION_MAX_CHARS` (1000, §14) with a live
  counter; a location field backed by
  `apps/web/src/features/reports/useReportLocation.ts` with a "Use my
  location" button plus always-visible manual lat/lng fallback fields
  (shown regardless of permission state, so a denied/unsupported
  geolocation call never blocks submission); the Turnstile widget
  (`apps/web/src/features/reports/TurnstileWidget.tsx`) rendered via
  Turnstile's plain script-tag API — see **Deviations** below for why.
  Submission goes through `useSubmitBreedingReport()` (`useMutation` +
  `fetchApi`), attaching the signed-in user's access token only when one
  exists.

**Critical Constants:**

| Constant | Value | Defined in | Purpose |
|---|---|---|---|
| `REPORT_DESCRIPTION_MAX_CHARS` | 1000 | `packages/types/api.ts` | §5.4 input length cap, also the textarea's `maxLength`/counter |
| `SPAM_LIKELIHOOD_REJECT_THRESHOLD` | 0.7 | `apps/api/src/routes/reports.ts` | above this a report is flagged for moderator review, never rejected |
| `BREEDING_REPORT_RATE_LIMIT` | 5/min, 20/day per IP | `packages/security` | abuse prevention on the anonymous create route |
| `REPORT_VERIFY_RATE_LIMIT` | 20/min per user | `packages/security` | abuse prevention on the moderator verify route |
| `GEMINI_MODEL_ID` / `GEMINI_REQUEST_TIMEOUT_MS` | `gemini-3.1-flash-lite` / 5000 | `apps/api/src/lib/geminiClient.ts` | shared with the symptom checker; bounds the report-validation call inside the Worker's request budget |

**Security Considerations:**

STRIDE analysis, mirrored into `docs/security/threat-model.md`:

- *Spoofing:* the create route is intentionally unauthenticated —
  `reporter_id` is best-effort attribution, not an identity guarantee,
  and nothing downstream treats it as one. The verify route requires a
  real Supabase-issued, HS256-verified moderator/admin token; role is
  read from `app_metadata`, which only server-side code can set.
- *Tampering:* a client sending `status` (or any other server-computed
  field) on create. Mitigated by `breedingReportRequestSchema` not
  exposing `status` at all — zod strips unknown keys by default, so the
  field never reaches the insert regardless of what the client sends.
  `breedingReportVerifyRequestSchema` further excludes `'pending'` from
  the verify enum so a moderator action can never regress a report's
  state.
- *Repudiation:* `verified_by` is set from the JWT's `sub` inside the
  handler, never accepted from the request body — a moderator cannot
  attribute their own verification action to someone else.
- *Information disclosure:* PostgREST/Gemini/Turnstile error detail is
  never returned to the client on any branch — `buildGenericErrorBody()`
  plus server-side `logger.error` keyed by `requestId`, the same pattern
  as every other route in this repo.
- *Denial of service:* an anonymous flood of create requests. Mitigated
  by Turnstile (bot screen ahead of everything else in the chain) plus
  the two IP-keyed rate limits; both fail closed (`429`) if Redis itself
  is unreachable — a limiter that cannot be consulted is not a limiter
  (`apps/api/src/middleware/rate-limit.ts`).
- *Elevation of privilege:* a non-moderator token reaching the verify
  handler. Mitigated twice — the `auth({ role: 'moderator' })` middleware
  and a redundant in-handler role check — plus the
  `breeding_reports_update_moderation` RLS policy as a third, DB-level
  backstop if the Worker's service-role write path is ever bypassed.

**Deviations from the original brief:**
- `apps/web/src/hooks/useGeolocation.ts` is a frozen Phase-0 stub
  (`export const useGeolocation = () => {};`, no return value at all) —
  not yet load-bearing. It is outside this slice's owned-files scope
  (`apps/web/src/hooks/**` belongs to no listed path in this feature's
  Owns), so it was called for forward-compatibility but not relied on;
  the actual device-geolocation logic lives in this feature's own
  `apps/web/src/features/reports/useReportLocation.ts`, built directly on
  `navigator.geolocation`. When the shared hook gets a real
  implementation, `useReportLocation.ts` is the one file to revisit.
- No Turnstile React SDK exists in `apps/web/package.json` and none was
  added — `TurnstileWidget.tsx` renders the widget via Turnstile's plain
  script-tag API instead, avoiding a new dependency and any lockfile
  contention with sibling workers building in parallel.

**Manual Test Log:**

2026-08-16, integration pass. `pnpm lint && pnpm typecheck && pnpm test
&& pnpm build` green. `apps/api/test/routes/reports.test.ts` (20 cases)
covers every branch described above with fake Turnstile/Redis/Gemini/
Supabase doubles; `apps/api/src/routes/reports.ts` coverage: 89.23%
statements / 85.41% branches (threshold: 85/80). `apps/api/e2e/reports.spec.ts`
run against a locally started `wrangler dev` instance: the create route's
Turnstile boundary and the verify route's auth/rate-limit boundaries were
confirmed over real HTTP — `.dev.vars`'s `TURNSTILE_SECRET_KEY` does not
verify against the real Cloudflare siteverify endpoint from this
environment (no documented always-pass test secret exists for this
project), so a well-formed anonymous submission gets a real `403` rather
than a `201`; `.dev.vars`'s Upstash credentials are likewise unreachable
from here, so an authenticated moderator request that clears `auth` gets
a real `429` (fail-closed) rather than reaching the handler. Both are
documented, expected boundaries given this environment's placeholder
third-party credentials, not test failures — see the comment block at the
top of that spec file. `apps/web/e2e/reports.spec.ts` (7 cases) verified
manually against a dedicated `vite preview` instance with the Turnstile
script and API stubbed via Playwright route interception (port 4173, this
repo's configured e2e port, was occupied by a sibling worktree's own
preview server at integration time and was left undisturbed). Reviewer
sign-off pending.
