# Push Notifications

Follows the mandatory template from `docs/PROJECT_PLAN.md` §12.

**Gist:** When the nightly batch prediction run finds a region whose
predicted risk just crossed into `high` or `severe`, matching subscribers
get a browser push notification. "Matching" means the subscriber's saved
watch-point (`alert_subscriptions`) is within its own configured radius of
that region. This never runs per-request and never runs in the Worker —
it is one step at the end of `ml/serving/predict.py`, the same batch job
that writes `risk_predictions` (ADR-002, ADR-007).

**Technical Detail:**

- **Data flow:** `ml/serving/predict.py`'s `batch_predict()` reads
  `risk_predictions` after that run's inference pass, and for every
  `(region_id, horizon_weeks)` whose latest row is `high`/`severe` and
  whose *previous* row (if any) was not, calls
  `ml/serving/push_delivery.py`. That module:
  1. Resolves the region's centroid from the `region_ingest_targets` view
     (`packages/db/supabase/migrations/20260215000009_api_read_views.sql`)
     — the same plain-numeric `lat`/`lon` the weather ingest job already
     uses, so this is not new spatial-decoding surface.
  2. Fetches active `alert_subscriptions` and keeps the ones within their
     own `radius_m` of that centroid — a geodesic distance check, clamped
     to `ALERT_PROXIMITY_RADIUS_DEFAULT_M`'s 20,000 m ceiling regardless
     of what a stored row claims (§14, defense in depth against the check
     constraint alone).
  3. Resolves the matching subscribers' `push_subscriptions` rows (their
     registered browsers/devices) and sends one Web Push message per row
     via `pywebpush`.
- **Why this isn't a live `ST_DWithin` call.** The existing pattern for
  pushing a spatial predicate PostgREST can't express (`ST_DWithin`,
  `ST_Centroid`, …) into SQL is a `security invoker` database function
  owned by a migration — see `public.blood_within_radius()` in
  `20260815000012_app_role_and_resource_reads.sql`. Adding a matching
  function for alerts was out of scope for this slice, so the radius
  check runs in Python instead, against `alert_subscriptions.geom`
  decoded from the GeoJSON PostgREST returns for a plain `select` —
  PostGIS registers a `geometry -> json` cast, so a geometry column
  arrives as a parsed `{"type": "Point", "coordinates": [lon, lat]}`
  dict, never a WKB hex string. Same notion of "within a radius,"
  different place it's computed; a later slice can move it into a
  migration-owned function without changing `push_delivery.py`'s public
  shape.
- **The browser half: a service worker plus a control that registers
  one.** Web Push has no in-page delivery path — the browser wakes a
  service worker to handle the `push` event whether or not a tab is
  open — so `apps/web/public/sw.js` is what a push is actually delivered
  to. It handles `push` (always calling `showNotification`, which
  `userVisibleOnly: true` requires) and `notificationclick` (focusing an
  already-open tab rather than opening a duplicate, and only ever
  navigating to a same-origin path derived in the worker, never a URL
  taken from the push payload). `apps/web/src/lib/serviceWorker.ts`
  registers it on demand and waits for activation before
  `PushManager.subscribe()` is called, and
  `apps/web/src/features/alerts/PushNotificationToggle.tsx` is the
  dashboard control that starts the whole thing from a click —
  `Notification.requestPermission()` outside a user gesture is refused
  by most browsers, which is why it is never an effect.

  **Both halves are required, and this one was missing.** An
  `alert_subscriptions` row says WHERE to alert someone; a
  `push_subscriptions` row says HOW to reach them. Until this existed
  there was no service worker in the app at all and nothing rendered
  `usePushSubscription`, so `push_subscriptions` was necessarily empty
  and every delivery pass matched zero targets no matter how many
  proximity subscriptions existed.
- **Not a WebSocket, and not a connection the app holds open.** The push
  travels from this batch job to the browser vendor's push service
  (signed with `VAPID_PRIVATE_KEY`) and from there to the service
  worker; the app may be closed entirely. Nothing in this path is
  real-time from the app's point of view — the only live-connection
  feature in this codebase is the blood-inventory ticker's Supabase
  Realtime channel (ADR-010), which is unrelated. A crossing is
  therefore delivered on the batch job's cadence, not the moment it
  happens.
- **Talks to Supabase directly, never through `apps/api`.** ADR-007: this
  is a background job, not an HTTP endpoint. It authenticates with
  `SUPABASE_SERVICE_ROLE_KEY`, which bypasses RLS — `apps/api`'s
  `POST /api/alerts/subscribe` and `POST /api/alerts/push-subscription`
  routes own the write path (CRUD only, §6), and this job only ever
  reads and deletes rows it already owns the semantics of.
- **The VAPID keypair, twice, on purpose.** Web Push signing needs both
  halves of one keypair, but the two halves have opposite exposure:
  - `VITE_PUBLIC_VAPID_PUBLIC_KEY` — the browser reads this (via
    `apps/web`) to register a push subscription with the browser's push
    service. It is bundled into the client, so its name must carry the
    `VITE_PUBLIC_` prefix or the build tooling refuses to inline it
    (`docs/security/secrets-matrix.md`, the `VITE_PUBLIC_` prefix rule).
  - `VAPID_PUBLIC_KEY` — the *same value*, under a second, non-public
    name, read only by `ml/serving/predict.py`.
  - `VAPID_PRIVATE_KEY` — signs every push payload server-side. Never
    given a `VITE_PUBLIC_` name, never placed in any `apps/web` env file,
    never logged.

  Two names for one public value is deliberate, not duplication: a value
  that legitimately needs to reach the browser can't be read under a
  bare, non-`VITE_PUBLIC_` name — Vite won't inline it and the lint rule
  rejects the source-level access either way. Collapsing the two names
  back to one would either break the browser registration or smuggle a
  non-public name into the client bundle.
- **Neither VAPID value is ever logged.** `push_delivery.py` passes
  `vapid_private_key` straight into `pywebpush`'s `webpush()` call and
  never interpolates it into a log line, an exception message, or a
  format string. This mirrors why `cron-batch-predict.yml` does not
  `echo`/`::add-mask::` the key itself: GitHub Actions already masks any
  value sourced from `secrets.*` in log output, and an explicit echo of a
  multi-line PEM-style key only registers the *first* line as a mask,
  printing the rest in the clear — actively worse than doing nothing.
- **410 cleanup.** A Web Push service returns `410 Gone` when a
  subscription is dead — the user uninstalled, cleared site data, or the
  endpoint simply expired. On a `410`, `push_delivery.py` deletes that
  specific `push_subscriptions` row immediately; there is no retry, because
  a `410` is not transient. Any other failure (network error, timeout,
  5xx, a malformed subscription) is logged and the loop moves to the next
  target — one bad subscription can never abort the rest of the batch, so
  a stale row from a non-410 failure is left in place to be retried on the
  next crossing rather than deleted speculatively.
- **Edge cases handled:** an empty `risk_predictions` table is a no-op,
  logged clearly, before any subscription is even queried (see the
  batch-predict safety property below); a region with no matching
  subscriptions sends nothing; a user with zero `push_subscriptions` rows
  (never registered a browser) is silently skipped, not treated as an
  error; missing VAPID configuration skips delivery for that run with a
  warning rather than raising.
- **Batch-predict safety property.** `cron-batch-predict.yml`'s guard
  (`[ ! -s ml/serving/predict.py ]`) only skips the scheduled run while
  the file is completely empty — once it has real content, every
  scheduled run executes for real, including sending real pushes. Because
  of that, `batch_predict()` returns early, with a clear log line,
  whenever `risk_predictions` has no rows at all, before anything in this
  document's delivery path runs. An empty table is exactly the situation
  that early return exists to make safe.

**Critical Constants:**

| Constant | Value | Defined in | Purpose |
|---|---|---|---|
| `ALERT_PROXIMITY_RADIUS_DEFAULT_M` | 2000 (bounds: 100–20,000) | `packages/geo`, `alert_subscriptions` check constraint | default/ceiling every proximity match (including this one) clamps to; no new constant introduced here — this delivery path reuses the existing registry entry |
| `BATCH_PREDICT_CADENCE` | every 24h | `.github/workflows/cron-batch-predict.yml` | how often a region can cross into `high`/`severe` and trigger a push |

**Security Considerations:**

STRIDE analysis, mirrored into `docs/security/threat-model.md`:

- *Information disclosure:* `VAPID_PRIVATE_KEY` leaking via a log line,
  exception message, or accidental echo. Mitigated by never
  interpolating either VAPID value into anything logged, and by relying
  on GitHub Actions' automatic secret masking rather than a manual
  `::add-mask::` (see Technical Detail above for why the manual form is
  actively worse for a multi-line key).
- *Information disclosure:* an unrelated push service response body
  (which could carry provider-side diagnostic detail) ending up in a log
  line. Mitigated by logging only the HTTP status code and the
  subscription id on failure, never the raw response.
- *Tampering:* a forged or malformed `push_subscriptions` row (bad
  `endpoint`/`p256dh`/`auth_key`) reaching `pywebpush`. Mitigated by the
  same table-level `not null` constraints the write path already enforces
  (`apps/api`'s `POST /api/alerts/push-subscription`), plus this job
  filtering out any row missing one of the three fields before it ever
  builds a `subscription_info` dict.
- *Denial of service:* an unbounded or maliciously large `radius_m`
  turning the proximity match into a full-table geodesic scan across
  every subscription. Mitigated by the `alert_subscriptions.radius_m`
  check constraint (100–20,000) at write time and the independent
  in-code clamp to the same ceiling at match time, so a future change to
  one does not silently widen the other.
- *Spoofing:* none new — this job authenticates to Supabase with the
  service-role key over a server-to-server connection with no end-user
  identity in the request path; the push service itself authenticates the
  job to the browser via the VAPID signature, not the other way around.
- *Repudiation:* not applicable — this path only reads and deletes rows
  it owns the semantics of (expired `push_subscriptions`); it never
  writes on behalf of a user, so there is nothing here for a user to
  repudiate.

**Manual Test Log:**

Automated coverage is `ml/serving/test_push_delivery.py` (proximity
matching against fixture rows, GeoJSON geometry decoding, 410 cleanup,
non-410 persistence, one bad subscription not aborting the batch, VAPID
keys never appearing in captured log output), `ml/serving/test_predict.py`
(the empty-`risk_predictions` early return, crossing detection), and on
the browser side `apps/web/src/lib/serviceWorker.test.ts` and
`apps/web/src/hooks/usePushSubscription.test.ts`.

2026-08-18, first real end-to-end pass — real browser, real push
service, real VAPID signature, hosted Supabase project:

1. Chrome (a persistent profile, not an incognito context — Chrome
   refuses the Push API in incognito outright, crbug.com/41124656)
   loaded the dashboard signed in as a citizen account and clicked
   "Enable push notifications".
2. `sw.js` registered and reached `active`, `PushManager.subscribe()`
   returned an `fcm.googleapis.com` endpoint, and
   `POST /api/alerts/push-subscription` stored the row.
3. `deliver_region_alert()` — the same function `batch_predict()` calls,
   invoked directly with the account's own subscription point as the
   region centroid — matched one target and reported one push attempt
   with no failure logged.
4. `registration.getNotifications()` in the browser returned the
   delivered notification with the batch job's own title, body, and
   `tag`, confirming the payload survived the whole path intact.

The test account's `push_subscriptions` row was deleted afterwards,
since the endpoint belonged to a throwaway browser profile. The 410
cleanup path is still only covered by its unit test — provoking a real
`410` needs a subscription to be revoked out-of-band and left to expire.
