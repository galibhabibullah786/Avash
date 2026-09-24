-- Object-level SELECT grant for the browser's own read of its
-- `alert_subscriptions` rows (the alert-subscribe form reading whether the
-- signed-in user already has an active subscription, direct from Supabase
-- via RLS — see docs/features/alerts.md). Same missing-grant class of bug
-- 20260816000014_client_read_grants.sql fixed for breeding_reports,
-- blood_inventory, and role_assignments: GRANT and RLS are independent
-- checks and Postgres applies GRANT first, so `alert_subscriptions_owner_all`
-- (20260201000007_rls_policies.sql) was never reached — every direct read
-- 403'd with PostgREST's generic "permission denied for table" before RLS
-- had a chance to scope it to the caller's own rows.
do $$
begin
  grant select on alert_subscriptions to authenticated;
exception
  when undefined_object then
    raise notice 'authenticated role not present (local Postgres without Supabase auth bootstrap) — skipping grant.';
end $$;
