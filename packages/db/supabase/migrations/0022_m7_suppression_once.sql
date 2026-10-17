-- ---------------------------------------------------------------------------
-- 0022 (M7, CMP-1): one suppression per address, atomically.
--
--   public.add_suppression_once(company, email, reason, source_action) is how
--   the worker records an opt-out (the /u/{token} link, a reply asking to
--   stop) or a bounce. Under a per-address advisory lock it checks whether the
--   address, or its bare domain, is already suppressed for the company, and
--   inserts one row only when it is not: a repeat, concurrent first hits
--   included, writes nothing and returns null. The table stays append-only
--   history (0019): no unique key is added, so `addSuppression` may still
--   record the same address again under another reason.
-- ---------------------------------------------------------------------------

create or replace function public.add_suppression_once(p_company_id uuid, p_email text, p_reason text, p_source_action_id uuid default null)
returns uuid
language plpgsql security invoker set search_path = public as $$
declare
  v_email text := lower(btrim(p_email));
  v_domain text := split_part(lower(btrim(p_email)), '@', 2);
  v_id uuid;
begin
  if p_company_id is null or v_email is null or v_email = '' or p_reason is null then
    raise exception 'add_suppression_once: a company, an address and a reason are required' using errcode = 'invalid_parameter_value';
  end if;
  -- One writer per (company, address) at a time; the check below then sees every committed row.
  perform pg_advisory_xact_lock(hashtext('suppression:' || p_company_id::text || ':' || v_email));
  if exists (
    select 1 from public.suppressions s
     where s.company_id = p_company_id
       and (s.email = v_email or (v_domain <> '' and s.email = v_domain))
  ) then
    return null;
  end if;
  insert into public.suppressions (company_id, email, reason, source_action_id)
  values (p_company_id, v_email, p_reason, p_source_action_id)
  returning id into v_id;
  return v_id;
end $$;
comment on function public.add_suppression_once(uuid, text, text, uuid) is
  'CMP-1: inserts one suppression unless the address or its domain is already suppressed for the company (then null); serialised per address.';
revoke execute on function public.add_suppression_once(uuid, text, text, uuid) from public, anon, authenticated;
grant execute on function public.add_suppression_once(uuid, text, text, uuid) to service_role;
