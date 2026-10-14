-- North initial schema (docs/SPEC.md "Veri modeli", design §7).
-- Every row belongs to a company (or a user); RLS keys on ownership.
-- actions, ledger_entries and audit_tool_calls are append-only.

create extension if not exists pgcrypto;
create extension if not exists vector;

-- ---------------------------------------------------------------------------
-- helpers
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

create or replace function public.forbid_change() returns trigger
language plpgsql as $$
begin
  raise exception 'append-only table: % rows cannot be updated or deleted', tg_table_name
    using errcode = 'restrict_violation';
end $$;

-- ---------------------------------------------------------------------------
-- users (profile over auth.users)
-- ---------------------------------------------------------------------------
create table public.users (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  timezone text not null default 'UTC',
  daily_decision_quota int not null default 3 check (daily_decision_quota between 1 and 5),
  plan text not null default 'free',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger users_updated_at before update on public.users for each row execute function public.set_updated_at();

create or replace function public.handle_new_auth_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.users (id, email) values (new.id, coalesce(new.email, ''))
  on conflict (id) do nothing;
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_auth_user();

-- ---------------------------------------------------------------------------
-- companies and the ownership helper used by every policy
-- ---------------------------------------------------------------------------
create table public.companies (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  slug text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,62}$'),
  status text not null default 'active' check (status in ('active', 'paused', 'archived')),
  kill_switch_active boolean not null default false,
  public_page_enabled boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index companies_owner_idx on public.companies (owner_id);
create trigger companies_updated_at before update on public.companies for each row execute function public.set_updated_at();

create or replace function public.is_company_owner(target_company_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.companies c where c.id = target_company_id and c.owner_id = auth.uid()
  );
$$;

-- ---------------------------------------------------------------------------
-- company-scoped tables
-- ---------------------------------------------------------------------------
create table public.theses (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  version int not null check (version >= 1),
  text text not null,
  target_customer text not null default '',
  why_now text not null default '',
  created_at timestamptz not null default now(),
  unique (company_id, version)
);

create table public.goals (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  metric_key text not null,
  target_value numeric not null,
  due_date date not null,
  status text not null default 'active' check (status in ('active', 'done', 'dropped')),
  created_at timestamptz not null default now()
);
create index goals_company_idx on public.goals (company_id, status);

create table public.budgets (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  category text not null check (category in ('ads', 'tools', 'domain', 'other')),
  total_limit_usd numeric not null check (total_limit_usd >= 0),
  daily_limit_usd numeric not null check (daily_limit_usd >= 0),
  spent_total_usd numeric not null default 0 check (spent_total_usd >= 0),
  spent_today_usd numeric not null default 0 check (spent_today_usd >= 0),
  spent_today_date date not null default current_date,
  currency text not null default 'USD',
  unique (company_id, category)
);

create table public.agents (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  role text not null,
  config_ref text not null,
  max_action_tier text not null check (max_action_tier in ('K0', 'K1', 'K2', 'K3')),
  enabled boolean not null default true,
  unique (company_id, role)
);

create table public.plans (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  goal_id uuid references public.goals(id) on delete set null,
  week_start date not null,
  summary text not null,
  rationale text not null default '',
  created_at timestamptz not null default now()
);
create index plans_company_week_idx on public.plans (company_id, week_start desc);

create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  plan_id uuid references public.plans(id) on delete set null,
  agent_id uuid references public.agents(id) on delete set null,
  role text not null,
  title text not null,
  input jsonb not null default '{}'::jsonb,
  status text not null default 'queued' check (status in ('queued', 'running', 'waiting_decision', 'done', 'failed')),
  evidence jsonb,
  cost_usd numeric not null default 0 check (cost_usd >= 0),
  metric_key text,
  expected_delta numeric,
  attempts int not null default 0 check (attempts between 0 and 2),
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tasks_done_requires_evidence check (status <> 'done' or evidence is not null)
);
create index tasks_company_status_idx on public.tasks (company_id, status);
create trigger tasks_updated_at before update on public.tasks for each row execute function public.set_updated_at();

create table public.decision_cards (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  task_id uuid references public.tasks(id) on delete set null,
  action_kind text not null,
  tier text not null check (tier in ('K2', 'K3')),
  question text not null check (char_length(question) <= 200),
  options jsonb not null,
  recommended_option_id text not null,
  default_option_id text,
  rationale text not null,
  expected_impact text,
  cost_usd numeric not null default 0 check (cost_usd >= 0),
  due_at timestamptz not null,
  day date not null default current_date,
  seq int not null check (seq between 1 and 5),
  answered_option_id text,
  answered_at timestamptz,
  answered_by text check (answered_by in ('user', 'default', 'auto_rule')),
  created_at timestamptz not null default now(),
  constraint k3_has_no_default check (tier <> 'K3' or default_option_id is null),
  unique (company_id, day, seq)
);
create index decision_cards_pending_idx on public.decision_cards (company_id, answered_at) where answered_at is null;

-- DEC-3 at the database level: seq is assigned by the trigger and may not exceed
-- the owner's daily quota.
create or replace function public.assign_decision_card_seq() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  quota int;
  next_seq int;
begin
  select u.daily_decision_quota into quota
    from public.companies c join public.users u on u.id = c.owner_id
   where c.id = new.company_id;
  if quota is null then
    raise exception 'company % has no owner', new.company_id;
  end if;
  select coalesce(max(seq), 0) + 1 into next_seq
    from public.decision_cards where company_id = new.company_id and day = new.day;
  if next_seq > quota then
    raise exception 'daily decision quota (%) exceeded for company %', quota, new.company_id
      using errcode = 'check_violation';
  end if;
  new.seq := next_seq;
  return new;
end $$;
create trigger decision_cards_assign_seq before insert on public.decision_cards
  for each row execute function public.assign_decision_card_seq();

create table public.auto_rules (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  kind text not null,
  max_amount_usd numeric check (max_amount_usd >= 0),
  category text check (category in ('ads', 'tools', 'domain', 'other')),
  created_from_card_id uuid references public.decision_cards(id) on delete set null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- DEC-1 at the database level: K2 needs a card or an auto rule, K3 needs a card.
create table public.actions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  task_id uuid references public.tasks(id) on delete set null,
  agent_role text not null,
  kind text not null,
  tier text not null check (tier in ('K0', 'K1', 'K2', 'K3')),
  description text not null,
  payload jsonb not null default '{}'::jsonb,
  status text not null check (status in ('executed', 'notified', 'blocked', 'declined', 'failed', 'pending')),
  external_ref text,
  decision_card_id uuid references public.decision_cards(id) on delete restrict,
  auto_rule_id uuid references public.auto_rules(id) on delete restrict,
  sandbox boolean not null default true,
  created_at timestamptz not null default now(),
  constraint actions_tier_requires_authority check (
    tier in ('K0', 'K1')
    or (tier = 'K2' and (decision_card_id is not null or auto_rule_id is not null))
    or (tier = 'K3' and decision_card_id is not null)
    or status = 'blocked'
  )
);
create index actions_company_created_idx on public.actions (company_id, created_at desc);
create trigger actions_append_only before update or delete on public.actions for each row execute function public.forbid_change();

create table public.signals (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  source text not null,
  summary text not null,
  evidence_urls jsonb not null default '[]'::jsonb,
  score numeric not null default 0,
  converted_card_id uuid references public.decision_cards(id) on delete set null,
  created_at timestamptz not null default now()
);

create table public.metrics (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  metric_key text not null,
  value numeric not null,
  source text not null,
  measured_at timestamptz not null default now()
);
create index metrics_series_idx on public.metrics (company_id, metric_key, measured_at desc);

create table public.ledger_entries (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  task_id uuid references public.tasks(id) on delete set null,
  metric_key text not null,
  before_value numeric not null,
  after_value numeric not null,
  cost_usd numeric not null default 0 check (cost_usd >= 0),
  channel text not null,
  attribution_note text not null default '',
  created_at timestamptz not null default now()
);
create index ledger_company_idx on public.ledger_entries (company_id, created_at desc);
create trigger ledger_append_only before update or delete on public.ledger_entries for each row execute function public.forbid_change();

create table public.memory_items (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  kind text not null check (kind in ('thesis', 'persona', 'decision', 'learning', 'doc')),
  title text not null,
  content text not null,
  embedding vector(1536),
  created_by_role text not null default 'system',
  created_at timestamptz not null default now()
);
create index memory_company_kind_idx on public.memory_items (company_id, kind);

create table public.artifacts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  kind text not null,
  title text not null,
  version int not null default 1 check (version >= 1),
  storage_path text not null,
  created_by_role text not null,
  created_at timestamptz not null default now(),
  unique (company_id, kind, title, version)
);

create table public.briefs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  brief_date date not null,
  content jsonb not null,
  created_at timestamptz not null default now(),
  unique (company_id, brief_date)
);

create table public.agent_runs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  task_id uuid references public.tasks(id) on delete set null,
  role text not null,
  model text not null,
  runtime text not null check (runtime in ('claude-agent-sdk', 'mock')),
  session_id text,
  input_tokens bigint not null default 0,
  output_tokens bigint not null default 0,
  cost_usd numeric not null default 0,
  duration_ms int not null default 0,
  status text not null check (status in ('succeeded', 'failed', 'waiting_decision')),
  error text,
  created_at timestamptz not null default now()
);

create table public.audit_tool_calls (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  agent_run_id uuid references public.agent_runs(id) on delete set null,
  tool_name text not null,
  input jsonb not null default '{}'::jsonb,
  decision text not null check (decision in ('allow', 'deny')),
  created_at timestamptz not null default now()
);
create trigger audit_append_only before update or delete on public.audit_tool_calls for each row execute function public.forbid_change();

-- ---------------------------------------------------------------------------
-- user-scoped tables
-- ---------------------------------------------------------------------------
create table public.connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  provider text not null,
  scopes text[] not null default '{}',
  vault_secret_id uuid,
  status text not null default 'connected' check (status in ('connected', 'revoked', 'error')),
  created_at timestamptz not null default now(),
  unique (user_id, provider)
);

create table public.usage (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  period text not null check (period ~ '^[0-9]{4}-[0-9]{2}$'),
  credits_used int not null default 0,
  llm_cost_usd numeric not null default 0,
  sandbox_minutes numeric not null default 0,
  unique (user_id, period)
);

-- ---------------------------------------------------------------------------
-- row level security
-- ---------------------------------------------------------------------------
alter table public.users enable row level security;
create policy users_self_select on public.users for select using (id = auth.uid());
create policy users_self_update on public.users for update using (id = auth.uid()) with check (id = auth.uid());

alter table public.companies enable row level security;
create policy companies_owner_all on public.companies for all
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());

alter table public.connections enable row level security;
create policy connections_owner_all on public.connections for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

alter table public.usage enable row level security;
create policy usage_owner_select on public.usage for select using (user_id = auth.uid());

-- company-scoped: full access for the owner (append-only rules are triggers, so
-- they bind the service role as well).
do $$
declare t text;
begin
  foreach t in array array[
    'theses', 'goals', 'budgets', 'agents', 'plans', 'tasks', 'decision_cards',
    'auto_rules', 'actions', 'signals', 'metrics', 'ledger_entries', 'memory_items',
    'artifacts', 'briefs', 'agent_runs', 'audit_tool_calls'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format(
      'create policy %I on public.%I for all using (public.is_company_owner(company_id)) with check (public.is_company_owner(company_id))',
      t || '_owner_all', t
    );
  end loop;
end $$;
