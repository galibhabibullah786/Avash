# Backend Coding Standards

**Read when:** adding or changing a route, middleware, or the app entry under apps/api/src.

**Decides:** Routing conventions, middleware order, error boundary, pooling, and the jobs-endpoint ban.

`apps/api` is a Hono application running on Cloudflare Workers. It is the
**only** place secret-touching, per-request logic is allowed to live
(ADR-001) — no background job ever runs as an HTTP endpoint here (R7,
ADR-007).

## Routing conventions

- **Route-file-per-domain:** each `apps/api/src/routes/*.ts` file owns one
  domain from `docs/PROJECT_PLAN.md` §6 — `risk-map.ts`, `resources.ts`,
  `reports.ts`, `symptom-check.ts`, `alerts.ts`. A route file never reaches
  into another domain's concerns; shared logic goes in `apps/api/src/lib/`
  or `packages/*`.
- Routes are mounted in `apps/api/src/index.ts`, which owns the
  middleware chain order and the route table — it is the only file that
  assembles the full app.
- Every route handler parses its input with a zod schema from
  `packages/types` before touching any data (zod-parse-on-entry, below) and
  parses its output against the corresponding response schema before
  returning.

## Middleware chain order

Applied in this exact order, on every request:

1. `request-id` — generates a correlation ID, stores it in context,
   returns it as `X-Request-Id` on every response.
2. `security-headers` — applies the full `docs/PROJECT_PLAN.md` §7.4
   header set to every response.
3. `cors` — strict origin allow-list (`CORS_ALLOWED_ORIGINS`, §14); unlisted
   origins get no CORS headers back, never a wildcard. The allow-list
   itself is Worker config, not a source-code literal: `wrangler.toml`'s
   `CORS_ALLOWED_ORIGINS` (comma-separated exact origins) and
   `CORS_PREVIEW_ORIGIN_SUFFIX` (bare domain suffix PR-preview
   subdomains must end in) are read at request time in
   `apps/api/src/config/cors.ts`. Changing the allowed domain is a
   `wrangler.toml` edit, not a code change — and because Wrangler does
   not merge `[vars]` across environments, both vars must be redeclared
   in `[vars]`, `[env.preview.vars]`, and `[env.production.vars]`.

   **Local development origin:** the Vite dev server
   (`http://localhost:5173`) needs a `CORS_ALLOWED_ORIGINS` entry to reach
   a locally running Worker, but `localhost` must never appear in
   `wrangler.toml` — that file's `[vars]`/`[env.*.vars]` blocks are what
   actually ships to preview and production. Instead, `apps/api/.dev.vars`
   (gitignored, templated by `.dev.vars.example`) sets a local-only
   `CORS_ALLOWED_ORIGINS` value that *includes* `http://localhost:5173`.
   `wrangler dev` reads `.dev.vars` in preference to `wrangler.toml`'s
   top-level `[vars]`, so the override applies only to `wrangler dev` and
   never touches a deployed environment.
4. Route-specific middleware, in this sub-order where applicable:
   `auth` (JWT verification, ADR-009) → `turnstile` (anonymous write
   routes) → `rate-limit` (Upstash sliding window, §7.3).
5. The route handler itself.
6. `onError` (Hono's error handler, wired to `withErrorBoundary()`) —
   catches anything thrown anywhere above and returns a generic response.

This order is not arbitrary: `request-id` must exist before anything else
so every downstream log line and error response can be correlated;
`security-headers` and `cors` apply uniformly regardless of whether the
route ultimately succeeds or is rejected downstream; auth/turnstile/rate-limit
run before any handler touches the database or an external API, so a
rejected request never reaches privileged logic.

## `withErrorBoundary()` + correlation ID (R10)

Every route handler is wrapped in `withErrorBoundary()`
(`packages/logger`). On a thrown error, it:

1. Logs the full error (message, stack, request context) server-side as
   structured JSON, tagged with the request's correlation ID.
2. Returns a **generic**, user-safe JSON error body containing only the
   correlation ID and a non-specific message — never a stack trace,
   internal path, or dependency version.

Hono's top-level `onError` in `index.ts` uses the same helper as a final
backstop, so no unhandled exception can leak internal detail even if an
individual route forgets to wrap itself.

## Zod-parse-on-entry contract discipline

Every request body, query string, and route param that a handler reads is
parsed against a zod schema from `packages/types` **before** any business
logic runs. A parse failure returns a generic `400` (never echoing back
the malformed input verbatim) and never reaches the database or an
external API call. This is the same schema the `apps/web` `apiClient.ts`
uses to validate responses — one schema, two directions, imported from one
place (R3).

## Paginated list routes

Any route returning a list adopts the shared contract in
`packages/types/pagination.ts` (`docs/features/platform-primitives.md`
has the full rationale) — never a hand-rolled `{ items, nextPage }`
shape or a bespoke total. In the route handler:

1. Call `listQueryFor([...sortableColumns] as const)` — or
   `listQueryFor([])` when the underlying source cannot sort — and pass
   the result to `apps/api/src/lib/listQuery.ts`'s `parseListQuery(c,
   schema)`. A malformed or out-of-range query string (`pageSize` over
   `LIST_PAGE_SIZE_MAX`, an unknown `sort` value) fails the zod parse and
   `parseListQuery` returns the generic `400` for you — never write a
   second validation branch for this.
2. Query the source using the parsed `page`/`pageSize`/`sort`/`dir`/`q`.
3. Build the response envelope with `buildPageMeta({ page, pageSize,
   total, returned })`, where `total` is `null` whenever the source
   genuinely cannot count (decision A, `docs/features/platform-primitives.md`)
   — never a fabricated number.
4. Parse the final response against `paginatedResponseSchema(itemSchema)`
   before returning it, same as any other route (zod-parse-on-entry
   discipline applies symmetrically to the exit).

A route with a fixed, small sortable set declares it inline
(`listQueryFor(['createdAt', 'status'] as const)`); a route that cannot
sort at all — because its data source has no `ORDER BY` equivalent, like
the Supabase Admin API backing `GET /api/admin/users` — calls
`listQueryFor([])` explicitly rather than omitting the call, so a
`?sort=` on that route is a documented `400`, not a silently ignored
parameter.

## Auditing a write

Every route that mutates data outside its own request/response cycle
(`docs/PROJECT_PLAN.md` §4 amendment, `docs/features/platform-primitives.md`)
calls `writeAuditEntry(sink, entry)` (`packages/security/auditLog.ts`)
after the write has actually taken effect — not before, and not
speculatively on a path that might roll back. `entry` comes from
`buildAuditEntry()`, whose `action` is one of the closed set in
`packages/types/audit.ts` (`auditActionSchema`); a new write path adds
its action to that enum first, in the same change, never as a string
literal at the call site. `apps/api/src/lib/auditSink.ts` is the only
adapter from the structural `AuditSink` interface to the real
service-role Supabase client — `packages/security` itself never imports
`supabase-js`.

Match the existing `role_assignments` write's failure semantics: an
audit-write failure is logged loudly (`logger.error`, keyed by the
request's `requestId`) and does **not** fail the request. By the time
the audit call runs, the mutation it's describing has already committed;
returning a `5xx` at that point reports a false negative for a change
that did happen. A thrown or rejecting sink is caught around the audit
call specifically, never left to propagate into the route's own error
boundary.

## Database access — Supavisor transaction-mode pooling

`apps/api/src/lib/supabaseAdmin.ts` connects via Supabase's **Supavisor**
transaction-mode pooler — never a long-lived direct Postgres connection.
Cloudflare Workers are stateless, short-lived invocations; holding a
persistent connection per-isolate would exhaust the connection pool under
load. Every query is expected to complete within the `DB_STATEMENT_TIMEOUT_S`
(5s, §14) enforced at the API role level.

## The R7 ban on `/api/jobs/*` endpoints

No route under `apps/api` may exist purely to be triggered as a background
job. Weather ingestion, batch prediction, and news scanning run as
scheduled GitHub Actions workflows connecting **directly** to Supabase with
the service-role key stored as a GitHub Actions secret (ADR-007). This is
enforced by review, not by tooling: any PR introducing a route under
`/api/jobs/*`, or any route whose only caller is a cron trigger, is
rejected.

## Testing — two `tsconfig`s, one deliberate reason

`apps/api` has `tsconfig.json` (`include: ["src"]`) and a second
`tsconfig.test.json` (`include: ["src", "test", "e2e",
"vitest.config.ts", "playwright.config.ts"]`) that additionally types
Node's `process` global. This split exists because both test configs need
`process.env` (`CI`, `API_TEST_TARGET`), and TypeScript's
ambient globals apply to an entire compiled program, not per file — if
`process` were typed in the same `tsconfig.json` used for `src/`, a route
handler could type-check `process.env.SUPABASE_SERVICE_ROLE_KEY` even
though the Workers runtime has no such thing; the only correct way to
read config in `src/` is the typed `Bindings` interface
(`apps/api/src/types.ts`). `pnpm --filter api typecheck` runs both
configs (`tsc --noEmit && tsc --noEmit -p tsconfig.test.json`); only the
first is authoritative for "is this deployable," so a route handler that
(incorrectly) referenced `process` would still fail the primary check.

Note the asymmetry this creates and why it is correct: the **Vitest**
suite in `apps/api/test/` runs *inside workerd* (via
`@cloudflare/vitest-pool-workers`), so the tests themselves see the same
runtime as production — it is only the config file that needs Node. The
`apps/api/e2e/` Playwright suite runs in Node by definition, since it is a
client making HTTP requests at a server. See `docs/standards/testing.md`
for which layer owns which case.

## Defense in depth

Every authorization rule enforced by Postgres RLS is **also** checked in
the route handler before the query runs — RLS is the backstop, not the
only gate. Examples: blood inventory updates check
`verified_hospital_staff` membership in the handler in addition to RLS;
breeding-report verification checks the caller's role in the handler in
addition to RLS restricting the `update` policy to `moderator`/`admin`.
This means a misconfigured or accidentally-disabled RLS policy is not the
only thing standing between an unauthorized caller and a privileged write.
