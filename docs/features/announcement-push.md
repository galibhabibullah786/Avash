# Announcement Push

Follows the mandatory template from `docs/PROJECT_PLAN.md` §12.

**Gist:** A published `announcements` row is now pushed to matching
subscribers within seconds, not on the next `cron-batch-predict` run.
`apps/notify` (ADR-016) — a Supabase Database Webhook plus a scheduled
sweep, both built on `packages/push` — replaced
`ml/serving/push_delivery.py`'s `deliver_pending_announcements()` for
this one job. Region-crossing risk alerts are unaffected: they still ride
the nightly batch job and are still Python — see
`docs/features/push-notifications.md`. This document covers announcement
delivery only.

**Technical Detail:**

- **Two triggers, on purpose.** A Supabase Database Webhook
  (`AFTER INSERT ON announcements`, received by
  `apps/notify/api/announcement-published.ts`) fires an
  `announcement/published` Inngest event the moment a row is inserted —
  this is the fast path, seconds not hours. But a webhook delivery is not
  guaranteed: the webhook call itself can fail, time out, or never fire if
  Supabase's outbound delivery has a bad moment, and nothing retries it
  from the database side. `apps/notify/src/inngest/sweepUndelivered.ts`
  is the safety net — a cron at `ANNOUNCEMENT_PUSH_SWEEP_CADENCE` (every 5
  minutes, `docs/constants-registry.md` §14) that re-reads
  `announcements` directly for any live row still undelivered (`pushed_at
  is null`, claim absent or expired — see the lease semantics below) and
  fans out the same event the webhook would have. The sweep re-derives
  truth from the table rather than trusting that the webhook fired, so a
  dropped webhook call costs at most one sweep interval of latency, not a
  silently-undelivered announcement. Both triggers call the same
  `apps/notify/src/inngest/deliverAnnouncement.ts` handler, which contains
  no delivery logic of its own — it calls `packages/push`'s
  `deliverAnnouncement()` — so "two triggers" never means two
  implementations of delivery to keep in sync.
- **Claim-with-lease, and why `pushed_at` alone was not enough.** With two
  triggers that can both observe `pushed_at is null` for the same row at
  once, a "delivered" flag stamped only after sending is not a safe
  "in-progress" marker — both triggers can pass that check simultaneously
  and both fan out, double-delivering every subscriber.
  `20260819000022_announcement_push_lease.sql` adds `push_claimed_at`, a
  claim taken with an atomic conditional update *before* sending: only a
  caller whose update actually returns a row owns that delivery attempt;
  a caller that gets no row back knows someone already claimed it and
  stops. If a claim is taken and the process then crashes before sending
  or before stamping `pushed_at`, the claim goes stale — the sweep
  reclaims any row whose `push_claimed_at` is older than
  `ANNOUNCEMENT_PUSH_LEASE_SECONDS` (300s, `packages/types/alerts.ts`)
  and re-attempts it. `pushed_at` itself keeps meaning exactly what it
  meant before this slice: stamped only after a send completes, so a
  later run does not re-scan a genuinely delivered row.
  **This makes delivery at-least-once, not exactly-once** — a crash
  between a successful send and the `pushed_at` stamp, or a lease
  reclaimed just as the original claim holder was about to finish, can
  both send the same announcement twice to the same subscriber. Nothing
  in this design tries to make that impossible; it is bounded and
  tolerated instead. What makes a duplicate delivery harmless is on the
  browser: `announcementPushPayloadSchema` (`packages/types/alerts.ts`)
  carries `announcementId`, and the intent is for the service worker to
  use it as the notification's `tag` (the way
  `apps/web/src/sw.js` already tags every risk-crossing push
  `'avash-risk-alert'` so repeats collapse instead of stacking — see
  `docs/features/push-notifications.md`). A second `showNotification()`
  call with the same `tag` replaces the first rather than adding a
  second banner, so a subscriber who receives the same announcement twice
  sees one notification, not two. (Wiring `announcementId` through as
  that tag is `apps/web/src/sw.js` work, out of this slice's owned
  paths — noted here so the at-least-once guarantee above is not read as
  "the user might see duplicates.")
- **`announcement_push_targets` and the bug it closes.** The old
  `ml/serving/push_delivery.py` matcher (`find_matching_push_targets()`)
  never applied `announcements.target_roles` — every announcement, even
  one authored with `targetRoles: ['moderator']`, was pushed with full
  title and body to every citizen within radius, because a
  `push_subscriptions` row carries only a `user_id` and that job never
  joined it against a role. That is a real information-disclosure bug:
  operational messaging meant for one role reached everyone in range.
  `20260819000023_announcement_push_targets.sql` closes it with one
  `security definer` SQL function, `announcement_push_targets(p_announcement_id)`,
  that joins `announcements` to `alert_subscriptions` (`st_dwithin` on the
  announcement's own radius, clamped to 50,000m exactly as the old Python
  ceiling was) to `auth.users` (reading `raw_app_meta_data ->> 'role'`) to
  `push_subscriptions`, filtering on `target_roles` in the same query —
  empty `target_roles` means every role, non-empty means only those
  roles, matching `announcementVisibleTo()` in
  `apps/api/src/lib/announcementDto.ts` so the push and the in-app feed
  can never disagree about who an announcement is for. `security
  definer` (not `security invoker`, unlike `blood_within_radius()`) is
  required here specifically because role targeting needs
  `auth.users.raw_app_meta_data`, which `authenticated`/`anon` cannot
  read directly; the function is granted to `service_role` only and is
  never reachable from the browser. Because the role filter now lives
  inside the RPC, the caller (`packages/push`) cannot forget to apply it
  the way the old Python path effectively did.
- **Platform support is inherited from the Web Push standard, not
  improved by this slice.** Stated plainly rather than left implicit:
  - Works: Chrome and Edge, desktop and Android; Firefox, desktop and
    Android; Safari on macOS 16.1+.
  - Works only under a real constraint: iOS and iPadOS 16.4+ support Web
    Push **only** inside a Home Screen–installed PWA — Mobile Safari in
    an ordinary browser tab cannot receive a push at all, regardless of
    permission state.
  - Does not work: Chromium-family incognito/private browsing refuses the
    Push API outright (the same restriction
    `docs/features/push-notifications.md`'s manual test log already hit
    and worked around by testing in a persistent profile).
  This is a platform limitation, not a bug in `apps/notify` or
  `packages/push`, and fixing it (e.g. shipping the install prompt flow
  needed for the iOS case) is not this slice's job — only documenting it
  plainly is.
- **The Database Webhook is a MIGRATION, not a dashboard setting.**
  `20260819000024_announcement_published_webhook.sql` declares the
  `after insert on announcements` trigger and the `security definer`
  function behind it, which reads the apps/notify origin and the shared
  secret from `vault.decrypted_secrets` and calls `net.http_post`
  (`pg_net`). This was a real outage, not a precaution: every other part
  of this path shipped while the trigger itself existed only as a
  dashboard step nobody had performed, so `announcements` carried zero
  triggers and publishing from the UI pushed nothing — delivery happened
  only when someone invoked it by hand. Declaring it as a migration makes
  the fast path exist wherever the migrations run, including a fresh
  `pnpm docker:supabase` stack.

  Two Vault secrets must be seeded per environment before the fast path
  works; the trigger logs a warning and defers to the sweep when either
  is absent, rather than failing the moderator's insert:

  ```sql
  select vault.create_secret('https://<notify-host>', 'notify_origin');
  select vault.create_secret('<ANNOUNCEMENT_WEBHOOK_SECRET>', 'announcement_webhook_secret');
  ```

  The secret is read at call time rather than baked into the trigger
  definition — Supabase's own webhook UI writes the target URL and auth
  header as literal trigger arguments, where the secret is readable from
  `pg_trigger` by anyone who can read the catalogs.
- **Data flow, end to end:** `POST /api/announcements` inserts a row
  (unchanged, `apps/api`, see `docs/features/alerts.md`) → the trigger
  above fires the Database Webhook → `apps/notify/api/announcement-published.ts`
  constant-time-compares a shared-secret header, validates the body with
  `announcementWebhookBodySchema`, and trusts only `record.id` from the
  payload — everything else about the announcement is re-read from the
  database rather than taken from the webhook body, so a forged or stale
  webhook payload cannot smuggle in a fake title/body/radius → it emits
  `announcement/published` → `apps/notify/src/inngest/deliverAnnouncement.ts`
  claims the row, calls `packages/push`'s `deliverAnnouncement()`, which
  calls the `announcement_push_targets` RPC, sends each target via
  `packages/push/webPush.ts` (RFC 8291 `aes128gcm` payload encryption +
  RFC 8292 VAPID signing on WebCrypto only — portable to the Vercel/Deno
  runtime `apps/notify` actually runs on, per ADR-016 decision B), deletes
  any subscription that comes back `410`, and stamps `pushed_at`. The
  scheduled sweep is the same handler invoked on a timer instead of a
  webhook, for rows the fast path missed.
- **Talks to Supabase directly, same rule as ADR-007.** `apps/notify`
  authenticates with `SUPABASE_SERVICE_ROLE_KEY` and never calls
  `apps/api` — the third home for that key, after GitHub Actions and the
  Cloudflare Worker (`docs/security/secrets-matrix.md`).

**Critical Constants:**

| Constant | Value | Defined in | Purpose |
|---|---|---|---|
| `ANNOUNCEMENT_PUSH_LEASE_SECONDS` | 300 | `packages/types/alerts.ts` | how long a delivery claim (`push_claimed_at`) is held before the sweep may reclaim it |
| `ANNOUNCEMENT_PUSH_SWEEP_CADENCE` | every 5 min | `apps/notify` Inngest cron | safety-net scan cadence for undelivered announcements |
| `ANNOUNCEMENT_PUSH_CONCURRENCY` | 10 | `packages/push` | simultaneous in-flight sends per delivery run |
| `ANNOUNCEMENT_PUSH_RUN_CONCURRENCY` | 5 | `packages/types/alerts.ts` | simultaneous Inngest function RUNS — a different quantity from the row above, capped by the Inngest plan rather than by delivery tuning |
| `INNGEST_PLAN_CONCURRENCY_LIMIT` | 5 | `packages/types/alerts.ts` | the Inngest account's concurrent-run ceiling; a function declaring more makes Inngest reject the entire app registration |
| `ANNOUNCEMENT_PUSH_BATCH_SIZE` | 100 | `packages/push` | targets per Inngest step, keeping each invocation inside the function time limit |
| `ANNOUNCEMENT_PUSH_MAX_PER_USER_PER_HOUR` | 6 | `packages/push` | anti-spam ceiling per subscriber, applied per-user, not as a global cadence |
| the announcement radius ceiling | 50,000 m | `announcement_push_targets` RPC (`least(a.radius_m, 50000)`), mirroring `announcements.radius_m`'s check constraint | defense in depth against a stored value outside the constraint's bounds |

**Security Considerations:**

STRIDE analysis, intended for `docs/security/threat-model.md`:

- *Information disclosure (closed by this slice):* the old Python
  matcher's failure to apply `target_roles` — a role-targeted
  announcement's full title/body reached every citizen in radius, not
  just the target role. Closed by moving the role join into
  `announcement_push_targets`, a `security definer` function granted to
  `service_role` only.
- *Spoofing:* an unauthenticated actor `POST`ing directly to
  `apps/notify`'s webhook endpoint to trigger arbitrary delivery attempts
  or probe timing. Mitigated by a constant-time comparison of a
  shared-secret header before the body is even parsed, and by the handler
  trusting only `record.id` from the payload — every other field is
  re-read from the database under the service-role key, so a forged
  payload cannot inject a fake title, body, radius, or target list.
- *Secret exposure:* `SUPABASE_SERVICE_ROLE_KEY` and `VAPID_PRIVATE_KEY`
  now have a third home (`apps/notify`, a Vercel-hosted service) in
  addition to their existing homes in GitHub Actions and the Cloudflare
  Worker. Same handling discipline applies: environment-injected only,
  never logged, never echoed. See `docs/security/secrets-matrix.md`.
- *Denial of service:* a compromised or careless actor triggering
  repeated delivery attempts for the same announcement. Bounded by
  Inngest's `idempotency` configuration on the announcement id (so a
  duplicate event for the same row collapses rather than re-running) and
  `ANNOUNCEMENT_PUSH_MAX_PER_USER_PER_HOUR` as the per-subscriber ceiling
  regardless of how many delivery attempts occur.
- *Repudiation:* not new — this path only reads `announcements` and
  writes `push_claimed_at`/`pushed_at` on rows it owns the semantics of,
  and deletes `push_subscriptions` rows on `410`, the same deletion
  `ml/serving/push_delivery.py` already performed.

**Deferred (stated explicitly, not silently dropped):**

1. **Two Web Push implementations, in two languages.** Region-crossing
   pushes are still sent from Python (`ml/serving/push_delivery.py`,
   `pywebpush`); announcement pushes are now sent from TypeScript
   (`packages/push`, WebCrypto). That is real duplicated logic — payload
   encryption, VAPID signing, `410` cleanup, TTL handling all exist
   twice. `packages/push` was built portable enough to absorb the
   risk-crossing path later (ADR-016 "Easier" consequences), but this
   slice does not do that unification — it only stops making the
   duplication worse by keeping the boundary clean (`packages/push` has
   zero delivery logic that leaks into `apps/notify`, and vice versa).
2. **No per-category push preference.** A subscriber currently gets one
   `push_subscriptions` row and cannot ask for announcements without risk
   alerts, or vice versa — disabling push disables both. Adding a
   preference column and checking it in both delivery paths (Python and
   `packages/push`) is future work.

**`vite-plugin-pwa` is now configured, in `injectManifest` mode** — see
`apps/web/vite.config.ts`. It **must never** be switched to `generateSW`.
`generateSW` builds its own service worker from scratch and would
silently overwrite `sw.js`'s `push` and `notificationclick` handlers at
build time — everything this document and
`docs/features/push-notifications.md` describe. The resulting failure
mode ("push stopped working after we added offline caching") has no
obvious connection to a PWA plugin config choice made for an unrelated
reason, which is why the constraint is recorded here as well as in the
config.

`apps/web/e2e/pwa.spec.ts` asserts the injected precache manifest is
actually present in the built worker, so a config regression that quietly
disabled `injectManifest` fails a test rather than shipping.

**Manual Test Log:**

Automated coverage as of this writing is scaffolding only:
`apps/notify/api/announcement-published.test.ts`,
`apps/notify/src/inngest/deliverAnnouncement.test.ts`,
`apps/notify/src/inngest/sweepUndelivered.test.ts`, and
`packages/push/test/webPush.test.ts` /
`packages/push/test/deliverAnnouncement.test.ts` each currently assert
their handler throws `not implemented` — the migrations
(`20260819000022_announcement_push_lease.sql`,
`20260819000023_announcement_push_targets.sql`) and the frozen contract
in `packages/types/alerts.ts` are landed; the delivery logic itself is
in progress in a parallel slice. No manual end-to-end pass has been run
yet. This section will be updated with a real pass (webhook fire, sweep
reclaim of a deliberately stale claim, a role-targeted announcement
confirmed to reach only its target role, a duplicate-delivery/tag-collapse
check) once that implementation lands.
