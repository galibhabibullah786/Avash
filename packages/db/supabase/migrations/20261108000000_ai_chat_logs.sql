-- AI Chat logs for auditing, medical triage analysis, and quality assurance
create table if not exists ai_chat_logs (
  id bigint generated always as identity primary key,
  session_id uuid not null,
  user_id uuid references auth.users(id) on delete set null on update cascade,
  message_role text not null check (message_role in ('user', 'model')),
  content text not null,
  model text not null,
  request_id text,
  created_at timestamptz not null default now()
);

create index if not exists idx_ai_chat_logs_session on ai_chat_logs(session_id, created_at desc);
create index if not exists idx_ai_chat_logs_user on ai_chat_logs(user_id, created_at desc);
create index if not exists idx_ai_chat_logs_created on ai_chat_logs(created_at desc);

alter table ai_chat_logs enable row level security;

-- Admin read access for quality assurance and compliance analysis
create policy ai_chat_logs_select_admin on ai_chat_logs for select
  using (public.has_capability('roles:manage'));
