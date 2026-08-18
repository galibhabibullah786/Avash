-- docs/adr/ADR-016 — announcement delivery moves off the nightly batch job
-- and onto apps/notify (a Supabase DB webhook + an Inngest sweep, both able
-- to fire for the same row). 20260818000021's `pushed_at` column is a
-- correct "delivered" marker but not a safe "in progress" one: with two
-- triggers, both can read `pushed_at is null` at once and both fan out,
-- double-delivering every subscriber. `pushed_at` itself is NOT
-- reinterpreted here — it still means "delivered", stamped only after a
-- send completes.
--
-- This adds the missing half: a claim taken BEFORE sending, with a lease.
-- No row returned by the claim update -> someone else already owns this
-- delivery, stop. A crash between claim and send leaves a stale claim that
-- the sweep reclaims once ANNOUNCEMENT_PUSH_LEASE_SECONDS (§14,
-- docs/constants-registry.md) has passed. See docs/features/announcement-push.md
-- for the full claim/stamp sequence.
alter table announcements
  add column if not exists push_claimed_at timestamptz;
