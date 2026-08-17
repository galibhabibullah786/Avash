# Platform Primitives — pagination, audit log, forms, signed uploads

Follows the mandatory template from `docs/PROJECT_PLAN.md` §12.

**Gist:** Four cross-cutting primitives every write-heavy and list-heavy
screen in this project now builds on, rather than reinventing per feature:
a shared paginated-list contract usable from both `apps/api` and direct
PostgREST reads; a generic, append-only audit log for every write path
that exists today; a small set of form building blocks (`SubmitButton`,
`PasswordInput`, a disabled-fieldset convention, `Spinner`); and a
signed-direct-to-Cloudinary upload flow where the Worker mints a
signature but never touches a file's bytes. None of the four add new
user-facing screens on their own — they are the contract the next slices
build against.

## Technical Detail

### The list-query contract, and its two transports

`packages/types/pagination.ts` is the single source of the shape
(R6) — nothing downstream redeclares a page-meta type.

- **Request side:** `listQuerySchema` parses `page`, `pageSize`, `dir`,
  and `q` off any query string, with `LIST_PAGE_SIZE_DEFAULT` (25) and
  `LIST_PAGE_SIZE_MAX` (100, §14) as the default and ceiling on
  `pageSize`, and `LIST_SEARCH_MAX_CHARS` (120) bounding `q`. `sort` is
  deliberately **absent** from the base schema — see below.
- **Response side:** `paginatedResponseSchema(item)` wraps any item
  schema in `{ items: T[], page: PageMeta, requestId }`. `items` is
  always an array, never `null`, even when empty.
- **Two producers, one shape.** `apps/api/src/lib/listQuery.ts`'s
  `parseListQuery(c, schema)` + `buildPageMeta(...)` produce it from a
  Hono query string and a source's row count. `apps/web`'s moderation
  queue produces the identical `PageMeta` shape from a PostgREST
  `.range(from, to)` call plus `{ count: 'exact' }` — a different
  transport mapped onto the same contract, so `DataTable` cannot tell
  which one it is rendering.

**Nullable `total`, non-null `hasNext` (decision A).** `pageMeta.total`
is `number | null`; `hasNext` is always a real boolean and is the signal
every consumer should actually branch on. This exists because the
Supabase Admin API — what backs `GET /api/admin/users` — has no `count`
operation at all: it returns a page, and that's it. A contract that
required `total` would force either a fabricated number (a lie in a
type) or a second, incompatible response shape for the one route that
can't count. `buildPageMeta()` derives `hasNext` two ways depending on
what it's given: arithmetically when `total` is known
(`page * pageSize < total`), or from whether a full page came back when
it isn't (`returned >= pageSize`) — the same signal PostgREST's own
`.range()` result implies. The UI-visible cost is one screen (the admin
user directory) rendering "showing 26–50" instead of "showing 26–50 of
312"; every other list has a real total and shows it.

**The sort key is a closed, per-route enum, never a free string
(decision B).** The base `listQuerySchema` has no `sort` field at all —
a route opts in by calling `listQueryFor(['createdAt', 'status'] as const)`,
which extends the schema with `sort: z.enum([...])` over exactly that
route's sortable columns, or `listQueryFor([])` for a source that cannot
sort at all (the Admin API — see below). A free-text sort key reaching a
PostgREST `.order()` or a hand-written `ORDER BY` is both an injection
surface and an information-disclosure one (an attacker can order by a
column they have no business knowing exists, and infer its values by
binary-searching the resulting order). Rejecting an unknown sort key at
the zod boundary means a route handler never sees one — there is no
"else" branch to get wrong. The cost is symmetric with decision A's:
adding a sortable column to an existing route is a `packages/types`
edit, on purpose, so it goes through the same review a new response
field would.

**`GET /api/admin/users` cannot filter, sort, or count.** It is backed
by the Supabase Admin API's `listUsers(page, perPage)`, full stop — no
`q`, no `.order()`, no total. It calls `listQueryFor([])` (an empty
sortable set, so `?sort=` on this route is a `400`, not a silent
no-op), keeps `ADMIN_USER_PAGE_SIZE` (50, §14) as its page-size default
(decision F — the constant's registry purpose text now reads "default
page size for the admin user list" rather than "bounds one page",
because a client can still request up to `LIST_PAGE_SIZE_MAX`), and
always returns `total: null`. The admin user directory's `DataTable` is
rendered pagination-only, with an inline note that the directory cannot
be searched or sorted, rather than showing dead controls.

**The moderation queue is PostgREST, not `apps/api`.**
`apps/web/src/features/reports/usePendingReports.ts` reads
`breeding_reports` straight from Supabase (`docs/features/breeding-reports.md`
has the full rationale for reading it directly at all) with `.range(from, to)`
and `{ count: 'exact' }`, filtered by `status` and sorted by `createdAt`
or `status` — the one source in this slice where `count` is cheap enough
to ask for on every page. That `count` is itself nullable (PostgREST
returns `null` when the count can't be computed, e.g. a failed count
plan) — mapped straight to `pageMeta.total`, never coerced to `0`, since
`0` and "unknown" mean different things to `DataTable`'s footer.

### The audit log

`packages/types/audit.ts` is the schema; `packages/security/auditLog.ts`
(`buildAuditEntry()` + `writeAuditEntry(sink, entry)`) is the writer;
`apps/api/src/lib/auditSink.ts` adapts the service-role Supabase client
to the structural `AuditSink` interface the writer takes
(`{ insert(row): Promise<{ error }> }`) — `packages/security` gains no
`supabase-js` dependency to do this, since the sink is injected, not
imported.

**Five actions, one per write path that exists today:** `role.assign`,
`report.submit`, `report.verify`, `blood.update`, `upload.sign`. This is
a closed `z.enum`, not a free string — a later slice adding a sixth
write path extends the enum in **its own** Phase 0-equivalent contract
step, in `packages/types/audit.ts`, never inline at the new call site.
That is the one deliberate friction point: a write path with no audit
action is a write path this repository can no longer see happen.

**`detail` is scalars only, one level deep, capped at
`AUDIT_DETAIL_MAX_KEYS` (12) keys (decision C).**
`Record<string, string | number | boolean | null>` — not arbitrary
`jsonb`. An unconstrained audit payload is exactly where PII and secrets
accumulate: someone dumps a whole request body "for debugging" into an
append-only, admin-readable table, and it never leaves. The schema makes
that awkward enough to get caught in review rather than silently
shipping — a caller with genuinely nested context flattens it into
dotted keys (`previousRole`, `newRole`, not `{ role: { previous, new } }`).

**`role_assignments` is not folded into `audit_log` (decision D).**
`docs/features/rbac.md`'s audit-trail section has the detail; the short
version is that `role_assignments` has typed columns and two check
constraints a generic `detail jsonb` blob can't express, and the two
tables coexist rather than trading one set of guarantees for the other.

**Every write path in this slice now emits at least one entry:**
`role.assign` (already existed as `role_assignments`; now also
`audit_log`, wired in `apps/api/src/routes/admin-users.ts`),
`report.submit` and `report.verify` (`apps/api/src/routes/reports.ts` —
`report.submit` records `outcome: 'failure'` on the spam-rejection
path too, since a rejected-but-logged submission is exactly what an
audit trail is for), `blood.update` (`apps/api/src/routes/resources.ts`),
and `upload.sign` (`apps/api/src/routes/uploads.ts`, on a successful
mint). Every entry carries the request's `requestId`
(`c.get('requestId')`), so an audit row and the server log lines for the
same call correlate directly. Consistent with the existing
`role_assignments` write, an audit-write failure is logged loudly and
never fails the request — by the time the write would happen, the
underlying action has already taken effect, and a `503` for a change
that did in fact happen is a worse outcome than a gap in the trail.

**Read access:** `audit_log` has exactly one RLS policy — `select`,
gated on `public.has_capability('roles:manage')`. No insert, update, or
delete policy exists, and none is intended (the migration's own comment
says why): an audit row that can be edited by anyone through PostgREST
is not an audit row. `apps/api` writes it with the service-role key,
which bypasses RLS by design; corrections are appended, never applied in
place. `packages/db/test/audit-log-rls.test.ts` verifies this against a
real local Postgres instance rather than trusting the absence of a
policy — see its own header comment for how it drives `anon`/
`authenticated` sessions without a running PostgREST/GoTrue round trip.

### Form primitives

Four small, `apps/web/src/components/`-local building blocks (decision
E — `packages/ui` stays the untouched placeholder it already was;
promoting a package for one consumer is cost with no return here):

- **`Spinner`** — `role="status"`, a visually-hidden label, and a
  `prefers-reduced-motion: reduce` branch that stops the animation
  rather than removing the element from the DOM.
- **`SubmitButton`** — `{ pending, disabled?, pendingLabel?, children }`,
  rendering `<button type="submit" disabled={pending || disabled}
  aria-busy={pending}>` with the spinner beside the label while pending.
- **`PasswordInput`** — a `password ⇄ text` toggle button carrying
  `aria-pressed` and an `aria-label` that flips between "Show password"
  and "Hide password"; focus stays on the input across the toggle;
  `autoComplete` passes straight through (`current-password` on sign-in,
  `new-password` on sign-up).
- **The disabled-fieldset convention.** "Every input disabled while a
  form submits" is implemented as a single native
  `<fieldset disabled={pending}>` wrapping the form's fields, not as
  `disabled` threaded through each input by hand — one attribute that
  structurally cannot miss a field a future edit adds inside the
  fieldset.

These four retrofit the six pre-existing hand-rolled sites this slice
found by grep and nowhere else: the submit buttons in `SignInForm.tsx`,
`SignUpForm.tsx`, `SymptomCheckerForm.tsx`, and `Report.tsx`, and the
password fields in `SignInForm.tsx` and `SignUpForm.tsx`.

### `useGeolocation`, for real

`apps/web/src/hooks/useGeolocation.ts` was a one-line stub
(`export const useGeolocation = () => {};`) that `useReportLocation.ts`
called for a return-less side effect while reimplementing
`getCurrentPosition` itself, with a comment explaining the duplication.
It now returns `{ lat, lng, status, request }`, where `status` is
`'idle' | 'requesting' | 'granted' | 'denied' | 'unavailable'`, and
`useReportLocation.ts` is built on it directly — the duplicated
`getCurrentPosition` block and the stale "frozen-shape stub" comment are
both gone. Every access into `position`/`error` from the browser's
Geolocation API is optional-chained (R7 — permission can be denied or
the API can be entirely absent). `Report.tsx`'s "Use my location" button
and its lat/lng inputs are driven off `status === 'requesting'`: a
spinner in the button, the inputs disabled, and a `role="status"` live
region announcing the change — with the manual-entry fallback always
re-enabled the moment the request settles, granted or denied, so a
denied permission never leaves the form unusable.

### Signed direct-to-Cloudinary uploads (ADR-015)

The sequence, end to end:

1. The browser calls `POST /api/uploads/signature` with
   `{ purpose: 'avatar' | 'report-photo' }` (`uploadSignatureRequestSchema`,
   `packages/types/uploads.ts`) and its access token. Chain: `auth()`
   (any signed-in role — every role may upload; the control here is the
   rate limit, not a capability), then `rateLimit({ guard:
   'upload-signature', keyStrategy: 'user', limit:
   UPLOAD_SIGNATURE_RATE_LIMIT.perMinute })` (10/min per user, §14).
2. **The server derives the folder from `purpose`, never from client
   input (decision H).** `avash/avatars/<userId>` or `avash/reports`,
   plus a server-generated `public_id`. A client-supplied folder string
   is a write-anywhere primitive against the project's own asset store —
   the purpose enum is the only client input that ever reaches folder
   selection.
3. `apps/api/src/lib/cloudinarySignature.ts`'s `signUpload()` builds the
   signature over exactly the parameter set ADR-015 records as verified
   against Cloudinary's own documentation (`allowed_formats`, `folder`,
   `public_id`, `timestamp` — alphabetical, `crypto.subtle.digest('SHA-1', …)`,
   Web Crypto so the same code signs identically in workerd and Node 20),
   valid for `UPLOAD_SIGNATURE_TTL_S` (600s, §14).
4. The response (`uploadSignatureResponseSchema`) carries everything the
   browser needs to talk to Cloudinary directly: `uploadUrl`, `cloudName`,
   `apiKey`, `timestamp`, `signature`, `folder`, `publicId`,
   `allowedFormats`, `maxBytes`. **This is the only place `apps/web`
   learns the Cloudinary cloud name** — never from a `VITE_PUBLIC_*` env
   var (R2; `docs/security/secrets-matrix.md`).
5. `apps/web/src/features/uploads/useSignedUpload.ts` pre-checks the file
   against `UPLOAD_MAX_BYTES` (5 MiB) and `UPLOAD_ALLOWED_FORMATS`
   client-side (so the common rejection doesn't cost a round trip), then
   `POST`s a `FormData` straight to Cloudinary's `uploadUrl` — the file's
   bytes never pass through `apps/api`.
6. **What the server does not see:** the file content. It cannot inspect,
   scan, or resize what it never receives. What it *can* still enforce
   through the signature it controls: which folder the upload can land
   in, which formats are accepted, and how long the signature is valid —
   plus the per-user rate limit bounding how many signatures one account
   can mint. ADR-015 has the full trade-off and the rejected
   Worker-proxy alternative.

This hook and this route both ship with **no caller** in this slice —
intended; the avatar-upload and report-photo-upload slices are the
consumers, and both halves of the contract exist so those slices add a
call site, not a primitive.

## Critical Constants

| Constant | Value | Defined in | Purpose |
|---|---|---|---|
| `LIST_PAGE_SIZE_DEFAULT` | 25 | `packages/types/pagination.ts` | page size when `?pageSize=` is absent |
| `LIST_PAGE_SIZE_MAX` | 100 | `packages/types/pagination.ts` | ceiling on any client-requested page size |
| `LIST_SEARCH_MAX_CHARS` | 120 | `packages/types/pagination.ts` | bounds the `?q=` filter term |
| `ADMIN_USER_PAGE_SIZE` | 50 | `apps/api/src/routes/admin-users.ts` | default page size for the admin user list (decision F) |
| `AUDIT_DETAIL_MAX_KEYS` | 12 | `packages/types/audit.ts` | caps the audit `detail` map (decision C) |
| `UPLOAD_MAX_BYTES` | 5242880 (5 MiB) | `packages/types/uploads.ts` | client-side pre-check + signed constraint |
| `UPLOAD_SIGNATURE_TTL_S` | 600 | `apps/api/src/lib/cloudinarySignature.ts` | how long a returned signature stays valid |
| `UPLOAD_SIGNATURE_RATE_LIMIT` | 10/min per user | `packages/security/rateLimit.ts` | bounds signature minting per account |

## Security Considerations

STRIDE, mirrored into `docs/security/threat-model.md`:

- *Spoofing:* a client claiming a Cloudinary folder or public ID that
  isn't theirs. Both are server-derived from the authenticated caller's
  `purpose` and user id, never accepted from the request body (decision
  H).
- *Tampering:* a forged `sort` value reaching a database `ORDER BY`.
  Closed per-route enum at the zod boundary (decision B) — an unknown
  sort key is a generic `400`, and the handler never sees it.
- *Repudiation:* a write happening with no record of who did it. Every
  write path in this slice now emits an `audit_log` entry carrying the
  actor, the outcome, and the request id that correlates to the server
  logs for the same call.
- *Information disclosure:* the audit trail itself becoming a PII sink,
  or the Cloudinary signature over-authorizing an upload. Mitigated by
  the scalar-only, 12-key-capped `detail` schema (decision C) plus the
  admin-only `select` RLS policy on one side, and by the signature
  covering only server-controlled `folder`/`allowed_formats`/`public_id`
  values on the other — a signed request cannot be replayed against a
  different folder or format set than the one it was minted for.
- *Denial of service:* signature-minting abuse (an authenticated user
  filling the project's Cloudinary quota by minting signatures it never
  uses) and audit-log write volume. The former is bounded by
  `UPLOAD_SIGNATURE_RATE_LIMIT`; the latter is bounded by the same
  per-route rate limits already gating every write path that now also
  audits (`docs/security/rate-limiting.md`).
- *Elevation of privilege:* not new here — every write this slice audits
  or paginates already enforces its own capability/role check
  independently of the pagination or audit-log addition; see each
  route's own feature doc (`docs/features/rbac.md`,
  `docs/features/breeding-reports.md`) for that route's actual gate.

## Manual Test Log

Automated coverage: `packages/types/test/pagination.test.ts`,
`packages/types/test/audit.test.ts`, `packages/types/test/uploads.test.ts`
(the frozen contract's own parse/reject cases);
`packages/security/test/auditLog.test.ts` (the writer's pure-function
half); `packages/db/test/audit-log-rls.test.ts` (13 cases — RLS enforced
against a real local Postgres instance for `anon`, `authenticated`
without `roles:manage`, and `authenticated` with `roles:manage`, across
select/insert/update/delete). `apps/api`'s and `apps/web`'s own route,
hook, and component suites are documented in their respective PRs, not
duplicated here.

E2E specs (`apps/api/e2e/uploads.spec.ts`, `apps/api/e2e/admin-users.spec.ts`,
`apps/web/e2e/tables.spec.ts`, `apps/web/e2e/forms.spec.ts`, and the
extension to `apps/web/e2e/accessibility.spec.ts`) are written and
compile-checked (`playwright test --list`) as part of this change, and
run for real once every branch contributing to this feature is merged —
a spec exercising a page or route another branch hasn't landed yet
cannot pass in isolation, by construction, not by oversight.

Three-pass manual protocol (happy/degraded/adversarial, `docs/standards/testing.md`)
against a live `pnpm dev` with the local Supabase stack: not yet run as
of this writing — it depends on the API and web implementations landing
first. Reviewer sign-off pending.
