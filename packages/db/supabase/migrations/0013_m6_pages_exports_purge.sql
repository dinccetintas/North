-- M6 subscription and launch, A6-1 continued (docs/plans/M6.md; ADR 0016):
--   * agent_runs.trace_id (OBS-1);
--   * public_pages and public_page_view, the only anonymous read (PUB-1);
--   * exports and the private exports bucket (EXP-1, MEM-2);
--   * purge_log and purge_owner, the one delete path (RET-1).
-- Every constraint and trigger from earlier migrations stays.

alter table public.agent_runs
  add column trace_id text check (char_length(trace_id) between 1 and 200);

-- ---------------------------------------------------------------------------
-- public_pages (PUB-1): what the owner chose to show; companies.public_page_enabled
-- (owner-updatable since 0011) is the switch, off by default. Metric keys
-- mirror OUTCOME_METRIC_KEYS in packages/core/src/tasks/types.ts.
-- ---------------------------------------------------------------------------
create table public.public_pages (
  company_id uuid primary key references public.companies(id) on delete cascade,
  headline text not null default '' check (char_length(headline) <= 120),
  blurb text not null default '' check (char_length(blurb) <= 600),
  show_goal boolean not null default false,
  metric_keys text[] not null default '{}' check (
    cardinality(metric_keys) <= 3
    and metric_keys <@ array['paying_customers', 'signups', 'waitlist', 'demo_calls', 'mrr_usd', 'revenue_usd', 'site_visitors', 'email_replies', 'artifacts']::text[]
  ),
  show_site_link boolean not null default false,
  listed boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger public_pages_updated_at before update on public.public_pages for each row execute function public.set_updated_at();

alter table public.public_pages enable row level security;
create policy public_pages_owner_all on public.public_pages for all
  using (public.is_company_owner(company_id)) with check (public.is_company_owner(company_id));
revoke all on public.public_pages from anon;

-- Anonymous readers never touch a table: this returns the facts the owner
-- chose (the shape of PublicPageViewInput in core), or null unless the switch
-- is on. Never the thesis, memory, cards or anything the owner did not tick.
create or replace function public.public_page_view(p_slug text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  c public.companies%rowtype;
  p public.public_pages%rowtype;
  v_goal jsonb;
  v_metrics jsonb;
  v_site text;
begin
  if p_slug is null or p_slug !~ '^[a-z0-9][a-z0-9-]{1,62}$' then
    return null;
  end if;
  select * into c from public.companies where slug = p_slug and public_page_enabled and status <> 'archived';
  if not found then
    return null;
  end if;
  select * into p from public.public_pages where company_id = c.id;
  if not found then
    p := row(c.id, '', '', false, '{}'::text[], false, false, now(), now());
  end if;
  if p.show_goal then
    select jsonb_build_object('metricKey', g.metric_key, 'target', g.target_value, 'current', coalesce(m.value, 0)) into v_goal
      from public.goals g
      left join lateral (select value from public.metrics where company_id = c.id and scope = 'company' and metric_key = g.metric_key order by measured_at desc limit 1) m on true
     where g.company_id = c.id and g.status = 'active'
     order by g.created_at desc limit 1;
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('key', k.key, 'value', m.value) order by k.ord), '[]'::jsonb) into v_metrics
    from (select key, min(ord) as ord from unnest(p.metric_keys) with ordinality as u(key, ord) group by key) k
    join lateral (select value from public.metrics where company_id = c.id and scope = 'company' and metric_key = k.key order by measured_at desc limit 1) m on true;
  if p.show_site_link then
    select a.external_ref into v_site from public.actions a
     where a.company_id = c.id and a.kind = 'deploy.production' and a.status in ('executed', 'notified') and a.external_ref ~ '^https://'
       and not exists (select 1 from public.actions s where s.supersedes = a.id)
     order by a.created_at desc limit 1;
  end if;
  return jsonb_build_object(
    'name', c.name,
    'page', jsonb_build_object('headline', p.headline, 'blurb', p.blurb, 'showGoal', p.show_goal, 'metricKeys', to_jsonb(p.metric_keys), 'showSiteLink', p.show_site_link, 'listed', p.listed),
    'goal', v_goal,
    'metrics', v_metrics,
    'siteUrl', v_site
  );
end $$;
revoke execute on function public.public_page_view(text) from public;
grant execute on function public.public_page_view(text) to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- exports (EXP-1, ADR 0016): the owner requests, the worker builds the zip
-- into the private bucket at users/<userId>/exports/<id>.zip (pinned here).
-- Statuses mirror EXPORT_STATUSES in packages/core/src/export/types.ts.
-- ---------------------------------------------------------------------------
create table public.exports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  company_id uuid references public.companies(id) on delete cascade,
  kind text not null check (kind in ('artifacts', 'data', 'full')),
  include_archived boolean not null default false,
  status text not null default 'requested' check (status in ('requested', 'running', 'ready', 'failed', 'expired')),
  storage_path text,
  bytes bigint check (bytes >= 0),
  manifest jsonb check (manifest is null or jsonb_typeof(manifest) = 'object'),
  error text check (char_length(error) between 1 and 300),
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint exports_storage_path_pinned check (storage_path is null or storage_path = 'users/' || user_id::text || '/exports/' || id::text || '.zip'),
  constraint exports_ready_complete check (status <> 'ready' or (storage_path is not null and bytes is not null and manifest is not null and expires_at is not null))
);
create index exports_user_created_idx on public.exports (user_id, created_at desc);
create index exports_ready_expiry_idx on public.exports (expires_at) where status = 'ready';
create trigger exports_updated_at before update on public.exports for each row execute function public.set_updated_at();

alter table public.exports enable row level security;
create policy exports_owner_select on public.exports for select using (user_id = auth.uid());
create policy exports_owner_insert on public.exports for insert
  with check (
    user_id = auth.uid() and status = 'requested' and storage_path is null and bytes is null and manifest is null and error is null and expires_at is null
    and (company_id is null or public.is_company_owner(company_id))
  );
revoke insert, update, delete on public.exports from authenticated, anon;
grant insert (user_id, company_id, kind, include_archived) on public.exports to authenticated;

-- The private bucket: owners read (sign) their own objects, keyed on the
-- second path segment as the artifacts bucket is; only the worker writes.
insert into storage.buckets (id, name, public) values ('exports', 'exports', false) on conflict (id) do nothing;
drop policy if exists exports_objects_owner_select on storage.objects;
create policy exports_objects_owner_select on storage.objects for select to authenticated
  using (bucket_id = 'exports' and (storage.foldername(name))[1] = 'users' and (storage.foldername(name))[2] = auth.uid()::text);

-- ---------------------------------------------------------------------------
-- purge_log (RET-1): one append-only row per purge with a hash of the user id,
-- never the id. Worker only.
-- ---------------------------------------------------------------------------
create table public.purge_log (
  id uuid primary key default gen_random_uuid(),
  user_hash text not null check (user_hash ~ '^[0-9a-f]{64}$'),
  reason text not null check (reason ~ '^[a-z][a-z0-9_-]{0,63}$'),
  counts jsonb not null check (jsonb_typeof(counts) = 'object'),
  purged_at timestamptz not null default now()
);
create trigger purge_log_append_only before update or delete on public.purge_log
  for each row execute function public.forbid_change();
alter table public.purge_log enable row level security;
revoke all on public.purge_log from anon, authenticated;

-- ---------------------------------------------------------------------------
-- purge_owner (ADR 0016): the one delete path. Service role only; refused
-- unless the entitlement is ended and retention_until has passed. The five
-- append-only triggers are disabled inside this transaction only and enabled
-- again before it commits (an error rolls both back); purge_log keeps its
-- trigger (only inserted into). Children go before parents so no restrict
-- reference or set-null update meets an append-only row; deleting companies
-- last cascades to anything a later table adds.
-- ---------------------------------------------------------------------------
create or replace function public.purge_owner(p_user_id uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  e public.entitlements%rowtype;
  v_companies uuid[];
  v_counts jsonb := '{}'::jsonb;
  v_table text;
  v_n bigint;
begin
  if p_user_id is null or p_reason is null or p_reason !~ '^[a-z][a-z0-9_-]{0,63}$' then
    raise exception 'purge_owner: a user and a reason label are required' using errcode = 'invalid_parameter_value';
  end if;
  perform pg_advisory_xact_lock(hashtext('owner:' || p_user_id::text));
  select * into e from public.entitlements where user_id = p_user_id for update;
  if not found or e.status <> 'ended' or e.retention_until is null or e.retention_until > now() then
    raise exception 'purge_owner: refused before retention: the entitlement is not ended or retention_until has not passed'
      using errcode = 'check_violation', hint = 'retention_not_passed';
  end if;
  select coalesce(array_agg(id), '{}') into v_companies from public.companies where owner_id = p_user_id;

  alter table public.actions disable trigger actions_append_only;
  alter table public.ledger_entries disable trigger ledger_append_only;
  alter table public.audit_tool_calls disable trigger audit_append_only;
  alter table public.billing_events disable trigger billing_events_append_only;
  alter table public.credit_entries disable trigger credit_entries_append_only;

  foreach v_table in array array[
    'audit_tool_calls', 'ledger_entries', 'campaigns', 'actions', 'notifications', 'signals', 'auto_rules',
    'decision_cards', 'agent_runs', 'metrics', 'memory_items', 'artifacts', 'briefs', 'leads', 'public_pages',
    'exports', 'budgets', 'theses', 'tasks', 'plans', 'goals', 'agents'
  ] loop
    execute format('delete from public.%I where company_id = any($1)', v_table) using v_companies;
    get diagnostics v_n = row_count;
    v_counts := v_counts || jsonb_build_object(v_table, v_n);
  end loop;
  delete from public.companies where owner_id = p_user_id;
  get diagnostics v_n = row_count;
  v_counts := v_counts || jsonb_build_object('companies', v_n);
  delete from public.connection_secrets where connection_id in (select id from public.connections where user_id = p_user_id);
  get diagnostics v_n = row_count;
  v_counts := v_counts || jsonb_build_object('connection_secrets', v_n);
  foreach v_table in array array[
    'connections', 'push_subscriptions', 'notifications', 'usage', 'credit_entries', 'billing_sessions', 'billing_events', 'exports', 'entitlements'
  ] loop
    execute format('delete from public.%I where user_id = $1', v_table) using p_user_id;
    get diagnostics v_n = row_count;
    v_counts := v_counts || jsonb_build_object(v_table, coalesce((v_counts->>v_table)::bigint, 0) + v_n);
  end loop;
  delete from public.users where id = p_user_id;
  get diagnostics v_n = row_count;
  v_counts := v_counts || jsonb_build_object('users', v_n);

  alter table public.actions enable trigger actions_append_only;
  alter table public.ledger_entries enable trigger ledger_append_only;
  alter table public.audit_tool_calls enable trigger audit_append_only;
  alter table public.billing_events enable trigger billing_events_append_only;
  alter table public.credit_entries enable trigger credit_entries_append_only;

  insert into public.purge_log (user_hash, reason, counts)
  values (encode(sha256(convert_to(p_user_id::text, 'UTF8')), 'hex'), p_reason, v_counts);
  return v_counts;
end $$;
revoke execute on function public.purge_owner(uuid, text) from public, anon, authenticated;
grant execute on function public.purge_owner(uuid, text) to service_role;
