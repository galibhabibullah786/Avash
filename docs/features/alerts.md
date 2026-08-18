# Alerts & Announcements

Follows the mandatory template from `docs/PROJECT_PLAN.md` §12.

**Gist:** Two independent write paths sit under `/api/alerts` and
`/api/announcements`. A resident can subscribe to a location so they can
later be matched for a proximity alert, and register a browser push
endpoint to receive it. A moderator or admin can broadcast a short
notice to everyone (or a subset of roles) near a point, for a limited
time. `/api/admin/audit-log` gives admins a read surface over every
audited write in the system, including the ones this feature adds.

**Technical Detail:**

- **Subscriptions are not announcements.** `alert_subscriptions` records
  a user subscribing to an area (`user_id`, `geom`, `radius_m`,
  `active`). `announcements` records an author broadcasting to one
  (`author_id`, `geom`, `radius_m`, `target_roles`, `expires_at`). They
  are unrelated tables with unrelated RLS: a subscription is
  self-service (`user_id = auth.uid()`), an announcement requires
  `reports:moderate`. Nothing here fans a subscription out against
  announcements, or vice versa — matching them is a separate concern,
  described below.
- `POST /api/alerts/subscribe` — authenticated, rate-limited
  (`ALERT_SUBSCRIBE_RATE_LIMIT`, 5/min/user). Validates
  `alertSubscribeSchema` and upserts `alert_subscriptions` keyed on
  `user_id` alone (`alert_subscriptions_user_id_key`), so this is both
  the create and the update path: posting from a new point MOVES the
  caller's one geofence rather than adding a second. Writes an
  `alert.subscribe` audit entry.

  **One subscription per user, deliberately.** The conflict target was
  originally `(user_id, geom)`, which made the point part of the row's
  identity — moving your geofence matched no existing row and silently
  created another active subscription, and a user accumulated one per
  place they had ever subscribed from with no way to retire any of them.
  `20260818000020_alert_subscriptions_one_per_user.sql` collapses any
  such accumulation to the most recent row before adding the constraint.
- `DELETE /api/alerts/subscribe` — authenticated, same rate limit. Takes
  no body and no id: the row is resolved from the verified JWT's
  `user_id`, because the service-role key bypasses RLS and an id taken
  from the request would let any signed-in caller delete anyone's
  subscription. A hard delete, not `active = false` — a deactivated row
  would still occupy the user's one unique slot and make their next
  subscribe an update of a row they believe they removed. Replies `200`
  with `{ id: null }` when there was nothing to remove rather than
  `404`, so an already-unsubscribed caller retrying is not a failure,
  and writes an `alert.unsubscribe` audit entry either way.
- `POST /api/alerts/push-subscription` — authenticated, same rate limit.
  Validates `pushSubscriptionRegisterSchema` and upserts
  `push_subscriptions` keyed on the table's unique `endpoint` column, so
  registering the same browser subscription twice never hits a
  unique-violation. Writes a `push.subscribe` audit entry.
- `POST /api/announcements` — requires `reports:moderate`, rate-limited
  (`ANNOUNCEMENT_CREATE_RATE_LIMIT`, 10/min/user). Validates
  `announcementCreateSchema`. Before inserting, counts the author's own
  currently-live rows (`expires_at > now()`) and refuses with a generic
  `409` at `ANNOUNCEMENT_MAX_ACTIVE_PER_AUTHOR` (20) — a moderator
  cannot accumulate an unbounded number of standing broadcasts. Writes
  an `announcement.create` audit entry; `targetRoles` is flattened into
  a single `"target.roles": "admin,moderator"` scalar key rather than
  stored as an array, since the audit detail schema is scalars-only and
  caps at 12 keys.
- **`GET /api/announcements` targeting is evaluated at read time, not
  fanned out at write time.** No per-recipient row is ever created for
  an announcement — the trade-off is that there is no "mark as read"
  without a further join table, which is not needed yet. The route is
  authenticated (a role-targeted announcement plus a caller-supplied
  point is not something an anonymous scraper should be able to probe),
  takes the caller's `lat`/`lng`, and returns only rows that are
  simultaneously: not expired (`expires_at > now()`, filtered in the
  query — see the index note below), targeted at the caller's role
  (`target_roles` empty means every role, otherwise the caller's role
  must be a member), and within that announcement's own `radius_m` of
  the caller's point. The distance check runs in the Worker
  (`haversineDistanceMeters()`, `apps/api/src/lib/announcementDto.ts`)
  against the caller's point and each row's `geom`/`radius_m`, rather
  than a `ST_DWithin` RPC — no such function exists for this table (the
  only live spatial-join RPC in this codebase is
  `blood_within_radius()`, and adding a new one is a migration change),
  so role targeting and proximity both apply after the live-rows query
  comes back. Results are paginated with the shared `listQueryFor`/
  `paginatedResponseSchema` contract.
- **`GET /api/announcements?scope=manage` is the moderator/admin view of
  the same table.** It returns exactly the rows the caller is allowed to
  `DELETE` — their own, or every row for an admin, mirroring the delete
  handler's author-or-admin rule — and it takes no point and applies no
  role-targeting or proximity filter, because a management list that
  hides your own announcement the moment you walk out of its radius is
  not a management list. Expired rows are included for the same reason:
  their author is the one person who needs to see that they lapsed. It
  is gated on `reports:moderate` (a `403` otherwise), the same capability
  that authoring one requires, since the scope deliberately exposes rows
  the default `nearby` scope would have withheld. `scope` defaults to
  `nearby`, so the citizen-facing feed is unchanged.
- `DELETE /api/announcements/:id` — authenticated; author-or-admin is a
  handler-level check, not a middleware one, because it requires reading
  the target row first. A missing id is a generic `404`; a caller who is
  neither the author nor an admin is a generic `403`. The audit entry
  this writes (`announcement.delete`) records who deleted which entity
  and when — never the row's `title`, `body`, or geometry. The audit
  detail schema's scalar-only, 12-key cap makes dumping full content
  into an admin-readable append-only table both impossible and
  undesirable for location data.
- `GET /api/admin/audit-log` — requires `roles:manage`. Reads
  `audit_log`, filterable by `?action=` and `?actorId=`, sorted
  `occurred_at desc`. `?pageSize=` clamps to `LIST_PAGE_SIZE_MAX` (100)
  rather than rejecting an over-large request — a caller who asks for
  too much still gets a usable page back.
- **The live-rows index on `announcements` is a plain
  `btree(expires_at desc)`, not a partial one.** An earlier draft of the
  migration tried `where expires_at > now()`; Postgres rejects that
  because `now()` is `STABLE`, not `IMMUTABLE`, and a partial index's
  predicate must be immutable. The route filters `expires_at > now()`
  in the query itself instead, which the plain index still serves as a
  range scan.
- **Delivery is split, deliberately, across two systems.** This Worker
  only ever manages rows — `alert_subscriptions`, `push_subscriptions`,
  `announcements`. It never scores a proximity match and never sends a
  push notification itself. That work lives in `ml/serving/predict.py`,
  the same nightly batch job that already holds `VAPID_PRIVATE_KEY` and
  runs the `ST_DWithin` match between live subscriptions and whatever
  needs delivering, then calls `pywebpush`. A new announcement is
  visible in-app immediately through `GET /api/announcements`, but rides
  the next nightly batch run for push delivery
  (`deliver_pending_announcements`, keyed on the `announcements.pushed_at`
  column so a later run can never re-push the same notice). Nothing
  under `apps/api` runs per-request inference or holds a push-signing
  key — which is also why publishing cannot notify anyone
  synchronously, and why an announcement whose `expires_at` falls before
  the next scheduled run will lapse without ever being pushed. That is a
  real limitation of putting the signing key exclusively in the batch
  job, not an oversight: moving delivery into the Worker would mean
  giving an internet-facing edge runtime the VAPID private key.

**Critical Constants:**

| Constant | Value | Defined in | Purpose |
|---|---|---|---|
| `ANNOUNCEMENT_TITLE_MAX_CHARS` | 120 | `packages/types/alerts.ts` | announcement title cap |
| `ANNOUNCEMENT_BODY_MAX_CHARS` | 1000 | `packages/types/alerts.ts` | announcement body cap |
| `ANNOUNCEMENT_RADIUS_DEFAULT_M` | 5000 (bounds 500–50,000) | `packages/types/alerts.ts`, `announcements` check constraint | default/ceiling for an announcement's targeting radius |
| `ANNOUNCEMENT_MAX_ACTIVE_PER_AUTHOR` | 20 | `packages/types/alerts.ts` | caps how many live announcements one author can hold at once |
| `ALERT_SUBSCRIBE_RATE_LIMIT` | 5/min/user | `packages/security/rateLimit.ts` | covers both `/api/alerts/subscribe` and `/api/alerts/push-subscription` |
| `ANNOUNCEMENT_CREATE_RATE_LIMIT` | 10/min/user | `packages/security/rateLimit.ts` | covers `POST`, `GET`, and `DELETE` on `/api/announcements` |
| the `alert_subscriptions.radius_m` bound | 100–20,000 | migration check constraint, mirrored by `alertSubscribeSchema` | a mismatch here would turn a `400` into a `500` |
| `AUDIT_LOG_PAGE_SIZE_DEFAULT` | 50 | local const, `apps/api/src/routes/audit-log.ts` | default page size for `GET /api/admin/audit-log` |
| `LIST_PAGE_SIZE_MAX` | 100 | `packages/types/pagination.ts` | ceiling every list route's `?pageSize=` clamps or rejects against |

**Security Considerations:**

STRIDE analysis, mirrored into `docs/security/threat-model.md`:

- **Tampering — `DELETE /api/announcements/:id`'s author-or-admin check
  is the actual authorization boundary, not defense-in-depth.**
  `apps/api`'s Supabase client uses the service-role key
  (`createSupabaseAdmin`), which bypasses RLS entirely, so the handler's
  own read-then-compare is the only thing standing between an
  authenticated moderator and another moderator's announcement.
  `apps/api/test/routes/announcements.test.ts` covers a different
  moderator (not the author, not an admin) attempting the delete and
  asserts `403`.
- **Information disclosure — `GET /api/announcements` is authenticated,
  not public**, specifically because it takes a caller-supplied point
  and returns role-targeted content; an anonymous, unauthenticated
  scraper should not be able to enumerate what operational messaging
  exists for `admin`-only audiences at a given location.
- **Information disclosure — `announcement.delete`'s audit entry never
  carries the deleted row's `title`/`body`/geometry.** The scalar-only,
  12-key-capped audit detail schema makes this the easy default rather
  than something that has to be remembered at each call site.
  `apps/api/test/routes/announcements.test.ts` asserts the written
  `detail` has no `body` field.
- **Denial of service — the announcement create cap.**
  `ANNOUNCEMENT_MAX_ACTIVE_PER_AUTHOR` stops one compromised or careless
  moderator account from filling every caller's feed with an unbounded
  number of simultaneously-live broadcasts.
- **Spoofing — every write path's identity comes from the verified
  Supabase JWT** (`auth()` middleware), never a client-supplied `userId`
  or `authorId` field in the request body.
- **Tampering — `alert_subscriptions`/`push_subscriptions` upserts are
  scoped to the authenticated caller's own `user_id`**, taken from the
  verified token, never from the request body.
- **Coverage — `apps/api/test/audit-coverage.test.ts`** statically
  scans every route file for a mutating handler (`.post`/`.patch`/
  `.put`/`.delete`) and asserts the file also references
  `writeAuditEntry` or `recordAudit`, with an explicit, commented
  allow-list for the one genuine exception (`symptom-check.ts`, which
  writes no state). A future write path added without an audit call
  fails this test by name, not silently.

**Manual Test Log:**

2026-08-18, initial implementation pass. Full workerd Vitest suite
(`apps/api/test/routes/alerts.test.ts`, `announcements.test.ts`,
`audit-log.test.ts`, plus `audit-coverage.test.ts`) exercises every
branch reachable without a hosted Supabase project, including the
author-or-admin delete boundary, the active-announcement cap, the
role/proximity filtering on the list route, and the audit-detail
shape on every write. Reviewer sign-off pending.

2026-08-18, subscription-lifecycle and announcements-page pass, run
against the hosted Supabase project with a real browser (Chrome, real
sessions, real geolocation):

- A stored subscription is read back on a cold page load and rendered
  with its own point and radius, and the radius input opens seeded to
  the stored value.
- Submitting from a different point left the row count at 1 and moved
  the stored `geom`/`radius_m` — confirming the conflict-target change,
  which under the old `(user_id, geom)` target produced a second row.
- Unsubscribe removed the row, showed its confirmation, and reverted the
  form to its create state; re-subscribing afterwards succeeded, so no
  orphaned row blocks the unique slot.
- `/announcements` renders nothing for a citizen and the compose form is
  absent from the dashboard for every role (it moved to that page).
- As an admin: the announcements tile appears, the manage list returns
  every author's rows without a point, publishing adds a row to the list
  without a manual reload, and delete confirms first, then removes it
  from both the list and the table.
- The compose form's future-expiry check was exercised for real: a
  UTC-derived `datetime-local` value landed in the past for this
  machine's `+06:00` offset and was correctly rejected with its own
  message rather than being sent and failing the DB's
  `expires_at > created_at` constraint.
