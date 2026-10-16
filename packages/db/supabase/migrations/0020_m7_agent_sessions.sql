-- ---------------------------------------------------------------------------
-- 0020 (M7, SEC-2): the agent session store.
--
--   * public.agent_session_entries: the Agent SDK's SessionStore mirrors a
--     run's transcript here (`append(key, entries)` / `load(key)`), so a task
--     that is parked can resume on any worker machine. One row per transcript
--     entry, the entry as the SDK wrote it (`{ type, uuid?, timestamp?, ... }`).
--     `seq` counts per (session_id, subpath) and is assigned by the caller;
--     `subpath` is '' for the main transcript and names the subagent
--     transcript otherwise (the SDK key may carry one).
--   * Append-only, like the action chain: a transcript is history, so a row
--     is never updated or deleted (a company or owner purge disables the
--     trigger, below).
--   * Service role only. An entry holds prompts and tool results, which never
--     reach the browser: RLS is enabled with no policy for `authenticated` or
--     `anon`, and their table privileges are revoked as well, so a policy added
--     by mistake later still has no grant behind it.
--   * One entry is at most 256 KB, so a hostile tool result cannot bloat the
--     table. The check runs on the value as it is inserted (before TOAST
--     compression), so it bounds what a client can send.
--   * purge_owner (0019) is replaced so the purge still works: the company
--     delete cascades into this table, whose append-only trigger it disables
--     like the other six.
-- ---------------------------------------------------------------------------

create table public.agent_session_entries (
  id bigint generated always as identity primary key,
  company_id uuid not null references public.companies(id) on delete cascade,
  session_id text not null
    constraint agent_session_entries_session_id_check check (char_length(session_id) between 1 and 128),
  subpath text not null default ''
    constraint agent_session_entries_subpath_check check (char_length(subpath) <= 256),
  seq int not null
    constraint agent_session_entries_seq_check check (seq >= 0),
  entry jsonb not null
    constraint agent_session_entries_entry_check check (pg_column_size(entry) <= 262144),
  created_at timestamptz not null default now(),
  constraint agent_session_entries_seq_key unique (session_id, subpath, seq)
);
create index agent_session_entries_company_session_idx on public.agent_session_entries (company_id, session_id);
comment on table public.agent_session_entries is
  'The Agent SDK session store (SEC-2): transcript entries of a run, append-only, service role only.';
comment on column public.agent_session_entries.seq is
  'Position of the entry in its (session_id, subpath) transcript, from 0, assigned by the writer; the unique key makes a replayed or racing append fail instead of interleave.';
comment on column public.agent_session_entries.subpath is
  'Empty for the main transcript; the subagent transcript path otherwise.';
comment on column public.agent_session_entries.entry is
  'The SDK transcript entry as JSON, at most 256 KB. jsonb keeps the content, not the key order.';

create trigger agent_session_entries_append_only before update or delete on public.agent_session_entries
  for each row execute function public.forbid_change();

alter table public.agent_session_entries enable row level security;
revoke all on public.agent_session_entries from authenticated, anon;

-- ---------------------------------------------------------------------------
-- purge_owner (ADR 0016), 0019's body plus agent_session_entries: its
-- append-only trigger is disabled with the others and enabled again before
-- the commit, and its rows go in the child-first delete list, so the purge
-- logs how many transcript entries it removed (the company delete would
-- cascade into them anyway, with the trigger disabled).
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
  alter table public.suppressions disable trigger suppressions_append_only;
  alter table public.agent_session_entries disable trigger agent_session_entries_append_only;

  foreach v_table in array array[
    'agent_session_entries', 'suppressions', 'audit_tool_calls', 'ledger_entries', 'campaigns', 'actions', 'notifications', 'signals', 'auto_rules',
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
  alter table public.suppressions enable trigger suppressions_append_only;
  alter table public.agent_session_entries enable trigger agent_session_entries_append_only;

  insert into public.purge_log (user_hash, reason, counts)
  values (encode(sha256(convert_to(p_user_id::text, 'UTF8')), 'hex'), p_reason, v_counts);
  return v_counts;
end $$;
revoke execute on function public.purge_owner(uuid, text) from public, anon, authenticated;
grant execute on function public.purge_owner(uuid, text) to service_role;
