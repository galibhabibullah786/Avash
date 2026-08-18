-- Two things the push path needs to stop losing track of itself.

-- 1. The browser's own read of whether IT is already registered.
--
-- `Notification.permission === 'granted'` only says the user once allowed
-- notifications; it says nothing about whether a push subscription still
-- exists or whether this server ever heard about it. Without a way to
-- check, the UI reverted to "not enabled" on every reload even though the
-- browser held a live subscription, and a browser subscription whose row
-- had been lost server-side (row deleted, project restored from a
-- backup, a 410 cleanup that raced a re-subscribe) was invisible and
-- permanently undeliverable — the browser would never re-register,
-- because as far as it was concerned it already had.
--
-- Same missing-grant class as 20260816000014_client_read_grants.sql and
-- 20260817000019: `push_subscriptions_owner_all`
-- (20260201000007_rls_policies.sql) already scopes every row to
-- `user_id = auth.uid()`, but GRANT is checked first, so that policy was
-- unreachable from a browser. SELECT only — registration still goes
-- through `apps/api` so it stays rate-limited and audited.
do $$
begin
  grant select on push_subscriptions to authenticated;
exception
  when undefined_object then
    raise notice 'authenticated role not present (local Postgres without Supabase auth bootstrap) — skipping grant.';
end $$;

-- 2. Delivery bookkeeping for announcements.
--
-- docs/features/alerts.md already described an announcement as riding
-- the batch job for push delivery, but nothing in ml/serving ever read
-- the table — a published announcement was visible in-app and never
-- notified anyone. Delivering it needs a record of whether it already
-- went out, or every scheduled run would re-push every live
-- announcement.
--
-- Nullable with no default: null means "not yet delivered", which is the
-- correct reading for both a new row and every row that predates this
-- column.
alter table announcements
  add column if not exists pushed_at timestamptz;

-- Serves the job's "live and not yet delivered" scan. Partial on
-- `pushed_at is null` — that predicate IS immutable (unlike the
-- `expires_at > now()` one 20260817000017 could not index), and the
-- delivered rows it excludes are the ones that accumulate without bound.
create index if not exists idx_announcements_undelivered
  on announcements (created_at)
  where pushed_at is null;
