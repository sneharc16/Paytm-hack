-- Pakka for Business, live mode: one append-only, hash-chained ledger per company. Safe to run twice.
-- Writes go through the service role on the server only; nothing here is readable with the publishable key.

create table if not exists b2b_orgs (
  id text primary key,
  created_at timestamptz not null default now()
);

create table if not exists b2b_events (
  org_id text not null references b2b_orgs(id) on delete restrict,
  seq int not null,
  at timestamptz not null,
  company_id text not null,
  type text not null,
  actor text not null,
  rule_id text,
  payload jsonb not null,
  prev text not null,
  hash text not null,
  created_at timestamptz not null default now(),
  primary key (org_id, seq)
);

-- One-time values: request nonces from agents and used passkey challenges.
create table if not exists b2b_once (
  key text primary key,
  expires_at timestamptz not null
);

alter table b2b_orgs enable row level security;
alter table b2b_events enable row level security;
alter table b2b_once enable row level security;

-- The ledger is append-only: no updates, no deletes, even for the service role through PostgREST.
create or replace function b2b_no_rewrite() returns trigger language plpgsql as $$
begin
  raise exception 'b2b_events is append-only';
end;
$$;
drop trigger if exists b2b_events_no_update on b2b_events;
create trigger b2b_events_no_update before update or delete on b2b_events for each row execute function b2b_no_rewrite();

-- Append a batch only if the ledger still ends at p_after; also checks each event links to the one before.
create or replace function b2b_append(p_org text, p_after int, p_events jsonb)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  cur int;
  last_hash text;
  e jsonb;
begin
  insert into b2b_orgs (id) values (p_org) on conflict do nothing;
  perform 1 from b2b_orgs where id = p_org for update;
  select seq, hash into cur, last_hash from b2b_events where org_id = p_org order by seq desc limit 1;
  cur := coalesce(cur, 0);
  last_hash := coalesce(last_hash, repeat('0', 64));
  if cur <> p_after then
    raise exception 'SEQ_CONFLICT %', cur;
  end if;
  for e in select * from jsonb_array_elements(p_events) loop
    if (e->>'seq')::int <> cur + 1 or e->>'prev' <> last_hash then
      raise exception 'CHAIN_BROKEN at %', e->>'seq';
    end if;
    insert into b2b_events (org_id, seq, at, company_id, type, actor, rule_id, payload, prev, hash)
    values (p_org, (e->>'seq')::int, (e->>'at')::timestamptz, e->>'companyId', e->>'type', e->>'actor', e->>'ruleId', coalesce(e->'payload', '{}'::jsonb), e->>'prev', e->>'hash');
    cur := cur + 1;
    last_hash := e->>'hash';
  end loop;
  return cur;
end;
$$;

revoke all on function b2b_append(text, int, jsonb) from public, anon, authenticated;
