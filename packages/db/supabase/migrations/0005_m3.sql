-- M3 build and design (docs/plans/M3.md, WP-A3): engineering and design task
-- types, connection metadata the owner can see, and connection secrets that
-- only the service role can touch (ADR 0008).

-- ---------------------------------------------------------------------------
-- tasks: build_site (engineering) and screen_designs (design). Mirrors
-- TASK_TYPES in packages/core/src/tasks/types.ts.
-- ---------------------------------------------------------------------------
alter table public.tasks drop constraint tasks_task_type_check;
alter table public.tasks
  add constraint tasks_task_type_check check (task_type in (
    'market_report', 'personas', 'competitor_map', 'prd', 'business_plan',
    'investor_deck', 'brand_kit', 'screen_designs', 'build_site',
    'campaign_spec', 'outreach_batch', 'plan_week', 'brief'
  ));

-- ---------------------------------------------------------------------------
-- connections: what the owner sees. Provider list mirrors CONNECTION_PROVIDERS.
-- ---------------------------------------------------------------------------
alter table public.connections
  add column account_label text not null default '' check (char_length(account_label) <= 200),
  add column updated_at timestamptz not null default now(),
  add constraint connections_provider_check check (provider in ('github', 'vercel', 'gmail', 'stripe', 'meta_ads'));
create trigger connections_updated_at before update on public.connections for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- connection_secrets: AES-256-GCM ciphertext written by the web callback and
-- read by the worker, both through the service role. RLS is on and there are
-- deliberately no policies: owners (and everyone else) see nothing.
-- ---------------------------------------------------------------------------
create table public.connection_secrets (
  connection_id uuid primary key references public.connections(id) on delete cascade,
  ciphertext text not null check (char_length(ciphertext) between 1 and 65536),
  iv text not null check (char_length(iv) between 1 and 64),
  tag text not null check (char_length(tag) between 1 and 64),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger connection_secrets_updated_at before update on public.connection_secrets for each row execute function public.set_updated_at();
alter table public.connection_secrets enable row level security;
revoke all on public.connection_secrets from anon, authenticated;
