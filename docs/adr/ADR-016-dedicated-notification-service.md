# ADR-016: A third deployable app — `apps/notify` for announcement push

**Date:** 2026-08-19
**Status:** Accepted

## Context

ADR-001 established a two-app split: `apps/web` (a pure static SPA with no
server secrets) and `apps/api` (the sole owner of all secret-touching,
per-request logic on Cloudflare Workers). That split assumed every
secret-touching operation is either a per-request call from the browser or a
scheduled batch job (ADR-007). Announcement delivery fits neither shape.

Today, `ml/serving/predict.py` calls `deliver_pending_announcements()` before
its risk-prediction path, riding the nightly `cron-batch-predict` cadence
(`0 2 * * *`). That couples a moderator pressing "Publish" to a job that runs
once a day — worst case just under 24 hours of latency, sometimes past the
announcement's own `expires_at` before the job wakes up.

Moving delivery into `apps/api`'s request path is not a fix: each Web Push
send is an ECDH + HKDF + AES-128-GCM encryption plus an outbound HTTPS
request. Fanning out to every matching subscriber inside the `POST
/api/announcements` handler would blow the Workers free-tier CPU budget and
make publish latency proportional to subscriber count — the same problem
ADR-001 avoided for Gemini calls, just per-subscriber instead of per-request.

Announcement delivery is a third shape: triggered by a write (not a browser
request, not a fixed schedule), needing durable retries, per-subscriber
fan-out, and anti-spam throttling per user rather than a coarse global
cadence.

**Rejected alternative: a Supabase Edge Function invoked directly by the DB
webhook.** Zero new vendors, zero new deploy credentials, and the
service-role key never leaves Supabase. Rejected because it loses durable
step retries and the throttle/debounce controls the anti-spam requirement
needs — Deno Deploy's model gives no equivalent primitive, so that logic
would have to be hand-rolled against Supabase's own tables, duplicating what
a durable-execution platform already does correctly.

**Rejected alternative: `ctx.waitUntil()` in the existing `apps/api`
Worker.** The simplest possible thing — no new app, no new vendor. Rejected
because a dropped `waitUntil` is gone with no retry, and it still burns
Worker CPU proportional to subscriber count, so it does not scale past a few
hundred subscribers. It also reintroduces the coupling ADR-001 exists to
avoid: `apps/api`'s request-serving budget would again be shared with
background fan-out work.

## Decision

Add `apps/notify`, a third deployable app, on Vercel with Inngest for durable
execution. `apps/*` is already a `pnpm-workspace.yaml` glob (`services/*` is
not), so this is a workspace member, not a new top-level layout.

All delivery logic — VAPID signing, payload encryption, the targets RPC call,
claim/stamp, `410` cleanup — lives in `packages/push`, a plain TypeScript
package with no Vercel or Inngest imports and no Node-only APIs (WebCrypto
only). `apps/notify` is a thin adapter: an HTTP handler for the Supabase
Database Webhook and an Inngest function definition, both calling into
`packages/push`. If Vercel's licence, pricing, or availability ever becomes a
problem, re-hosting `apps/notify` is a matter of writing a new thin adapter
around the same `packages/push` — not a rewrite of the delivery logic itself.

Trigger is a Supabase Database Webhook (`AFTER INSERT ON announcements`) for
low latency, paired with an Inngest scheduled sweep over
`pushed_at IS NULL` as a safety net that re-reads truth from the table rather
than trusting any one write path.

Per ADR-007, `apps/notify` talks to Supabase directly with the service-role
key. It never calls `apps/api`.

## Consequences

**Easier:**
- Announcement delivery latency drops from up to 24 hours to seconds,
  independent of the nightly ML batch cadence.
- `apps/api`'s request-serving CPU budget stays isolated from fan-out work,
  same as ADR-001's original reasoning for Gemini/Turnstile.
- Per-user throttle/debounce (Inngest primitives) gives the anti-spam control
  a global cron cadence cannot: the one notification that matters is never
  delayed by an unrelated coarse schedule.
- `packages/push` is portable enough to later absorb risk-crossing pushes
  currently sent from `ml/serving/push_delivery.py` (Python), collapsing two
  Web Push implementations into one — deferred, not designed away.

**Harder:**
- A third home for `SUPABASE_SERVICE_ROLE_KEY` (previously: GitHub Actions
  secrets, Cloudflare Worker secrets) and a second home for
  `VAPID_PRIVATE_KEY`. Both require the same secret-handling discipline as
  their existing homes.
- Two more vendor dashboards (Vercel, Inngest), two more deploy credential
  sets, two more status pages that can take announcement delivery down.
- Vercel Hobby is licensed for non-commercial use only — acceptable for this
  academic project, but a licence term to track rather than assume.
- "Two apps" (ADR-001's framing) now means "the two user-facing apps"; `apps/*`
  as a workspace glob means "deployable unit". This ADR is the record of that
  drift, so a future reader does not have to rediscover it from the glob.
