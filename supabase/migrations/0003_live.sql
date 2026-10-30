-- Pakka live: one row per person (profile, passkeys, the AutoPays they added, their event log). Safe to run twice.
-- Writes go through the service role on the server only; nothing here is readable with the publishable key.
-- One-time values (used passkey challenges) share b2b_once.

create table if not exists live_people (
  id text primary key,
  version int not null,
  doc jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table live_people enable row level security;
revoke all on live_people from anon, authenticated;
