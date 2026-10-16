-- ---------------------------------------------------------------------------
-- 0019 (M7, CMP-1): the suppression list and the sender identity.
--
--   * public.suppressions: every address (or bare domain) the company must
--     never write to again. Append-only, like the action chain: an opt-out, a
--     bounce or a complaint is history, and lifting a block is a new decision,
--     not an edit. The worker writes with the service role; the owner reads.
--     A row whose `email` has no '@' is a block on that exact domain (not its
--     subdomains); `domain` is generated from the address rows only.
--   * companies.legal_name and companies.postal_address: the sender identity
--     the law wants at the foot of every outreach email. The owner sets both.
--   * purge_owner (0013) is replaced so the purge still works: the company
--     delete cascades into suppressions, whose append-only trigger it
--     disables like the other five, and suppressions go before actions
--     (source_action_id references them).
-- ---------------------------------------------------------------------------

create table public.suppressions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  email text not null
    constraint suppressions_email_check check (email = lower(email) and char_length(email) between 3 and 254),
  domain text generated always as (split_part(email, '@', 2)) stored,
  reason text not null
    constraint suppressions_reason_check check (reason in ('opt_out', 'bounce', 'complaint', 'manual', 'legal_block')),
  source_action_id uuid references public.actions(id),
  created_at timestamptz not null default now()
);
create index suppressions_company_email_idx on public.suppressions (company_id, email);
create index suppressions_company_domain_idx on public.suppressions (company_id, domain);
comment on column public.suppressions.email is
  'The suppressed address, lower case. A value without an @ is a bare domain: it blocks addresses at exactly that domain, not its subdomains (CMP-1).';

create trigger suppressions_append_only before update or delete on public.suppressions
  for each row execute function public.forbid_change();

alter table public.suppressions enable row level security;
create policy suppressions_owner_select on public.suppressions for select using (public.is_company_owner(company_id));
revoke insert, update, delete on public.suppressions from authenticated, anon;

-- ---------------------------------------------------------------------------
-- Sender identity. 0011 revoked the table-level update on companies and
-- grants it column by column, so the owner (companies_owner_all) may write
-- these two columns and nothing else changes.
-- ---------------------------------------------------------------------------
alter table public.companies
  add column legal_name text
    constraint companies_legal_name_check check (char_length(legal_name) <= 120),
  add column postal_address text
    constraint companies_postal_address_check check (char_length(postal_address) <= 300);
grant update (legal_name, postal_address) on public.companies to authenticated;
comment on column public.companies.legal_name is
  'Legal name printed in the footer of outreach emails (CMP-1); set by the owner.';
comment on column public.companies.postal_address is
  'Postal address printed in the footer of outreach emails (CMP-1); set by the owner.';

-- ---------------------------------------------------------------------------
-- purge_owner (ADR 0016), 0013's body plus suppressions: its append-only
-- trigger is disabled with the others and enabled again before the commit,
-- and its rows go before the actions they point at.
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

  foreach v_table in array array[
    'suppressions', 'audit_tool_calls', 'ledger_entries', 'campaigns', 'actions', 'notifications', 'signals', 'auto_rules',
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

  insert into public.purge_log (user_hash, reason, counts)
  values (encode(sha256(convert_to(p_user_id::text, 'UTF8')), 'hex'), p_reason, v_counts);
  return v_counts;
end $$;
revoke execute on function public.purge_owner(uuid, text) from public, anon, authenticated;
grant execute on function public.purge_owner(uuid, text) to service_role;
