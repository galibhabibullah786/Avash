-- docs/PROJECT_PLAN.md §4 amendment — generic append-only audit trail.
--
-- role_assignments is NOT folded into this table: it has typed columns and
-- two check constraints, and generalizing it into `detail jsonb` would
-- trade real constraints for uniformity. The two coexist.
--
-- No insert, update, or delete policy exists, and none is intended. An
-- audit row that can be edited is not an audit row. apps/api writes with
-- the service role, which bypasses RLS; corrections are appended.
create table if not exists audit_log (
  id bigint generated always as identity primary key,
  occurred_at timestamptz not null default now(),
  -- NULL only if the actor's account is later deleted; the row survives it.
  actor_id uuid references auth.users(id) on delete set null on update cascade,
  actor_role text,
  action text not null,
  entity_type text not null,
  entity_id text,
  outcome text not null,
  -- Correlates with the requestId in the server logs for the same call.
  request_id text,
  -- Scalars only, one level deep, capped at AUDIT_DETAIL_MAX_KEYS by the
  -- zod schema before it ever reaches here.
  detail jsonb,
  constraint audit_log_outcome_valid
    check (outcome in ('success', 'failure')),
  constraint audit_log_actor_role_valid
    check (actor_role is null
           or actor_role in ('citizen', 'hospital_staff', 'moderator', 'admin'))
);

-- The three read patterns the admin UI will have: recent activity, one
-- actor's history, one action type over time.
create index if not exists idx_audit_log_occurred
  on audit_log (occurred_at desc);
create index if not exists idx_audit_log_actor
  on audit_log (actor_id, occurred_at desc);
create index if not exists idx_audit_log_action
  on audit_log (action, occurred_at desc);

alter table audit_log enable row level security;

-- Admins read the trail; nobody writes it through PostgREST. Every other
-- role is denied by default, since no permissive policy covers them.
create policy audit_log_select_admin on audit_log for select
  using (public.has_capability('roles:manage'));

-- apps/api writes audit_log with the service-role key, which bypasses RLS.
-- Guarded the same way 20260816000013's role_assignments grant is — the
-- local postgis container has no such role.
do $$
begin
  grant select, insert on audit_log to service_role;
  grant usage, select on sequence audit_log_id_seq to service_role;
exception
  when undefined_object then
    raise notice 'service_role not present (local Postgres without Supabase auth bootstrap) — skipping grant.';
end $$;
