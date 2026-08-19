-- docs/PROJECT_PLAN.md §4 amendment — author-broadcast announcements.
--
-- This is NOT alert_subscriptions with a flag (decision A). That table is
-- a user subscribing to an area; this is an author broadcasting to one.
-- Inverse relationships, different owners, different RLS.
create table if not exists announcements (
  id uuid primary key default gen_random_uuid(),
  author_id uuid references auth.users(id) on delete set null on update cascade,
  title text not null,
  body text not null,
  geom geometry(Point, 4326) not null,
  radius_m integer not null default 5000 check (radius_m between 500 and 50000),
  -- Empty array = every role; non-empty = only these roles.
  target_roles text[] not null default '{}',
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  constraint announcements_title_len check (char_length(title) between 1 and 120),
  constraint announcements_body_len check (char_length(body) between 1 and 1000),
  constraint announcements_expiry_future check (expires_at > created_at)
);

create index if not exists idx_announcements_geom
  on announcements using gist (geom);
-- Not partial: Postgres requires an IMMUTABLE predicate for a partial
-- index and now() is only STABLE, so "where expires_at > now()" is
-- rejected at create time. A plain index on expires_at still serves the
-- live-rows read path (decision B) via a range scan.
create index if not exists idx_announcements_active
  on announcements (expires_at desc);

alter table announcements enable row level security;

-- Authors with reports:moderate write; everyone authenticated reads live
-- rows, with role targeting applied. Proximity is filtered in the query,
-- not the policy — a policy cannot see the caller's location.
create policy announcements_author_write on announcements for all
  using (public.has_capability('reports:moderate'))
  with check (public.has_capability('reports:moderate'));

create policy announcements_target_read on announcements for select
  using (
    expires_at > now()
    and (
      cardinality(target_roles) = 0
      or (auth.jwt() -> 'app_metadata' ->> 'role') = any (target_roles)
    )
  );

-- Guarded exactly as 20260817000015's grant is — the local postgis
-- container has no service_role.
do $$
begin
  grant select, insert, delete on announcements to service_role;
exception
  when undefined_object then
    raise notice 'service_role not present (local Postgres without Supabase auth bootstrap) — skipping grant.';
end $$;
