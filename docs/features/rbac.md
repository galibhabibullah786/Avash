# Roles & Access Control

Follows the mandatory template from `docs/PROJECT_PLAN.md` §12.

**Gist:** four application roles — `citizen`, `hospital_staff`,
`moderator`, `admin` — with a real, auditable, in-app mechanism for
assigning them, a capability model that all three enforcement layers
share, and a per-role dashboard. Before this slice `AppRole` was
`'moderator' | 'admin'`, an ordinary signed-in user had no role at all,
and the only way to grant one was editing `app_metadata` by hand in the
Supabase dashboard — not delegable, not auditable, and not testable.

Read alongside `docs/features/authentication.md`, which owns sign-in,
session handling, and route guarding. This document owns *what a signed-in
person is allowed to do*.

## Technical Detail

### The role lives in the JWT, not in a table

The source of truth is `app_metadata.role` on the Supabase auth user
(`APP_ROLE_CLAIM_PATH`, §14) — the same claim path the previous two-role
mechanism used, for the same reason: **`app_metadata` is server-writable
only.** A signed-in user *can* write `user_metadata`; nothing in this
system ever reads it for authorization, and
`packages/security/test/roles.test.ts` asserts that a `user_metadata.role`
of `admin` alongside an `app_metadata.role` of `citizen` resolves to
`citizen`.

Because the claim is signed into the token, all three layers read it with
no extra round trip: `public.app_role()` in RLS, the `auth` middleware in
`apps/api`, and `useSession()` in `apps/web`.

**Consequence, surfaced in the admin UI:** a role change takes effect on
the subject's *next* token issue. An already-signed-in user keeps their
old role until their session refreshes or they sign in again.

### Roles are capabilities, not a rank

`packages/security/roles.ts` holds the single grant table:

| Capability | citizen | hospital_staff | moderator | admin |
|---|:-:|:-:|:-:|:-:|
| `reports:moderate` | | | ✓ | ✓ |
| `news:moderate` | | | ✓ | ✓ |
| `inventory:write` | | ✓ | | ✓ |
| `hospitals:manage` | | | | ✓ |
| `roles:manage` | | | | ✓ |

Deliberately **not** a numeric level comparison. A moderator is not "a
hospital_staff plus more" — the two are disjoint, and a rank check would
silently hand every moderator the ability to restate a hospital's blood
stock. `admin` is a superset only because it is explicitly granted every
row, never because it sorts highest.

`can(role, capability)` is the only authorization predicate. A
`null`/`undefined`/unrecognized role fails closed. `isModerator()` is kept
as a named alias for `can(role, 'reports:moderate')` because three call
sites read as "is this person on the moderation side".

`public.has_capability(text)` in
`packages/db/supabase/migrations/20260816000013_rbac_roles_and_audit.sql`
is the SQL mirror of that same table, and every capability-shaped RLS
policy now calls it instead of listing role names inline. **These two
tables are kept in lockstep by hand** — that is the one real maintenance
cost of this design, and it is accepted because the alternative (role
names spread across a dozen policies) is what left the original
`auth.role()` policies silently dead (§4.1 amendment).

### `citizen` is a value, not an absence

`readAppRole()` still returns `AppRole | null`, where `null` means "no
valid role claim present". `resolveAppRole()` is the new function that
turns that into `citizen` — and it is only ever called on an *already
verified* principal:

- `apps/api/src/middleware/auth.ts` calls it after `jwtVerify` succeeds.
- `SessionProvider` calls it inside the authenticated branch only.
- `public.app_role()` returns `null` when `auth.uid()` is null, and
  `citizen` otherwise.

Keeping the two apart is load-bearing: collapsing them would hand every
anonymous request citizen's capability set. That set is currently empty,
so nothing would break today — which is precisely why it needs a test
rather than a comment, and it has one at all three layers.

### Assigning a role

`PATCH /api/admin/users/:id/role`, `auth({ capability: 'roles:manage' })`
+ 10/min/user. It is in `apps/api` and not the browser because writing
`app_metadata` needs the Supabase Admin API, which needs the service-role
key, which must never reach `apps/web` (R2).

- Reads the current role first, so the audit row records what was actually
  replaced rather than what the caller assumed.
- **Merges** `app_metadata` rather than replacing it — Supabase keeps its
  own `provider`/`providers` keys there, and a whole-object write drops
  them. Asserted directly on the outgoing request body in
  `apps/api/test/routes/admin-users.test.ts`.
- **Refuses self-demotion with 409.** An admin removing their own
  `roles:manage` can leave a project with zero admins and no in-app way
  back. Refused rather than warned, because by the time a warning is
  useful the capability is already gone. Re-asserting your own `admin`
  role is allowed through.
- The audit write is best-effort and does **not** fail the request: by
  that point the grant has already taken effect in the claim, so a 503
  would report a false negative for a change that did happen. Logged at
  `error` instead.

`GET /api/admin/users` pages the user list at 50
(`ADMIN_USER_PAGE_SIZE`, §14). A user row the Admin API returns in an
unexpected shape is dropped, never rendered half-parsed into an
authorization UI.

### The audit trail

`role_assignments` (append-only): `user_id`, `previous_role`, `new_role`,
`assigned_by`, `reason`, `created_at`. RLS allows `select` to
`roles:manage` holders and **nothing else** — no update policy, no delete
policy, and none intended. `assigned_by` is `on delete set null`, so the
audit row survives the granting admin's account being deleted.

It never gates a request. `app_metadata.role` remains the sole
authorization source; this table answers "who did this, when, and why",
which a claim overwritten in place cannot.

### `audit_log`, and why it doesn't absorb `role_assignments`

A second, more general append-only trail — `packages/db/supabase/migrations/20260817000015_audit_log.sql`
— now exists alongside `role_assignments`, covering every write path that
exists today (`role.assign`, `report.submit`, `report.verify`,
`blood.update`, `upload.sign`; full contract in
`docs/features/platform-primitives.md`). The role grant now writes
**both**: `role_assignments` as before, and an `audit_log` row with
`action: 'role.assign'`, `entityType: 'user'`, and `detail: {
previousRole, newRole }`.

The two tables deliberately stay separate rather than folding
`role_assignments` into `audit_log`'s `detail jsonb`. `role_assignments`
has two real check constraints (`new_role`/`previous_role` must be a
known role) and typed `user_id`/`assigned_by` foreign keys — generalizing
it into a scalar-only `jsonb` map would trade those constraints for
uniformity with every other write path, for no consumer that needs it. A
query wanting "everything that happened, across both" is a union of two
tables; nothing in this slice needs that query, so it's an accepted
cost, not a closed one. Same RLS shape on both: one `select` policy
gated on `roles:manage`, no insert/update/delete policy, service role
bypasses to write.

### Bootstrapping the first admin

Granting `admin` requires `roles:manage`, which only an admin holds — so a
fresh project cannot make its first admin through the app. `pnpm
role:grant` (`scripts/grant-role.ts`) is that escape hatch, and the
recovery path if every admin is locked out:

```bash
pnpm role:list                                              # who exists, and their role
pnpm role:grant -- --email you@example.com --role admin
pnpm role:grant -- --user-id <uuid> --role moderator --reason "on-call rota"
```

It uses the service-role key from the repo-root `.env`, writes the same
claim and the same audit row the route does, and records `assigned_by =
null` — which is exactly what "granted out of band" should look like in
the trail.

### Per-role dashboards

`/dashboard` is one page whose tiles come from `ROLE_DASHBOARDS`
(`apps/web/src/features/dashboard/roleDashboards.ts`), not four page
components — the difference between the dashboards is *which destinations
are offered*, so it is a table, and adding a role is a table entry.

Every tile is navigation, never authorization. A hidden tile (and a hidden
nav link in `Header.tsx`) is a UX affordance only; the destination
enforces its own access via `ProtectedRoute` client-side and, for real,
via the Worker's `auth` middleware and RLS.

`ProtectedRoute` now takes `capability` as well as `role`. Prefer
`capability` — it survives adding a role that should also reach the page.

## Critical Constants

| Constant | Value | Defined in | Purpose |
|---|---|---|---|
| `AppRole` | `citizen \| hospital_staff \| moderator \| admin` | `packages/types/api.ts` | the four roles all three layers recognize |
| `DEFAULT_APP_ROLE` | `citizen` | `packages/types/api.ts` | what a verified token with no role claim resolves to |
| `APP_ROLE_CLAIM_PATH` | `app_metadata.role` | `packages/security/roles.ts` | where the role lives in a Supabase JWT |
| `ROLE_CAPABILITIES` | the table above | `packages/security/roles.ts` | the single grant table; mirrored by `public.has_capability()` |
| `ROLE_ASSIGNMENT_RATE_LIMIT` | 10/min per user | `packages/security/rateLimit.ts` | role admin is a rare deliberate action; a burst is a mistake or a compromised session |
| `ADMIN_USER_PAGE_SIZE` | 50 | `apps/api/src/routes/admin-users.ts` | bounds one page of the admin user list |

## Security Considerations

STRIDE, mirrored into `docs/security/threat-model.md`:

- *Spoofing:* forging a role claim. The token is HS256-verified against
  `SUPABASE_JWT_SECRET` before any claim is read (ADR-009); an unsigned or
  wrongly-signed token 401s before `resolveAppRole` runs at all.
- *Tampering:* a signed-in user writing `user_metadata.role`. Supabase
  permits that write; nothing here reads it. Tested at both the
  `packages/security` and `apps/web` layers.
- *Repudiation:* an admin denying a grant they made. Mitigated by
  `role_assignments` — append-only, admin-readable, no update or delete
  policy. Partially mitigated only: an actor with the service-role key
  bypasses RLS and could insert a misleading row. That key is the trust
  root for the whole system, so this is accepted, not solved here.
- *Information disclosure:* the admin user list exposes every registered
  email. Gated on `roles:manage`, rate-limited, and never reachable
  without a verified admin token. 401 and 403 bodies are byte-identical
  apart from status (R10), asserted by test.
- *Elevation of privilege:* the main one. Three independent layers —
  Worker middleware, RLS, and the UI guard — and the UI is explicitly not
  one of the two that matter. `blood_inventory` writes additionally
  require a `verified_hospital_staff` row for that specific hospital, so
  `inventory:write` is necessary but not sufficient; an admin satisfies
  the capability and is still refused without a membership row, which is
  intentional (administering the system ≠ being authorized to state a
  hospital's stock).
- *Denial of service:* mass role churn. 10/min/user, fail-closed.

**Open item — no automatic session invalidation on role change.** Revoking
a role does not revoke the subject's current token; they keep the old role
until it expires (`jwt_expiry`, 1h locally). For *revocation* this is a
real window. Not closed in this slice: doing it properly means calling
`auth.admin.signOut(userId)` on demotion, which needs a decision about
whether an admin can forcibly sign someone out. Flagged, not resolved.

## Two defects that made this appear entirely broken (2026-08-16)

Both features shipped, both were tested, and both failed the moment a real
user touched them. Neither was a logic error in the feature itself.

**1. Every real token was rejected (401 on every authenticated route).**
`jwtVerify` accepted `HS256` against `SUPABASE_JWT_SECRET`. The hosted
project signs with **ES256** from a published JWKS — confirmed by minting
a token for a throwaway account and decoding its header, not assumed. So
`GET /api/admin/users`, `PATCH /api/admin/users/:id/role`, and the
moderator verify/reject `PATCH` all 401'd, which the UI renders as its
generic "unable to load". Fixed by selecting the verification path from
the token's `alg` header; see the ADR-009 amendment, including why this is
not an algorithm-confusion vulnerability.

*Why the tests missed it:* the fixtures sign their own HS256 tokens, so
they exercised the code faithfully and passed. Nothing asserted anything
about the algorithm the real identity provider actually uses. A green
suite against a self-signed fixture says nothing about a third party.

**2. The moderation queue had no table privilege.** `usePendingReports`
reads `breeding_reports` straight from Supabase (decision F), and
`anon`/`authenticated` had never been granted `SELECT` on it — this
project's default privileges only auto-grant TRUNCATE/REFERENCES/TRIGGER,
and `20260215000010` fixed that for `service_role` only. Postgres checks
GRANT before RLS, so PostgREST answered 42501 and the carefully-written
policies were never reached. Fixed by
`20260816000014_client_read_grants.sql`, which grants `SELECT` to exactly
the two tables the browser reads and nothing else.

Verified after the fix, against the live project: an admin sees the
pending report; a **signed-in citizen gets HTTP 200 with zero rows** (RLS
filtering, not erroring); an anonymous caller is refused at the grant
layer; and the public blood-inventory ticker still reads fine.

## Manual Test Log

2026-08-16. Automated: `packages/security/test/roles.test.ts` (17 cases —
the grant table, claim reading, the `user_metadata` rejection, fail-closed
on unknown roles, and a guard that every enum member has a capability
list); `apps/api/test/middleware/auth.test.ts` (capability gating,
citizen default, moderator/hospital_staff disjointness);
`apps/api/test/routes/admin-users.test.ts` (17 cases — 401/403 by role,
the self-demotion 409, `app_metadata` merge asserted on the outgoing
body, audit-write-fails-but-grant-stands, dropped malformed rows);
`apps/web/src/features/auth/useSession.test.ts` and
`apps/web/src/features/dashboard/roleDashboards.test.ts`. The SQL layer
(`public.app_role()` / `public.has_capability()`) was verified directly
against the running local Postgres container for all three cases —
moderator claim, authenticated-with-no-claim → `citizen`, anonymous →
`null` with no capability.

The three-pass manual protocol against a live Supabase project with real
sign-ins is **not** yet run — see `docs/docker.md` § Local Supabase stack
for the intended path (ADR-014 exists to make it possible). Called out
here rather than assumed done. Reviewer sign-off pending.
