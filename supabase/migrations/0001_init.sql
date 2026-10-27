-- Pakka: shared demo sessions (PRD 24.4, adapted). Paste into Supabase: SQL Editor -> New query -> Run.
-- Safe to run twice.

create table if not exists sessions (
  id text primary key,                       -- 'DEMO-7'
  seed text not null default '2711',
  clock jsonb not null,                      -- { simAnchor, realAnchor, speed, paused }
  epoch int not null default 1,              -- bumps on restart; old events are deleted
  ticker_lease_until timestamptz,
  created_at timestamptz not null default now()
);

-- Events are numbered per session and epoch without gaps. seq is the engine's event id.
create table if not exists events (
  session_id text not null references sessions(id) on delete cascade,
  epoch int not null,
  seq int not null,
  sim_at timestamptz not null,
  type text not null,
  actor text not null check (actor in ('ai','rule','customer','merchant','person','system')),
  subject_type text,
  subject_id text,
  rule_id text,
  model_version text,
  idempotency_key text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  primary key (session_id, epoch, seq)
);

-- Append a batch only if nobody else appended first (optimistic concurrency). Any server instance can
-- advance the session; a loser gets SEQ_CONFLICT, re-reads, and retries. The engine is deterministic, so
-- the retry produces the same events.
create or replace function append_events(p_session text, p_epoch int, p_after int, p_events jsonb)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  cur int;
begin
  perform 1 from sessions where id = p_session and epoch = p_epoch for update;
  if not found then
    raise exception 'EPOCH_CHANGED';
  end if;
  select coalesce(max(seq), 0) into cur from events where session_id = p_session and epoch = p_epoch;
  if cur <> p_after then
    raise exception 'SEQ_CONFLICT %', cur;
  end if;
  insert into events (session_id, epoch, seq, sim_at, type, actor, subject_type, subject_id, rule_id, model_version, idempotency_key, payload)
  select p_session, p_epoch, (e->>'id')::int, (e->>'simAt')::timestamptz, e->>'type', e->>'actor',
         e->>'subjectType', e->>'subjectId', e->>'ruleId', e->>'modelVersion', e->>'idempotencyKey',
         coalesce(e->'payload', '{}'::jsonb)
  from jsonb_array_elements(p_events) as e;
  return cur + jsonb_array_length(p_events);
end;
$$;

-- Restart: new epoch, old events gone (PRD 27: "Restart deletes the session's events").
create or replace function restart_session(p_session text, p_clock jsonb)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  next_epoch int;
begin
  update sessions set epoch = epoch + 1, clock = p_clock where id = p_session returning epoch into next_epoch;
  delete from events where session_id = p_session and epoch < next_epoch;
  return next_epoch;
end;
$$;

alter table sessions enable row level security;
alter table events enable row level security;
drop policy if exists "read sessions" on sessions;
drop policy if exists "read events" on events;
create policy "read sessions" on sessions for select using (true);
create policy "read events" on events for select using (true);
-- Inserts and updates only from server routes with the secret key.

revoke execute on function append_events(text, int, int, jsonb) from public, anon, authenticated;
revoke execute on function restart_session(text, jsonb) from public, anon, authenticated;

do $$ begin
  alter publication supabase_realtime add table events;
exception when duplicate_object then null; end $$;
