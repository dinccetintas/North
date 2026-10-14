-- M2 decision layer (docs/plans/M2.md, WP-A2): K2 task types, cards linked to
-- actions, append-only action state chains, push subscriptions and the
-- notification log. Every constraint and trigger from earlier migrations stays.

-- ---------------------------------------------------------------------------
-- tasks: the two K2 task types that exercise the decision layer end to end.
-- The list mirrors TASK_TYPES in packages/core/src/tasks/types.ts.
-- ---------------------------------------------------------------------------
alter table public.tasks drop constraint tasks_task_type_check;
alter table public.tasks
  add constraint tasks_task_type_check check (task_type in (
    'market_report', 'personas', 'competitor_map', 'prd', 'business_plan',
    'investor_deck', 'brand_kit', 'campaign_spec', 'outreach_batch', 'plan_week', 'brief'
  ));

-- ---------------------------------------------------------------------------
-- decision_cards: the action a card decides on, and the merge key the quota
-- planner uses to fold siblings (DEC-3).
-- ---------------------------------------------------------------------------
alter table public.decision_cards
  add column action_id uuid references public.actions(id) on delete set null,
  add column merge_key text not null default '';
create index decision_cards_answered_kind_idx
  on public.decision_cards (company_id, action_kind, answered_at desc);

-- ---------------------------------------------------------------------------
-- actions: status changes are new rows pointing at the row they supersede, so
-- the table stays append-only. The unique index keeps every chain linear: an
-- action can be superseded by at most one row.
-- ---------------------------------------------------------------------------
alter table public.actions
  add column supersedes uuid references public.actions(id) on delete restrict;
create unique index actions_supersedes_idx on public.actions (supersedes);

-- ---------------------------------------------------------------------------
-- push_subscriptions: one browser endpoint per row, scoped to the user.
-- ---------------------------------------------------------------------------
create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  endpoint text not null unique check (char_length(endpoint) between 1 and 2048),
  p256dh text not null check (char_length(p256dh) between 1 and 512),
  auth text not null check (char_length(auth) between 1 and 512),
  created_at timestamptz not null default now()
);
create index push_subscriptions_user_idx on public.push_subscriptions (user_id);

alter table public.push_subscriptions enable row level security;
create policy push_subscriptions_owner_all on public.push_subscriptions for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- notifications: what was sent (or recorded in sandbox) for which card.
-- Owners read their company's log; only the worker (service role) writes.
-- ---------------------------------------------------------------------------
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  channel text not null check (channel in ('push', 'email')),
  kind text not null check (char_length(kind) between 1 and 100),
  card_id uuid references public.decision_cards(id) on delete set null,
  payload jsonb not null default '{}'::jsonb,
  status text not null check (status in ('sent', 'failed', 'sandbox')),
  created_at timestamptz not null default now()
);
create index notifications_company_created_idx on public.notifications (company_id, created_at desc);

alter table public.notifications enable row level security;
create policy notifications_owner_select on public.notifications for select
  using (public.is_company_owner(company_id));
