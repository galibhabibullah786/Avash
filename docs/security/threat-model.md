# Threat Model

Full STRIDE (Spoofing, Tampering, Repudiation, Information Disclosure,
Denial of Service, Elevation of Privilege) analysis, organized by feature,
mirroring `docs/PROJECT_PLAN.md` §7.2. Every threat below states its
vector and where the mitigation is actually enforced in code — not just a
general principle.

## Risk Map / Resource Reads (public, unauthenticated)

| Threat | Vector | Mitigation | Enforcement point |
|---|---|---|---|
| Denial of Service | Unbounded bbox queries against the spatial index, or a flood of requests | Clamp max bbox area server-side; reads served from `region_risk_summary` MV + covering GiST index, never a live spatial join on the request path | `apps/api/src/routes/risk-map.ts`, `apps/api/src/routes/resources.ts` |
| Information Disclosure | Exact hospital blood stock scraped in bulk across all hospitals | Rate limit (60/min/IP); no bulk-export endpoint; Realtime channel only exposes rows already covered by public `select` RLS | `apps/api` route rate-limit middleware; RLS on `blood_inventory` |
| Information Disclosure | Basemap tile requests go from the user's browser straight to a third-party host (ADR-013), disclosing the viewport — and therefore the user's approximate area of interest — to OpenStreetMap's servers | Accepted and bounded, not eliminated: tiles carry no identifier of ours, `Referrer-Policy: strict-origin-when-cross-origin` limits what the tile host learns about the page, and the `CacheFirst` service-worker policy means a revisited area produces no new request. No user identifier, report content, or API response ever transits the tile request | `apps/web/public/_headers` (referrer policy + `img-src` allow-list); Workbox tile caching rule (§8) |
| Tampering | A compromised or hijacked tile host serves misleading basemap imagery under our origin | Tiles are `<img>` content, not script: CSP grants the tile host `img-src` only, never `script-src` or `connect-src`, so a hostile response cannot execute or read anything. Every authoritative element — risk shading, markers, labels the user acts on — is our own overlay from `apps/api`, never basemap imagery | `apps/web/public/_headers`, `apps/web/docker/security-headers.conf.template` |

## Breeding Report Submission (anonymous-friendly write)

| Threat | Vector | Mitigation | Enforcement point |
|---|---|---|---|
| Spoofing / Spam | Bot floods the endpoint with fake reports | Turnstile mandatory + IP rate limit (5/min, 20/day) + Gemini spam-likelihood filter, all enforced server-side — unreachable directly from a static frontend bundle | `apps/api/src/middleware/turnstile.ts`, `apps/api/src/middleware/rate-limit.ts`, `apps/api/src/routes/reports.ts` |
| Tampering | Geom injected outside valid coordinate bounds | Server-side `ST_IsValid` check + lat/lng range validation before insert | `apps/api/src/routes/reports.ts`, zod schema in `packages/types` |
| Repudiation | No audit trail for who submitted what | `created_at`, `reporter_id` (nullable), immutable insert — no client-side update/delete path; RLS forbids it | `breeding_reports` schema + RLS policy |
| Elevation of Privilege | A citizen tries to self-verify their own report | `status` update path restricted to `moderator`/`admin` via RLS **and** re-checked in the Hono route handler (defense in depth) | RLS `update` policy on `breeding_reports`; `apps/api/src/routes/reports.ts` role check |

## Blood Inventory Update (privileged write)

| Threat | Vector | Mitigation | Enforcement point |
|---|---|---|---|
| Spoofing | Impersonating hospital staff to alter stock numbers | `verified_hospital_staff` join table, populated only by admin, checked in RLS *and* in `apps/api` middleware (defense in depth) | RLS `update` policy on `blood_inventory`; `apps/api/src/middleware/auth.ts` |
| Tampering | Wildly implausible values submitted (e.g., 99999 units) | `check` constraints (`units_available >= 0`, `platelet_units >= 0`) + a sane upper-bound validation in the zod schema | `blood_inventory` table constraints; `packages/types` zod schema |

## Symptom Checker (LLM-touching)

| Threat | Vector | Mitigation | Enforcement point |
|---|---|---|---|
| Tampering / Prompt Injection | User submits `"ignore previous instructions..."` or similar to steer the model | Fixed system prompt (never user-modifiable), `responseSchema`-constrained output, input sanitization/length caps (§5.4) — all server-side | `apps/api/src/routes/symptom-check.ts`, `apps/api/src/lib/geminiClient.ts` |
| Information Disclosure | Symptom text (potentially sensitive) persisted or leaked | No PII sent to Gemini beyond the structuring call; no conversation persisted beyond the request lifecycle | `apps/api/src/routes/symptom-check.ts` |
| Denial of Service / Cost Abuse | Gemini free-tier quota drained by repeated calls | Per-IP + global daily counter circuit breaker (§7.3); falls back to the deterministic rule engine with an "AI assist temporarily unavailable" notice when tripped | `packages/security/quotaGuard.ts` |

## News Aggregator Agent

| Threat | Vector | Mitigation | Enforcement point |
|---|---|---|---|
| Tampering via untrusted content | Malicious article text attempts to manipulate the LLM into fabricating outbreak data | Content is always wrapped as inert `<article>` data, never role-elevated in the prompt; output requires human `reviewed = true` before it can influence anything public-facing | `scripts/jobs/news-scan.ts`; RLS `select` policy on `news_items` gating unreviewed rows |

## Batch Inference Job

| Threat | Vector | Mitigation | Enforcement point |
|---|---|---|---|
| Tampering | A compromised dependency or supply-chain attack alters the ONNX artifact | Checksum-pinned model file; version recorded in `risk_predictions.model_version`; `predict.py` verifies SHA256 against `ml/training/MODEL_MANIFEST.json` before running, aborts the job on mismatch | `ml/serving/predict.py` |
| Secret Exposure | `VAPID_PRIVATE_KEY` / `SUPABASE_SERVICE_ROLE_KEY` leaked via job logs | Exist only as GitHub Actions encrypted secrets, injected as ephemeral env vars into the runner — never logged; explicit `::add-mask::` on any accidental echo | `.github/workflows/cron-batch-predict.yml` |

## Announcement Push (apps/notify, ADR-016)

Full technical detail: `docs/features/announcement-push.md`.

| Threat | Vector | Mitigation | Enforcement point |
|---|---|---|---|
| Spoofing | An unauthenticated actor `POST`s directly to `apps/notify`'s Supabase Database Webhook endpoint to trigger arbitrary delivery attempts or probe response timing | Constant-time comparison of a shared-secret header before the body is parsed; only `record.id` is ever trusted from the payload, everything else is re-read from the database under the service-role key | `apps/notify/api/announcement-published.ts` |
| Information Disclosure (closed by this slice) | The prior Python matcher never applied `target_roles`, so a role-targeted announcement's full title/body reached every citizen in radius, not just the target role | Role join + spatial match moved into one `security definer` SQL function granted to `service_role` only, so the caller cannot omit the role filter | `packages/db/supabase/migrations/20260819000023_announcement_push_targets.sql` |
| Secret Exposure | `SUPABASE_SERVICE_ROLE_KEY` now has a third home (`apps/notify`, Vercel-hosted) in addition to GitHub Actions and the Cloudflare Worker; `VAPID_PRIVATE_KEY` has a second home alongside `ml/serving/predict.py` | Same handling discipline as existing homes: environment-injected only, never logged, never echoed | `docs/security/secrets-matrix.md` |
| Denial of Service | Repeated delivery attempts for the same announcement (duplicate webhook fires, sweep overlap) | Inngest `idempotency` keyed on the announcement id collapses duplicate events; `ANNOUNCEMENT_PUSH_MAX_PER_USER_PER_HOUR` bounds per-subscriber delivery regardless of trigger count | `apps/notify/src/inngest/deliverAnnouncement.ts`, `packages/push` |

## Cross-Origin Surface (new with the two-app split)

| Threat | Vector | Mitigation | Enforcement point |
|---|---|---|---|
| CORS Misconfiguration | An overly permissive `Access-Control-Allow-Origin` lets any site call the API with a user's token | `apps/api`'s CORS middleware allow-lists exact production + PR-preview Cloudflare Pages origins only, never `*`, never a regex wildcard on write routes | `apps/api/src/middleware/cors.ts` |

## Weather Dashboard (public, unauthenticated)

| Threat | Vector | Mitigation | Enforcement point |
|---|---|---|---|
| Tampering | A forged `regionCode`/`days` value reaching a SQL query | zod-schema parsing before any query runs; PostgREST parameterizes every filter it builds from the validated values | `apps/api/src/routes/weather.ts`, zod schemas in `packages/types` |
| Information Disclosure | A PostgREST error body echoed straight back to the client | Generic `buildGenericErrorBody()` response on every error branch; the real error is logged server-side keyed by `requestId` | `apps/api/src/routes/weather.ts` (`@avash/logger`) |
| Information Disclosure | `OPENWEATHERMAP_API_KEY` appearing in a job log via the request URL (the key is a query parameter on that provider's API) | The ingest job logs only the region code and HTTP status per attempt, never the request URL; GitHub Actions independently masks any literal `secrets.*` value in output | `scripts/jobs/weather-ingest.ts` |
| Denial of Service | An oversized `?days=` value, or a flood of requests, forcing a large scan | Server-side clamp to `WEATHER_HISTORY_WINDOW_DAYS` (14); existing 5 s DB statement timeout; reads go through `region_weather_observations`/`region_latest_weather` views | `apps/api/src/routes/weather.ts` |
| Spoofing | None new — both weather routes are unauthenticated public reads with no identity to spoof | Not applicable; stated explicitly rather than left unconsidered | n/a |

## Risk Map (public, unauthenticated)

| Threat | Vector | Mitigation | Enforcement point |
|---|---|---|---|
| Tampering | A forged `bbox`/`horizon` value reaching a SQL query | `horizonWeeksSchema` + `parseBbox()` validation before any query runs; PostgREST parameterizes every filter built from the validated values | `apps/api/src/routes/risk-map.ts`, `packages/geo/bbox.ts` |
| Information Disclosure | A PostgREST error body echoed straight back to the client | Generic `buildGenericErrorBody()` response on every error branch; real error logged server-side keyed by `requestId` | `apps/api/src/routes/risk-map.ts` (`@avash/logger`) |
| Denial of Service | Unbounded `bbox` (or a flood of requests) forcing a full scan | `BBOX_MAX_SPAN_DEG`; existing 5 s DB statement timeout; `region_risk_geojson` reads a materialized view — spatial work already done before the request path | `packages/geo/bbox.ts`, `apps/api/src/routes/risk-map.ts`, `packages/db/supabase/migrations/20260215000009_api_read_views.sql` |
| Denial of Service | Bulk/rapid tile requests against the free, unauthenticated OSM tile service (tile-usage-policy violation) | Partially mitigated: `MAP_TILE_MAX_ZOOM` bounds request volume per viewport, attribution is shown per OSM policy. **Not yet mitigated:** no `CacheFirst` service-worker/Workbox tile-caching policy exists in the repository as of this writing — checked, not found — this is an open gap | `apps/web/src/features/map/tileLayer.ts`; no service-worker config present under `apps/web` |
| Spoofing | None new — both risk-map routes are unauthenticated public reads with no identity to spoof | Not applicable; stated explicitly rather than left unconsidered | n/a |

## Signed Uploads (`POST /api/uploads/signature`, ADR-015)

| Threat | Vector | Mitigation | Enforcement point |
|---|---|---|---|
| Denial of Service / Cost Abuse | An authenticated user mints signatures in a loop to fill the project's Cloudinary storage/bandwidth quota, without ever completing an upload | Per-user rate limit (`UPLOAD_SIGNATURE_RATE_LIMIT`, 10/min, §14), fail-closed the same way every other Upstash-backed limiter in this project does; the signature itself expires after `UPLOAD_SIGNATURE_TTL_S` (600s) even if minted | `apps/api/src/middleware/rate-limit.ts`, `apps/api/src/routes/uploads.ts` |
| Tampering | A client supplying its own `folder`, hoping to write into another user's asset path or an arbitrary location in the Cloudinary account | `folder` is derived server-side from the authenticated caller's id and the closed `purpose` enum (decision H) — never read from the request body; a client-supplied folder field is silently ignored, not merged | `apps/api/src/routes/uploads.ts`, `packages/types/uploads.ts` |
| Tampering | An upload outside the allowed formats or over the size limit | `allowed_formats` is one of the signed parameters, so a request altering it invalidates the signature and Cloudinary rejects the upload; `UPLOAD_MAX_BYTES` is enforced both as a client-side pre-check and (implicitly, via Cloudinary account limits) at the upload destination | `apps/api/src/lib/cloudinarySignature.ts`, `apps/web/src/features/uploads/useSignedUpload.ts` |
| Information Disclosure | `CLOUDINARY_API_SECRET` leaking via a log line or an error response | Never logged, never included in any response body — only used in-process to compute the signature hash; `buildGenericErrorBody()` on every error branch (R10) | `apps/api/src/lib/cloudinarySignature.ts` |
| Elevation of Privilege | None new — every signed-in role may mint a signature by design (ADR-015); the abuse control is the rate limit, not a capability gate | Stated explicitly rather than left unconsidered | n/a |

## Audit Log (`audit_log`, generic write-path trail)

| Threat | Vector | Mitigation | Enforcement point |
|---|---|---|---|
| Information Disclosure | PII or a secret ending up in `detail` because a caller dumped a whole request body "for debugging" into an append-only, admin-readable table | `detail` is scalars only, one level deep, capped at `AUDIT_DETAIL_MAX_KEYS` (12) keys (decision C) — not arbitrary `jsonb`; a caller with nested context must deliberately flatten it, which is friction by design | `packages/types/audit.ts` (`auditDetailSchema`) |
| Tampering / Repudiation | An actor editing or deleting their own audit trail after the fact | No insert, update, or delete RLS policy exists on `audit_log`, and none is intended — only the service-role key (which bypasses RLS) can write it, and it only ever appends | `packages/db/supabase/migrations/20260817000015_audit_log.sql`; verified against a real Postgres instance in `packages/db/test/audit-log-rls.test.ts` |
| Information Disclosure | A non-admin reading the audit trail | Single `select` policy gated on `public.has_capability('roles:manage')` — every other role, including the actor a row is about, is denied by default | `packages/db/supabase/migrations/20260817000015_audit_log.sql` |
| Denial of Service | An audit-write failure cascading into a failed request, or a flood of writes | Audit writes are best-effort and never fail the request (matches the existing `role_assignments` semantics); write volume is bounded by the same per-route rate limits already gating each write path | `packages/security/auditLog.ts`, `apps/api/src/lib/auditSink.ts` |

---

This threat model is re-run against the *actual shipped code* (not just
the plan) as its own vertical slice — `docs/PROJECT_PLAN.md` §13, slice 9
("Security hardening pass"). Any feature added outside these seven groups
must have its own STRIDE row added here **before** merge, per
`AGENTS.md`'s "When securing a feature" section.
