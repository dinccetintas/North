-- M6 subscription and launch (docs/plans/M6.md, WP-A6 A6-1; ADR 0014, 0016):
--   * users: the brief hour (BRF-1); owners write their settings columns only;
--   * entitlements: one row per user, written by the worker from billing
--     events, read by the owner; a 14-day Solo trial for every user, existing
--     ones included; users.plan mirrors plan_id (BIL-1);
--   * billing_events (append-only, worker only) and billing_sessions (the
--     owner requests, the worker fulfils) (BIL-1);
--   * credit_entries: an append-only ledger with the overdraft floor; usage as
--     an additive projection written through usage_apply (BIL-2);
--   * companies: paused_reason and archived_at; the company limit at creation;
--     a billing pause or the archive the owner cannot lift (BIL-1, RET-1).
-- 0013_m6_pages_exports_purge.sql holds the rest of A6-1 (public page,
-- exports, purge_owner, trace id); 0014_m6_budget_day.sql holds A6-6. Split
-- for the 400-line rule. Every constraint and trigger from earlier migrations stays.

-- ---------------------------------------------------------------------------
-- users: the brief hour; settings columns are the owner's only writes
-- ---------------------------------------------------------------------------
alter table public.users
  add column brief_hour int not null default 7 check (brief_hour between 0 and 23);

-- users.plan becomes a mirror (trigger below); the 0001 policy let owners write
-- every column of their row. Mirrors 0011 for companies: fail closed.
revoke update on public.users from authenticated, anon;
grant update (timezone, daily_decision_quota, brief_hour) on public.users to authenticated;

-- ---------------------------------------------------------------------------
-- entitlements (BIL-1): the projection of billing events. Vocabularies mirror
-- SUBSCRIPTION_PLAN_IDS / ENTITLEMENT_STATUSES in packages/core/src/billing.
-- ---------------------------------------------------------------------------
create table public.entitlements (
  user_id uuid primary key references public.users(id) on delete cascade,
  plan_id text not null check (plan_id in ('solo', 'pro', 'scale')),
  status text not null check (status in ('trialing', 'active', 'past_due', 'canceled', 'ended')),
  company_limit int not null check (company_limit between 1 and 1000),
  monthly_credits int not null check (monthly_credits >= 0),
  price_usd numeric not null default 0 check (price_usd >= 0),
  period_start timestamptz not null,
  period_end timestamptz not null,
  cancel_at timestamptz,
  stripe_customer_id text unique check (char_length(stripe_customer_id) between 1 and 200),
  stripe_subscription_id text unique check (char_length(stripe_subscription_id) between 1 and 200),
  ended_at timestamptz,
  retention_until timestamptz,
  purge_due boolean not null default false,
  last_event_created bigint check (last_event_created >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint entitlements_period_order check (period_end >= period_start),
  constraint entitlements_ended_has_dates check (status <> 'ended' or (ended_at is not null and retention_until is not null))
);
create index entitlements_status_idx on public.entitlements (status, period_end);
create trigger entitlements_updated_at before update on public.entitlements for each row execute function public.set_updated_at();

alter table public.entitlements enable row level security;
create policy entitlements_owner_select on public.entitlements for select using (user_id = auth.uid());
revoke insert, update, delete on public.entitlements from authenticated, anon;

create or replace function public.entitlements_mirror_plan() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update public.users set plan = new.plan_id where id = new.user_id and plan is distinct from new.plan_id;
  return null;
end $$;
create trigger entitlements_mirror_plan after insert or update of plan_id on public.entitlements
  for each row execute function public.entitlements_mirror_plan();

-- ---------------------------------------------------------------------------
-- credit_entries (BIL-2): an append-only ledger; the balance is a sum. Kinds
-- and signs mirror CREDIT_ENTRY_KINDS and CreditEntryDraftSchema.
-- ---------------------------------------------------------------------------
create table public.credit_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  kind text not null check (kind in ('grant_plan', 'grant_pack', 'consume', 'expire', 'adjust')),
  amount int not null,
  ref text not null check (char_length(ref) between 1 and 200),
  note text not null default '' check (char_length(note) <= 500),
  created_at timestamptz not null default now(),
  unique (user_id, ref),
  constraint credit_entries_amount_sign check (
    (kind in ('grant_plan', 'grant_pack') and amount > 0)
    or (kind in ('consume', 'expire') and amount < 0)
    or (kind = 'adjust' and amount <> 0)
  )
);
create index credit_entries_user_created_idx on public.credit_entries (user_id, created_at desc);
create trigger credit_entries_append_only before update or delete on public.credit_entries
  for each row execute function public.forbid_change();

alter table public.credit_entries enable row level security;
create policy credit_entries_owner_select on public.credit_entries for select using (user_id = auth.uid());
revoke insert, update, delete on public.credit_entries from authenticated, anon;

-- Runs as the caller: an owner sums their own rows (a stranger's sum is 0).
create or replace function public.credit_balance(p_user_id uuid) returns int
language sql stable security invoker set search_path = public as $$
  select coalesce(sum(amount), 0)::int from public.credit_entries where user_id = p_user_id;
$$;
revoke execute on function public.credit_balance(uuid) from public, anon;
grant execute on function public.credit_balance(uuid) to authenticated, service_role;

-- Dispatch refuses at a balance of 0; this backs it under concurrency: one
-- consume at a time per user, never below -CREDIT_GRACE (5). A replayed ref is
-- left to the unique key (a no-op under `on conflict do nothing`).
create or replace function public.credit_entries_no_overdraft() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_balance int;
begin
  if new.kind <> 'consume' then
    return new;
  end if;
  perform pg_advisory_xact_lock(hashtext('credits:' || new.user_id::text));
  if exists (select 1 from public.credit_entries where user_id = new.user_id and ref = new.ref) then
    return new;
  end if;
  select coalesce(sum(amount), 0) into v_balance from public.credit_entries where user_id = new.user_id;
  if v_balance + new.amount < -5 then
    raise exception 'credits: a consume of % would take the balance from % below -5', -new.amount, v_balance
      using errcode = 'check_violation', hint = 'credit_floor';
  end if;
  return new;
end $$;
create trigger credit_entries_no_overdraft before insert on public.credit_entries
  for each row execute function public.credit_entries_no_overdraft();

-- ---------------------------------------------------------------------------
-- the trial (ADR 0014): mirrors trialEntitlement / trialGrant in core
-- (TRIAL_DAYS 14 exactly, Solo: 1 company, 300 credits, no price);
-- schemaM6.test.ts compares the two. Every new user gets it from the auth
-- trigger; every existing user is backfilled once, here.
-- ---------------------------------------------------------------------------
create or replace function public.grant_trial_entitlement(p_user_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  insert into public.entitlements (user_id, plan_id, status, company_limit, monthly_credits, price_usd, period_start, period_end)
  values (p_user_id, 'solo', 'trialing', 1, 300, 0, now(), now() + 14 * interval '24 hours')
  on conflict (user_id) do nothing;
  insert into public.credit_entries (user_id, kind, amount, ref, note)
  values (p_user_id, 'grant_plan', 300, 'trial:' || p_user_id::text, 'Solo trial')
  on conflict (user_id, ref) do nothing;
end $$;
revoke execute on function public.grant_trial_entitlement(uuid) from public, anon, authenticated;
grant execute on function public.grant_trial_entitlement(uuid) to service_role;

create or replace function public.handle_new_auth_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.users (id, email) values (new.id, coalesce(new.email, ''))
  on conflict (id) do nothing;
  perform public.grant_trial_entitlement(new.id);
  return new;
end $$;

do $$ begin perform public.grant_trial_entitlement(u.id) from public.users u; end $$;

alter table public.users alter column plan set default 'solo';
alter table public.users add constraint users_plan_check check (plan in ('solo', 'pro', 'scale'));

-- ---------------------------------------------------------------------------
-- billing_events (BIL-1): every accepted Stripe event, stored before it is
-- applied. Append-only except `applied_at`, set once. Worker only: RLS on, no
-- policies, no grants for signed-in or anonymous callers.
-- ---------------------------------------------------------------------------
create table public.billing_events (
  id uuid primary key default gen_random_uuid(),
  event_id text not null unique check (char_length(event_id) between 1 and 200),
  type text not null check (type in (
    'checkout.session.completed', 'customer.subscription.created', 'customer.subscription.updated',
    'customer.subscription.deleted', 'invoice.paid', 'invoice.payment_failed'
  )),
  user_id uuid references public.users(id) on delete cascade,
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  received_at timestamptz not null default now(),
  applied_at timestamptz
);
create index billing_events_user_idx on public.billing_events (user_id, received_at desc);

create or replace function public.billing_events_append_only() returns trigger
language plpgsql as $$
begin
  if tg_op = 'UPDATE' and old.applied_at is null and new.applied_at is not null
     and (new.id, new.event_id, new.type, new.received_at) = (old.id, old.event_id, old.type, old.received_at)
     and new.user_id is not distinct from old.user_id and new.payload = old.payload then
    return new;
  end if;
  raise exception 'append-only table: % rows cannot be updated or deleted', tg_table_name
    using errcode = 'restrict_violation';
end $$;
create trigger billing_events_append_only before update or delete on public.billing_events
  for each row execute function public.billing_events_append_only();

alter table public.billing_events enable row level security;
revoke all on public.billing_events from anon, authenticated;

-- ---------------------------------------------------------------------------
-- billing_sessions (BIL-1): the owner inserts a `requested` row; the worker,
-- which alone holds the Stripe key, writes the url or a fixed error.
-- ---------------------------------------------------------------------------
create table public.billing_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  kind text not null check (kind in ('checkout', 'portal', 'credit_pack')),
  plan_id text check (plan_id in ('solo', 'pro', 'scale')),
  pack_id text check (pack_id ~ '^[a-z0-9_]{1,40}$'),
  status text not null default 'requested' check (status in ('requested', 'ready', 'failed')),
  url text check (char_length(url) between 1 and 2048),
  provider_ref text check (char_length(provider_ref) between 1 and 200),
  error text check (char_length(error) between 1 and 300),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint billing_sessions_kind_fields check (
    (kind = 'checkout' and plan_id is not null and pack_id is null)
    or (kind = 'credit_pack' and pack_id is not null and plan_id is null)
    or (kind = 'portal' and plan_id is null and pack_id is null)
  ),
  constraint billing_sessions_ready_has_url check (status <> 'ready' or url is not null)
);
create index billing_sessions_user_idx on public.billing_sessions (user_id, created_at desc);
create trigger billing_sessions_updated_at before update on public.billing_sessions for each row execute function public.set_updated_at();

alter table public.billing_sessions enable row level security;
create policy billing_sessions_owner_select on public.billing_sessions for select using (user_id = auth.uid());
create policy billing_sessions_owner_insert on public.billing_sessions for insert
  with check (user_id = auth.uid() and status = 'requested' and url is null and provider_ref is null and error is null);
revoke insert, update, delete on public.billing_sessions from authenticated, anon;
grant insert (user_id, kind, plan_id, pack_id) on public.billing_sessions to authenticated;

-- ---------------------------------------------------------------------------
-- usage (BIL-2): a projection per user and owner-local month, written only
-- through usage_apply (service role; the apply_budget_spend pattern).
-- ---------------------------------------------------------------------------
alter table public.usage
  add column alerted_at timestamptz,
  add column updated_at timestamptz not null default now(),
  add constraint usage_credits_used_check check (credits_used >= 0),
  add constraint usage_llm_cost_check check (llm_cost_usd >= 0),
  add constraint usage_sandbox_minutes_check check (sandbox_minutes >= 0);
create trigger usage_updated_at before update on public.usage for each row execute function public.set_updated_at();
revoke insert, update, delete on public.usage from authenticated, anon;

create or replace function public.usage_apply(p_user_id uuid, p_period text, p_credits int, p_cost_usd numeric, p_sandbox_minutes numeric) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_row public.usage%rowtype;
begin
  if p_user_id is null or p_period is null or p_period !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' then
    raise exception 'usage_apply: a user and a YYYY-MM period are required' using errcode = 'invalid_parameter_value';
  end if;
  if coalesce(p_credits, -1) < 0 or coalesce(p_cost_usd, -1) < 0 or coalesce(p_sandbox_minutes, -1) < 0 then
    raise exception 'usage_apply: amounts must be zero or more' using errcode = 'check_violation';
  end if;
  insert into public.usage as u (user_id, period, credits_used, llm_cost_usd, sandbox_minutes)
  values (p_user_id, p_period, p_credits, p_cost_usd, p_sandbox_minutes)
  on conflict (user_id, period) do update
    set credits_used = u.credits_used + excluded.credits_used,
        llm_cost_usd = u.llm_cost_usd + excluded.llm_cost_usd,
        sandbox_minutes = u.sandbox_minutes + excluded.sandbox_minutes
  returning * into v_row;
  return to_jsonb(v_row);
end $$;
revoke execute on function public.usage_apply(uuid, text, int, numeric, numeric) from public, anon, authenticated;
grant execute on function public.usage_apply(uuid, text, int, numeric, numeric) to service_role;

-- ---------------------------------------------------------------------------
-- companies: why the switch is on (PAUSED_REASONS) and when the sweep
-- archived it. Neither is granted to owners (0011's list stands): the owner's
-- switch is recorded as `user` by the trigger, billing and retention by the
-- worker. Owners insert only the three columns createCompany writes.
-- ---------------------------------------------------------------------------
alter table public.companies
  add column paused_reason text check (paused_reason in ('user', 'subscription_ended', 'retention')),
  add column archived_at timestamptz;
update public.companies set paused_reason = 'user' where kill_switch_active;
update public.companies set archived_at = updated_at where status = 'archived';
alter table public.companies
  add constraint companies_paused_reason_needs_switch check (paused_reason is null or kill_switch_active),
  add constraint companies_archived_at_matches check ((status = 'archived') = (archived_at is not null));

revoke insert on public.companies from authenticated, anon;
grant insert (owner_id, name, slug) on public.companies to authenticated;

-- Who may lift a pause: the owner lifts their own; a billing pause or the
-- archive is cleared by the worker (service role) alone. The function runs as
-- the caller, so current_user is the API role.
create or replace function public.companies_pause_state() returns trigger
language plpgsql as $$
begin
  if current_user not in ('service_role', 'postgres', 'supabase_admin')
     and (new.kill_switch_active is distinct from old.kill_switch_active or new.status is distinct from old.status) then
    if old.paused_reason in ('subscription_ended', 'retention') or old.status = 'archived' then
      raise exception 'company %: paused by billing; subscribe to resume', old.id
        using errcode = 'check_violation', hint = 'paused_by_billing';
    end if;
    if new.status = 'archived' then
      raise exception 'company %: only the retention sweep archives a company', old.id using errcode = 'check_violation';
    end if;
  end if;
  if not new.kill_switch_active then
    new.paused_reason := null;
  elsif new.paused_reason is null then
    new.paused_reason := 'user';
  end if;
  new.archived_at := case when new.status = 'archived' then coalesce(new.archived_at, now()) end;
  return new;
end $$;
create trigger companies_pause_state before update on public.companies
  for each row execute function public.companies_pause_state();

-- BIL-1 at creation (never at run time): an active entitlement and fewer
-- non-archived companies than its limit, under a lock on the owner. Binds the
-- service role too. Another owner's id is refused first, so the message never
-- describes someone else's plan.
create or replace function public.companies_within_entitlement() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  e public.entitlements%rowtype;
  v_running int;
begin
  if auth.uid() is not null and new.owner_id is distinct from auth.uid() then
    raise exception 'new row violates row-level security policy for table "companies"' using errcode = 'insufficient_privilege';
  end if;
  perform pg_advisory_xact_lock(hashtext('owner:' || new.owner_id::text));
  select * into e from public.entitlements where user_id = new.owner_id;
  if not found or e.status = 'ended' then
    raise exception 'entitlement: the subscription has ended; subscribe to create a company'
      using errcode = 'check_violation', hint = 'entitlement_ended';
  end if;
  select count(*) into v_running from public.companies where owner_id = new.owner_id and status <> 'archived';
  if v_running >= e.company_limit then
    raise exception 'entitlement: % includes % %', initcap(e.plan_id), e.company_limit, case when e.company_limit = 1 then 'company' else 'companies' end
      using errcode = 'check_violation', hint = 'entitlement_limit', detail = format('%s of %s in use', v_running, e.company_limit);
  end if;
  return new;
end $$;
create trigger companies_within_entitlement before insert on public.companies
  for each row execute function public.companies_within_entitlement();
