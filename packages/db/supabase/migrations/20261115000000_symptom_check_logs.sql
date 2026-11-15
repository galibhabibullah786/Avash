-- Symptom check triage logs for epidemiology tracking, auditing, and quality analysis
create table if not exists symptom_check_logs (
  id bigint generated always as identity primary key,
  request_id text not null,
  user_id uuid references auth.users(id) on delete set null on update cascade,
  outcome text not null,
  checklist jsonb not null default '{}'::jsonb,
  qa_pairs jsonb not null default '[]'::jsonb,
  guidance text,
  created_at timestamptz not null default now()
);

create index if not exists idx_symptom_check_logs_user on symptom_check_logs(user_id, created_at desc);
create index if not exists idx_symptom_check_logs_created on symptom_check_logs(created_at desc);

alter table symptom_check_logs enable row level security;

-- Admin read access for epidemiology reporting and quality assurance
create policy symptom_check_logs_select_admin on symptom_check_logs for select
  using (public.has_capability('roles:manage'));
