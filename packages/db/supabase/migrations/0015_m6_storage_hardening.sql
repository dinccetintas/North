-- M6 security review fixes, data and storage (docs/plans/M6.md "Security
-- review": M2, M4, M5, L3 and the note on the 0001 owner_all policies):
--   * M2: artifacts.storage_path is pinned to companies/<company_id>/<kind>/
--     <slug>-v<version>.md, so the worker's service role never downloads
--     (export) or deletes (purge) another company's object for a row;
--   * owner writes on the 0001 owner_all tables are cut to what apps/web
--     writes, the 0006/0011 pattern (policy split, table privilege revoked,
--     columns granted back): theses keep the v1 insert (company creation)
--     and the clarifications (onboarding), goals the insert (onboarding),
--     auto_rules the insert (DEC-3) and a deactivation (settings). agents,
--     plans, tasks, memory_items, audit_tool_calls and artifacts are read
--     only: the worker writes them;
--   * M4: one open export per owner and EXPORT_DAILY_CAP (5) per 24 hours;
--     length checks on memory_items, audit_tool_calls.input and theses; the
--     export_text domain the export casts free-text columns to in its select;
--   * M5: purge_begin marks entitlements.purge_started_at before the worker
--     removes a single object; while it is set the entitlement stays ended,
--     so no reactivation lands between the storage removal and purge_owner;
--   * L3: no pause is lifted, by any caller, while the owner's entitlement
--     is ended (a pause the user set included).
-- Existing rows were checked against every new constraint before it is added.
-- Every constraint and trigger from earlier migrations stays.

-- ---------------------------------------------------------------------------
-- M2: the artifact's object lives under its own company (and kind, version)
-- ---------------------------------------------------------------------------
do $$
declare
  v_bad bigint;
begin
  select count(*) into v_bad from public.artifacts
   where storage_path !~ ('^companies/' || company_id::text || '/' || kind || '/[a-z0-9][a-z0-9-]{0,79}-v' || version::text || '\.md$');
  if v_bad > 0 then
    raise exception '0015: % artifacts row(s) name a storage path outside companies/<company_id>/<kind>/<slug>-v<version>.md; repair them first', v_bad;
  end if;
end $$;

-- The slug rule mirrors artifactSlug / artifactStoragePath in packages/db/src/artifacts.ts.
alter table public.artifacts drop constraint if exists artifacts_storage_path_pinned;
alter table public.artifacts add constraint artifacts_storage_path_pinned check (
  storage_path ~ ('^companies/' || company_id::text || '/' || kind || '/[a-z0-9][a-z0-9-]{0,79}-v' || version::text || '\.md$')
);

-- ---------------------------------------------------------------------------
-- Owner writes: read only where the web never writes
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['agents', 'plans', 'tasks', 'memory_items', 'audit_tool_calls', 'artifacts', 'theses', 'goals', 'auto_rules'] loop
    execute format('drop policy if exists %I on public.%I', t || '_owner_all', t);
    execute format('drop policy if exists %I on public.%I', t || '_owner_select', t);
    execute format('create policy %I on public.%I for select using (public.is_company_owner(company_id))', t || '_owner_select', t);
    execute format('revoke insert, update, delete on public.%I from authenticated, anon', t);
  end loop;
end $$;

-- theses: createCompany inserts v1 with the company; saveClarifications updates the answers.
drop policy if exists theses_owner_insert_first on public.theses;
create policy theses_owner_insert_first on public.theses for insert
  with check (public.is_company_owner(company_id) and version = 1);
drop policy if exists theses_owner_clarify on public.theses;
create policy theses_owner_clarify on public.theses for update
  using (public.is_company_owner(company_id)) with check (public.is_company_owner(company_id));
grant insert (company_id, version, text, target_customer, why_now) on public.theses to authenticated;
grant update (clarifications) on public.theses to authenticated;

-- goals: the onboarding's createGoal (status keeps its default, active).
drop policy if exists goals_owner_insert on public.goals;
create policy goals_owner_insert on public.goals for insert
  with check (public.is_company_owner(company_id));
grant insert (company_id, metric_key, target_value, due_date) on public.goals to authenticated;

-- auto_rules: DEC-3's createAutoRule (from the company's own card, active) and
-- the settings' deactivateAutoRule (active may only become false).
drop policy if exists auto_rules_owner_insert on public.auto_rules;
create policy auto_rules_owner_insert on public.auto_rules for insert
  with check (
    public.is_company_owner(company_id) and active
    and (created_from_card_id is null
         or exists (select 1 from public.decision_cards d where d.id = created_from_card_id and d.company_id = auto_rules.company_id))
  );
drop policy if exists auto_rules_owner_deactivate on public.auto_rules;
create policy auto_rules_owner_deactivate on public.auto_rules for update
  using (public.is_company_owner(company_id)) with check (public.is_company_owner(company_id) and not active);
grant insert (company_id, kind, max_amount_usd, category, created_from_card_id) on public.auto_rules to authenticated;
grant update (active) on public.auto_rules to authenticated;

-- ---------------------------------------------------------------------------
-- M4: lengths. MemoryDraftSchema (4000 / 120), capAuditInput (4000 chars of
-- JSON, so 64 KiB is far above any worker row), the thesis schemas (4000 /
-- 500 / 500) and ClarificationAnswersSchema (five answers of 1000 chars).
-- ---------------------------------------------------------------------------
alter table public.memory_items drop constraint if exists memory_items_content_length;
alter table public.memory_items add constraint memory_items_content_length check (char_length(content) <= 4000);
alter table public.memory_items drop constraint if exists memory_items_title_length;
alter table public.memory_items add constraint memory_items_title_length check (char_length(title) <= 120);
alter table public.audit_tool_calls drop constraint if exists audit_tool_calls_input_size;
alter table public.audit_tool_calls add constraint audit_tool_calls_input_size check (octet_length(input::text) <= 65536);
alter table public.theses drop constraint if exists theses_text_length;
alter table public.theses add constraint theses_text_length check (char_length(text) <= 4000 and char_length(target_customer) <= 500 and char_length(why_now) <= 500);
alter table public.theses drop constraint if exists theses_clarifications_size;
alter table public.theses add constraint theses_clarifications_size check (octet_length(clarifications::text) <= 32768);

-- The export's read cuts free-text columns in the select (`content::export_text`,
-- PostgREST casts) so one oversized value never reaches the worker's memory
-- whole. Mirrors EXPORT_TEXT_MAX_CHARS in packages/db/src/exports.ts.
do $$ begin
  if not exists (select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace where n.nspname = 'public' and t.typname = 'export_text') then
    create domain public.export_text as varchar(20000);
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- M4: one export being built per user (a row older than an hour is stale: its
-- event was lost) and at most 5 requests per 24 hours, failed ones included.
-- Binds the signed-in owner, the only one who requests exports (the worker
-- never inserts one; a caller without a user, the service role, is trusted).
-- Another user's id is refused before anything is read, so the message never
-- describes someone else's exports.
-- ---------------------------------------------------------------------------
create or replace function public.exports_rate_limit() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_open int;
  v_day int;
begin
  if auth.uid() is null then
    return new;
  end if;
  if new.user_id is distinct from auth.uid() then
    raise exception 'new row violates row-level security policy for table "exports"' using errcode = 'insufficient_privilege';
  end if;
  perform pg_advisory_xact_lock(hashtext('exports:' || new.user_id::text));
  select count(*) filter (where status in ('requested', 'running') and created_at > now() - interval '1 hour'), count(*)
    into v_open, v_day
    from public.exports where user_id = new.user_id and created_at > now() - interval '24 hours';
  if v_open > 0 then
    raise exception 'exports: an export is already being built; wait until it is ready'
      using errcode = 'check_violation', hint = 'export_in_progress';
  end if;
  if v_day >= 5 then
    raise exception 'exports: at most 5 exports in 24 hours; try again tomorrow'
      using errcode = 'check_violation', hint = 'export_daily_cap';
  end if;
  return new;
end $$;
drop trigger if exists exports_rate_limit on public.exports;
create trigger exports_rate_limit before insert on public.exports
  for each row execute function public.exports_rate_limit();

-- ---------------------------------------------------------------------------
-- M5: the purge holds the entitlement. purge_begin (service role) checks
-- purge_owner's own condition under the same owner lock and stamps
-- purge_started_at once; the worker removes storage and workspaces only
-- after it. From then on the entitlement stays ended with retention passed
-- until purge_owner deletes it; only the founder (postgres) clears the stamp.
-- ---------------------------------------------------------------------------
alter table public.entitlements add column if not exists purge_started_at timestamptz;

create or replace function public.purge_begin(p_user_id uuid) returns timestamptz
language plpgsql security definer set search_path = public as $$
declare
  e public.entitlements%rowtype;
begin
  if p_user_id is null then
    raise exception 'purge_begin: a user is required' using errcode = 'invalid_parameter_value';
  end if;
  perform pg_advisory_xact_lock(hashtext('owner:' || p_user_id::text));
  select * into e from public.entitlements where user_id = p_user_id for update;
  if not found or e.status <> 'ended' or e.retention_until is null or e.retention_until > now() then
    raise exception 'purge_owner: refused before retention: the entitlement is not ended or retention_until has not passed'
      using errcode = 'check_violation', hint = 'retention_not_passed';
  end if;
  if e.purge_started_at is null then
    update public.entitlements set purge_started_at = now() where user_id = p_user_id returning purge_started_at into e.purge_started_at;
  end if;
  return e.purge_started_at;
end $$;
revoke execute on function public.purge_begin(uuid) from public, anon, authenticated;
grant execute on function public.purge_begin(uuid) to service_role;

create or replace function public.entitlements_purge_hold() returns trigger
language plpgsql as $$
begin
  if old.purge_started_at is null then
    return new;
  end if;
  if new.status <> 'ended' or new.retention_until is null or new.retention_until > now()
     or (new.purge_started_at is distinct from old.purge_started_at and current_user not in ('postgres', 'supabase_admin')) then
    raise exception 'entitlement: a purge is running for this user since %; it is not reactivated', old.purge_started_at
      using errcode = 'check_violation', hint = 'purge_running';
  end if;
  return new;
end $$;
drop trigger if exists entitlements_purge_hold on public.entitlements;
create trigger entitlements_purge_hold before update on public.entitlements
  for each row execute function public.entitlements_purge_hold();

-- ---------------------------------------------------------------------------
-- L3: lifting a pause (the switch off, or out of paused/archived) needs an
-- entitlement that has not ended, for every caller (the worker lifts billing
-- pauses only after a new subscription made it active). The 0012 rules
-- follow unchanged. Runs as the caller: owners read their own entitlement.
-- ---------------------------------------------------------------------------
create or replace function public.companies_pause_state() returns trigger
language plpgsql as $$
declare
  v_status text;
begin
  if (old.kill_switch_active and not new.kill_switch_active)
     or (old.status in ('paused', 'archived') and new.status not in ('paused', 'archived')) then
    select e.status into v_status from public.entitlements e where e.user_id = old.owner_id;
    if coalesce(v_status, 'ended') = 'ended' then
      raise exception 'company %: the subscription has ended; subscribe to resume', old.id
        using errcode = 'check_violation', hint = 'subscription_ended';
    end if;
  end if;
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
