-- M5 proactive layer (docs/plans/M5.md, WP-A5; ADR 0011, 0012, 0013):
--   * the decision quota day is the owner's local day, computed by the trigger
--     from decision_cards.opened_at in the owner's zone (DEC-3); users refuse a
--     zone Postgres does not know;
--   * signals become typed rows (kind, status, source_ref, evidence, score,
--     weekly cap) the worker writes and owners read (PRO-1, PRO-3-CAP);
--   * briefs carry a word count and are owner select-only (BRF-1);
--   * plans carry revisions with reasons (PLN-2);
--   * companies know their Sentry project (PRO-2); tasks and artifacts accept
--     the fix and research kinds;
--   * agent_runs becomes owner select-only (OBS-1).
-- Every constraint and trigger from earlier migrations stays.

-- ---------------------------------------------------------------------------
-- users: a zone the database cannot convert with is refused, so the settings
-- form fails loudly instead of the quota trigger silently falling back to UTC.
-- ---------------------------------------------------------------------------
create or replace function public.users_timezone_valid() returns trigger
language plpgsql as $$
begin
  begin
    perform now() at time zone new.timezone;
  exception when others then
    raise exception 'unknown time zone: %', new.timezone using errcode = 'invalid_parameter_value';
  end;
  return new;
end $$;
drop trigger if exists users_timezone_valid on public.users;
create trigger users_timezone_valid before insert or update of timezone on public.users
  for each row execute function public.users_timezone_valid();

-- ---------------------------------------------------------------------------
-- decision_cards: when the card was opened (the worker's clock); the day is
-- derived from it server-side and never trusted as a date (DEC-3, ADR 0011).
-- ---------------------------------------------------------------------------
alter table public.decision_cards
  add column opened_at timestamptz not null default now();

create or replace function public.assign_decision_card_seq() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  quota int;
  tz text;
  next_seq int;
begin
  select u.daily_decision_quota, u.timezone into quota, tz
    from public.companies c join public.users u on u.id = c.owner_id
   where c.id = new.company_id;
  if quota is null then
    raise exception 'company % has no owner', new.company_id;
  end if;
  begin
    new.day := (new.opened_at at time zone coalesce(tz, 'UTC'))::date;
  exception when others then
    new.day := (new.opened_at at time zone 'UTC')::date;
  end;
  perform pg_advisory_xact_lock(hashtext(new.company_id::text || ':' || new.day::text));
  select coalesce(max(seq), 0) + 1 into next_seq
    from public.decision_cards where company_id = new.company_id and day = new.day;
  if next_seq > quota then
    raise exception 'daily decision quota (%) exceeded for company %', quota, new.company_id
      using errcode = 'check_violation';
  end if;
  new.seq := next_seq;
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- signals: a row per observation; it becomes a card only through the gate.
-- Vocabularies mirror SIGNAL_KINDS / SIGNAL_STATUSES / SIGNAL_SOURCES in
-- packages/core/src/signals/types.ts; lengths mirror the core schemas.
-- ---------------------------------------------------------------------------
alter table public.signals
  add column kind text not null default 'opportunity',
  add column status text not null default 'new',
  add column source_ref text,
  add column title text not null default '',
  add column url text,
  add column excerpt text not null default '',
  add column rationale text not null default '',
  add column payload jsonb not null default '{}'::jsonb,
  add column card_week text,
  add column converted_task_id uuid references public.tasks(id) on delete set null,
  add column observed_at timestamptz not null default now(),
  add column scored_at timestamptz,
  add column updated_at timestamptz not null default now();
update public.signals set source_ref = 'legacy:' || id::text where source_ref is null;
alter table public.signals
  alter column source_ref set not null,
  alter column summary set default '',
  add constraint signals_kind_check check (kind in ('opportunity', 'metric_drop', 'error')),
  add constraint signals_status_check check (status in ('new', 'scored', 'below_threshold', 'card_opened', 'deferred', 'capped', 'approved', 'declined', 'converted')),
  add constraint signals_source_check check (source in ('reddit', 'producthunt', 'google_trends', 'competitor_sites', 'metrics', 'sentry')),
  add constraint signals_source_ref_check check (char_length(source_ref) between 1 and 200),
  add constraint signals_title_check check (char_length(title) <= 200),
  add constraint signals_url_check check (url is null or char_length(url) <= 2048),
  add constraint signals_excerpt_check check (char_length(excerpt) <= 600),
  add constraint signals_summary_check check (char_length(summary) <= 200),
  add constraint signals_rationale_check check (char_length(rationale) <= 300),
  add constraint signals_score_check check (score >= 0 and score <= 1),
  add constraint signals_card_week_check check (card_week is null or card_week ~ '^[0-9]{4}-W[0-9]{2}$'),
  add constraint signals_payload_is_object check (jsonb_typeof(payload) = 'object'),
  add constraint signals_company_source_ref_key unique (company_id, source, source_ref);

-- PRO-3-CAP in the database: one opportunity card per company and ISO week.
create unique index signals_opportunity_week_idx
  on public.signals (company_id, card_week) where kind = 'opportunity' and card_week is not null;
create index signals_company_status_created_idx on public.signals (company_id, status, created_at);
create trigger signals_updated_at before update on public.signals for each row execute function public.set_updated_at();

drop policy if exists signals_owner_all on public.signals;
create policy signals_owner_select on public.signals for select using (public.is_company_owner(company_id));
revoke insert, update, delete on public.signals from authenticated, anon;

-- ---------------------------------------------------------------------------
-- briefs: one row per company and local day (unique from 0001); the worker
-- writes, owners read (BRF-1).
-- ---------------------------------------------------------------------------
alter table public.briefs
  add column word_count int not null default 0 check (word_count >= 0);

drop policy if exists briefs_owner_all on public.briefs;
create policy briefs_owner_select on public.briefs for select using (public.is_company_owner(company_id));
revoke insert, update, delete on public.briefs from authenticated, anon;

-- ---------------------------------------------------------------------------
-- plans: why each task type's count changed against the previous plan (PLN-2).
-- ---------------------------------------------------------------------------
alter table public.plans
  add column revisions jsonb not null default '[]'::jsonb,
  add constraint plans_revisions_is_array check (jsonb_typeof(revisions) = 'array');

-- ---------------------------------------------------------------------------
-- companies: the Sentry project whose issues become fix tasks (PRO-2). The
-- owner sets it through the existing owner policy; unique across companies.
-- ---------------------------------------------------------------------------
alter table public.companies
  add column sentry_project_slug text unique check (sentry_project_slug ~ '^[a-z0-9][a-z0-9._-]{0,99}$');

-- ---------------------------------------------------------------------------
-- tasks and artifacts: signal_research (research), fix_error (engineering),
-- signal_report, incident_report. Mirrors TASK_TYPES / ARTIFACT_KINDS in
-- packages/core/src/tasks/types.ts. actions.kind carries no check.
-- ---------------------------------------------------------------------------
alter table public.tasks drop constraint tasks_task_type_check;
alter table public.tasks
  add constraint tasks_task_type_check check (task_type in (
    'market_report', 'personas', 'competitor_map', 'prd', 'business_plan',
    'investor_deck', 'brand_kit', 'screen_designs', 'build_site',
    'campaign_spec', 'lead_research', 'outreach_batch', 'plan_week', 'brief',
    'signal_research', 'fix_error'
  ));
alter table public.artifacts drop constraint artifacts_kind_check;
alter table public.artifacts
  add constraint artifacts_kind_check check (kind in (
    'market_report', 'personas', 'competitor_map', 'prd', 'business_plan',
    'investor_deck', 'brand_kit', 'screen_designs', 'build_report',
    'campaign_spec', 'lead_list', 'outreach_batch', 'plan', 'brief', 'doc',
    'signal_report', 'incident_report'
  ));

-- ---------------------------------------------------------------------------
-- agent_runs: the cost record is the worker's; owners read it (OBS-1).
-- ---------------------------------------------------------------------------
drop policy if exists agent_runs_owner_all on public.agent_runs;
create policy agent_runs_owner_select on public.agent_runs for select using (public.is_company_owner(company_id));
revoke insert, update, delete on public.agent_runs from authenticated, anon;
