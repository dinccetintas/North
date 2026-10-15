-- M4 growth, sales and the outcome ledger (docs/plans/M4.md, WP-A4):
--   * campaigns: one summary row per executed ads.start (owners read, the
--     worker writes); the trigger keeps an activation inside the ads budget;
--   * metric samples carry a scope (company | channel) and provenance; the
--     unique partial index makes a retried collection window a no-op;
--   * ledger entries carry provenance and their campaign/action;
--   * budgets gain today's cap raise (daily_extra_usd); owners may change the
--     two limits only, spend columns are written by apply_budget_spend;
--   * leads fed by CSV upload (owner) and lead_research (worker);
--   * apply_budget_spend / raise_daily_cap / raise_total_cap / record_attribution
--     (security definer, service role only). BUD-1 "in the database".
-- Every constraint and trigger from earlier migrations stays.

-- ---------------------------------------------------------------------------
-- tasks and artifacts: lead_research (sales) and lead_list. Mirrors
-- TASK_TYPES / ARTIFACT_KINDS in packages/core/src/tasks/types.ts.
-- ---------------------------------------------------------------------------
alter table public.tasks drop constraint tasks_task_type_check;
alter table public.tasks
  add constraint tasks_task_type_check check (task_type in (
    'market_report', 'personas', 'competitor_map', 'prd', 'business_plan',
    'investor_deck', 'brand_kit', 'screen_designs', 'build_site',
    'campaign_spec', 'lead_research', 'outreach_batch', 'plan_week', 'brief'
  ));
alter table public.artifacts
  add constraint artifacts_kind_check check (kind in (
    'market_report', 'personas', 'competitor_map', 'prd', 'business_plan',
    'investor_deck', 'brand_kit', 'screen_designs', 'build_report',
    'campaign_spec', 'lead_list', 'outreach_batch', 'plan', 'brief', 'doc'
  ));

-- ---------------------------------------------------------------------------
-- budgets: today's cap raise (BUD-3) and owner writes limited to the limits.
-- ---------------------------------------------------------------------------
alter table public.budgets
  add column daily_extra_usd numeric not null default 0 check (daily_extra_usd >= 0),
  add column daily_extra_date date not null default current_date;

revoke insert, update, delete on public.budgets from authenticated, anon;
grant insert (company_id, category, total_limit_usd, daily_limit_usd) on public.budgets to authenticated;
-- PostgREST's upsert also assigns the conflict key in its DO UPDATE SET, so the
-- key columns are granted too; RLS keeps company_id inside the owner's companies.
grant update (company_id, category, total_limit_usd, daily_limit_usd) on public.budgets to authenticated;

-- ---------------------------------------------------------------------------
-- metrics: scope and provenance (OUT-2). Owners read; the worker writes.
-- ---------------------------------------------------------------------------
alter table public.metrics
  add column scope text not null default 'company' check (scope in ('company', 'channel')),
  add column provenance jsonb,
  add column provenance_key text check (char_length(provenance_key) between 1 and 300),
  add column window_end timestamptz,
  add constraint metrics_channel_has_provenance check (
    (scope = 'channel' and provenance is not null and provenance_key is not null and window_end is not null)
    or (scope = 'company' and provenance is null and provenance_key is null and window_end is null)
  );
create unique index metrics_channel_window_idx
  on public.metrics (company_id, metric_key, provenance_key, window_end) where scope = 'channel';
create index metrics_channel_series_idx
  on public.metrics (company_id, provenance_key, measured_at desc) where scope = 'channel';

drop policy if exists metrics_owner_all on public.metrics;
create policy metrics_owner_select on public.metrics for select using (public.is_company_owner(company_id));
revoke insert, update, delete on public.metrics from authenticated, anon;

-- ---------------------------------------------------------------------------
-- campaigns: the stable key with a status the collector, the cap logic, the
-- kill switch and the ledger page share. The audit stays in actions.
-- ---------------------------------------------------------------------------
create table public.campaigns (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  task_id uuid references public.tasks(id) on delete set null,
  action_id uuid not null unique references public.actions(id) on delete restrict,
  provider text not null check (provider in ('meta_ads', 'google_ads')),
  provider_campaign_id text not null check (char_length(provider_campaign_id) between 1 and 200),
  name text not null check (char_length(name) between 1 and 200),
  channel text not null check (channel in ('meta_ads', 'google_ads')),
  metric_key text not null check (char_length(metric_key) between 1 and 60),
  daily_budget_usd numeric not null check (daily_budget_usd >= 0),
  total_budget_usd numeric not null check (total_budget_usd >= 0),
  landing_url text not null default '' check (char_length(landing_url) <= 2048),
  status text not null default 'active' check (status in ('active', 'paused_cap', 'paused_kill', 'paused_user', 'ended')),
  paused_day date,
  spent_today_usd numeric not null default 0 check (spent_today_usd >= 0),
  spent_total_usd numeric not null default 0 check (spent_total_usd >= 0),
  impressions bigint not null default 0 check (impressions >= 0),
  clicks bigint not null default 0 check (clicks >= 0),
  conversions bigint not null default 0 check (conversions >= 0),
  last_collected_at timestamptz,
  last_error text check (char_length(last_error) <= 2000),
  sandbox boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, provider_campaign_id)
);
create index campaigns_company_status_idx on public.campaigns (company_id, status);
create trigger campaigns_updated_at before update on public.campaigns for each row execute function public.set_updated_at();

alter table public.campaigns enable row level security;
create policy campaigns_owner_select on public.campaigns for select using (public.is_company_owner(company_id));
revoke insert, update, delete on public.campaigns from authenticated, anon;

-- BUD-1 in the database: a campaign cannot become (or stay, with a bigger
-- daily budget) active unless its daily budget fits today's effective ads cap
-- (daily_limit + today's extra) and neither cap is already reached. The spend
-- already made today is not subtracted: after a cap raise the campaign resumes
-- with its original daily budget against the raised cap.
create or replace function public.campaigns_within_budget() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  b public.budgets%rowtype;
  spent_today numeric;
  extra numeric;
begin
  if new.status <> 'active' then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.status = 'active' and old.daily_budget_usd = new.daily_budget_usd then
    return new;
  end if;
  select * into b from public.budgets where company_id = new.company_id and category = 'ads';
  if not found then
    raise exception 'budget_cap' using errcode = 'check_violation', detail = 'no ads budget for this company';
  end if;
  spent_today := case when b.spent_today_date = current_date then b.spent_today_usd else 0 end;
  extra := case when b.daily_extra_date = current_date then b.daily_extra_usd else 0 end;
  if new.daily_budget_usd > b.daily_limit_usd + extra then
    raise exception 'budget_cap' using errcode = 'check_violation',
      detail = format('daily budget %s exceeds the effective daily cap %s', new.daily_budget_usd, b.daily_limit_usd + extra);
  end if;
  if spent_today >= b.daily_limit_usd + extra then
    raise exception 'budget_cap' using errcode = 'check_violation',
      detail = format('today''s ads cap %s is spent (%s)', b.daily_limit_usd + extra, spent_today);
  end if;
  if b.spent_total_usd >= b.total_limit_usd then
    raise exception 'budget_cap' using errcode = 'check_violation',
      detail = format('the ads total cap %s is spent (%s)', b.total_limit_usd, b.spent_total_usd);
  end if;
  return new;
end $$;
create trigger campaigns_within_budget before insert or update of status, daily_budget_usd on public.campaigns
  for each row execute function public.campaigns_within_budget();

-- ---------------------------------------------------------------------------
-- ledger_entries: provenance and links (OUT-1). Append-only stays; owners read.
-- ---------------------------------------------------------------------------
alter table public.ledger_entries
  add column provenance jsonb,
  add column campaign_id uuid references public.campaigns(id) on delete restrict,
  add column action_id uuid references public.actions(id) on delete restrict;
create index ledger_entries_campaign_idx on public.ledger_entries (campaign_id) where campaign_id is not null;

drop policy if exists ledger_entries_owner_all on public.ledger_entries;
create policy ledger_entries_owner_select on public.ledger_entries for select using (public.is_company_owner(company_id));
revoke insert, update, delete on public.ledger_entries from authenticated, anon;

-- ---------------------------------------------------------------------------
-- leads: CSV upload (owner) and lead_research (worker). Owners insert upload
-- rows and read; status changes are the worker's.
-- ---------------------------------------------------------------------------
create table public.leads (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  email text not null check (char_length(email) between 3 and 254 and email = lower(email) and email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  company_name text not null default '' check (char_length(company_name) <= 120),
  why text not null default '' check (char_length(why) <= 500),
  source text not null check (source in ('upload', 'research')),
  status text not null default 'new' check (status in ('new', 'contacted', 'replied', 'bounced', 'opted_out')),
  batch_id text check (char_length(batch_id) between 1 and 64),
  message_id text check (char_length(message_id) between 1 and 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, email)
);
create index leads_company_status_idx on public.leads (company_id, status, created_at);
create trigger leads_updated_at before update on public.leads for each row execute function public.set_updated_at();

alter table public.leads enable row level security;
create policy leads_owner_select on public.leads for select using (public.is_company_owner(company_id));
create policy leads_owner_insert_upload on public.leads for insert
  with check (public.is_company_owner(company_id) and source = 'upload' and status = 'new' and batch_id is null and message_id is null);
revoke update, delete on public.leads from authenticated, anon;

-- ---------------------------------------------------------------------------
-- budget accounting (BUD-1). One locked update per call: the day rolls
-- forward when a later day is applied (spent_today and the extra reset); a
-- window from an earlier day counts against the total only. budget_apply is
-- internal (no API role may call it); the three public wrappers are the
-- worker's (service role).
-- ---------------------------------------------------------------------------
create or replace function public.budget_apply(p_company_id uuid, p_category text, p_day date, p_spend numeric, p_extra numeric, p_total numeric) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  b public.budgets%rowtype;
  d date := coalesce(p_day, current_date);
begin
  if p_spend < 0 or p_extra < 0 or p_total < 0 then
    raise exception 'budget amounts must be zero or more' using errcode = 'check_violation';
  end if;
  select * into b from public.budgets where company_id = p_company_id and category = p_category for update;
  if not found then
    raise exception 'no % budget for company %', p_category, p_company_id using errcode = 'no_data_found';
  end if;
  if d > b.spent_today_date then
    b.spent_today_usd := 0;
    b.spent_today_date := d;
  end if;
  if d > b.daily_extra_date then
    b.daily_extra_usd := 0;
    b.daily_extra_date := d;
  end if;
  if d >= b.spent_today_date then
    b.spent_today_usd := b.spent_today_usd + p_spend;
  end if;
  b.spent_total_usd := b.spent_total_usd + p_spend;
  b.daily_extra_usd := b.daily_extra_usd + p_extra;
  b.total_limit_usd := b.total_limit_usd + p_total;
  update public.budgets
     set spent_today_usd = b.spent_today_usd, spent_today_date = b.spent_today_date,
         spent_total_usd = b.spent_total_usd, daily_extra_usd = b.daily_extra_usd,
         daily_extra_date = b.daily_extra_date, total_limit_usd = b.total_limit_usd
   where id = b.id;
  return jsonb_build_object(
    'spent_today', b.spent_today_usd,
    'spent_total', b.spent_total_usd,
    'daily_extra', b.daily_extra_usd,
    'daily_limit_effective', b.daily_limit_usd + b.daily_extra_usd,
    'total_limit', b.total_limit_usd,
    'cap_daily', b.spent_today_usd >= b.daily_limit_usd + b.daily_extra_usd,
    'cap_total', b.spent_total_usd >= b.total_limit_usd
  );
end $$;

create or replace function public.apply_budget_spend(p_company_id uuid, p_category text, p_amount numeric, p_day date default current_date) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if p_amount is null or p_amount < 0 then
    raise exception 'apply_budget_spend: amount must be zero or more' using errcode = 'check_violation';
  end if;
  return public.budget_apply(p_company_id, p_category, p_day, p_amount, 0, 0);
end $$;

create or replace function public.raise_daily_cap(p_company_id uuid, p_category text, p_amount numeric, p_day date default current_date) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if p_amount is null or p_amount < 0 then
    raise exception 'raise_daily_cap: amount must be zero or more' using errcode = 'check_violation';
  end if;
  return public.budget_apply(p_company_id, p_category, p_day, 0, p_amount, 0);
end $$;

create or replace function public.raise_total_cap(p_company_id uuid, p_category text, p_amount numeric) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if p_amount is null or p_amount < 0 then
    raise exception 'raise_total_cap: amount must be zero or more' using errcode = 'check_violation';
  end if;
  return public.budget_apply(p_company_id, p_category, current_date, 0, 0, p_amount);
end $$;

-- ---------------------------------------------------------------------------
-- record_attribution (OUT-1/OUT-2, BUD-1): one collection window in one
-- transaction. payload: { company_id, task_id?, campaign_id?, action_id?,
-- metric_key, channel, provenance_key, provenance, window_end, source,
-- samples [{ metric_key, value }], before, after, cost_usd, category?, day?,
-- note? }. Returns { duplicate, entry_id, cap_daily, cap_total }. A window
-- already recorded for (company, metric, provenance key, window end) is a
-- duplicate: nothing is written and the current cap state is returned.
-- ---------------------------------------------------------------------------
create or replace function public.record_attribution(payload jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_company uuid := (payload->>'company_id')::uuid;
  v_metric text := payload->>'metric_key';
  v_key text := payload->>'provenance_key';
  v_window timestamptz := (payload->>'window_end')::timestamptz;
  v_cost numeric := coalesce((payload->>'cost_usd')::numeric, 0);
  v_category text := payload->>'category';
  v_day date := coalesce((payload->>'day')::date, current_date);
  v_source text := coalesce(payload->>'source', payload->>'channel');
  v_caps jsonb := jsonb_build_object('cap_daily', false, 'cap_total', false);
  v_state jsonb;
  v_sample jsonb;
  v_entry uuid;
begin
  if v_company is null or v_metric is null or v_key is null or v_window is null or payload->'provenance' is null or payload->>'channel' is null then
    raise exception 'record_attribution: company_id, metric_key, channel, provenance, provenance_key and window_end are required'
      using errcode = 'invalid_parameter_value';
  end if;
  if v_cost < 0 then
    raise exception 'record_attribution: negative cost' using errcode = 'check_violation';
  end if;
  perform pg_advisory_xact_lock(hashtext(v_company::text || ':' || v_key));

  if exists (
    select 1 from public.metrics m
     where m.company_id = v_company and m.scope = 'channel' and m.metric_key = v_metric and m.provenance_key = v_key and m.window_end = v_window
  ) then
    if v_category is not null then
      v_state := public.budget_apply(v_company, v_category, v_day, 0, 0, 0);
      v_caps := jsonb_build_object('cap_daily', v_state->'cap_daily', 'cap_total', v_state->'cap_total');
    end if;
    return jsonb_build_object('duplicate', true, 'entry_id', null) || v_caps;
  end if;

  for v_sample in select * from jsonb_array_elements(coalesce(payload->'samples', '[]'::jsonb)) loop
    insert into public.metrics (company_id, metric_key, value, source, measured_at, scope, provenance, provenance_key, window_end)
    values (v_company, v_sample->>'metric_key', (v_sample->>'value')::numeric, v_source, v_window, 'channel', payload->'provenance', v_key, v_window)
    on conflict (company_id, metric_key, provenance_key, window_end) where scope = 'channel' do nothing;
  end loop;
  insert into public.metrics (company_id, metric_key, value, source, measured_at, scope, provenance, provenance_key, window_end)
  values (v_company, v_metric, (payload->>'after')::numeric, v_source, v_window, 'channel', payload->'provenance', v_key, v_window)
  on conflict (company_id, metric_key, provenance_key, window_end) where scope = 'channel' do nothing;

  insert into public.ledger_entries (company_id, task_id, metric_key, before_value, after_value, cost_usd, channel, attribution_note, provenance, campaign_id, action_id)
  values (
    v_company, (payload->>'task_id')::uuid, v_metric, (payload->>'before')::numeric, (payload->>'after')::numeric, v_cost,
    payload->>'channel', coalesce(payload->>'note', ''), payload->'provenance', (payload->>'campaign_id')::uuid, (payload->>'action_id')::uuid
  )
  returning id into v_entry;

  if v_category is not null then
    v_state := public.budget_apply(v_company, v_category, v_day, v_cost, 0, 0);
    v_caps := jsonb_build_object('cap_daily', v_state->'cap_daily', 'cap_total', v_state->'cap_total');
  end if;
  return jsonb_build_object('duplicate', false, 'entry_id', v_entry) || v_caps;
end $$;

-- Spend accounting and attribution are the worker's only (service role);
-- budget_apply is reachable only through them.
revoke execute on function public.budget_apply(uuid, text, date, numeric, numeric, numeric) from public, anon, authenticated, service_role;
revoke execute on function public.apply_budget_spend(uuid, text, numeric, date) from public, anon, authenticated;
revoke execute on function public.raise_daily_cap(uuid, text, numeric, date) from public, anon, authenticated;
revoke execute on function public.raise_total_cap(uuid, text, numeric) from public, anon, authenticated;
revoke execute on function public.record_attribution(jsonb) from public, anon, authenticated;
grant execute on function public.apply_budget_spend(uuid, text, numeric, date) to service_role;
grant execute on function public.raise_daily_cap(uuid, text, numeric, date) to service_role;
grant execute on function public.raise_total_cap(uuid, text, numeric) to service_role;
grant execute on function public.record_attribution(jsonb) to service_role;
