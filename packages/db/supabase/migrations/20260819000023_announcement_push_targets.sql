-- docs/adr/ADR-016 — the RPC `packages/push` calls to resolve one
-- announcement to the `push_subscriptions` rows it should be sent to.
--
-- Fixes a recorded bug: `ml/serving/push_delivery.py`'s
-- `find_matching_push_targets()` never applied an announcement's
-- `target_roles` — a role-targeted announcement (e.g. `moderator`) was
-- pushed, full title and body, to every citizen within radius. That
-- function's own docstring names this RPC as the intended fix (see
-- ml/serving/push_delivery.py and docs/features/announcement-push.md).
--
-- Also fixes the full-table scan the same function did: no spatial
-- predicate reached PostgREST, so every delivery — announcement or
-- risk-crossing — pulled every active `alert_subscriptions` row into
-- Python and filtered by haversine there. This pushes the ST_DWithin
-- predicate into SQL, following `public.blood_within_radius()`
-- (20260815000012_app_role_and_resource_reads.sql).
--
-- `security definer`, unlike `blood_within_radius`'s `security invoker`:
-- role targeting needs `auth.users.raw_app_meta_data`, which
-- `authenticated`/`anon` cannot read directly, and this function is only
-- ever called by `apps/notify` with the service-role key — never exposed
-- to the browser.
create or replace function public.announcement_push_targets(p_announcement_id uuid)
returns table (
  subscription_id uuid,
  endpoint text,
  p256dh text,
  auth_key text
)
  language sql stable security definer
  set search_path = public, extensions
as $$
  select
    ps.id as subscription_id,
    ps.endpoint,
    ps.p256dh,
    ps.auth_key
  from announcements a
  join alert_subscriptions asub
    on asub.active = true
    -- The ANNOUNCEMENT's radius decides the match (clamped independently
    -- of the check constraint, defensively re-clamped here exactly as
    -- ml/serving/push_delivery.py's ANNOUNCEMENT_RADIUS_CEILING_M did) —
    -- matches `announcementVisibleTo()` in
    -- apps/api/src/lib/announcementDto.ts, so push and the in-app feed
    -- cannot disagree about who an announcement is for.
   and st_dwithin(
        asub.geom::geography,
        a.geom::geography,
        least(a.radius_m, 50000)
      )
  join auth.users u on u.id = asub.user_id
  join push_subscriptions ps on ps.user_id = asub.user_id
  where a.id = p_announcement_id
    and a.expires_at > now()
    -- Empty target_roles = every role; non-empty = only those roles.
    -- This is the over-delivery fix: the caller of this function no
    -- longer needs to (and cannot forget to) apply target_roles itself.
    and (
      cardinality(a.target_roles) = 0
      or (u.raw_app_meta_data ->> 'role') = any (a.target_roles)
    )
    and ps.endpoint is not null
    and ps.p256dh is not null
    and ps.auth_key is not null;
$$;

do $$
begin
  grant execute on function public.announcement_push_targets(uuid) to service_role;
exception
  when undefined_object then
    raise notice 'service_role not present (local Postgres without Supabase auth bootstrap) — skipping grant.';
end $$;
