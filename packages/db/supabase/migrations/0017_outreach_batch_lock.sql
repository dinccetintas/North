-- ---------------------------------------------------------------------------
-- 0017 (SLS-K2 / DEC-3): a lead is in at most one open first-contact batch,
-- also when two outreach tasks gate at the same moment.
--
-- A pending `email.send.first_contact` (its card waits for an answer, or the
-- approved send waits to be performed) holds every address its payload names:
-- `to` and the batch's whole `recipients` list, lowercased. The worker opens a
-- first contact's card through `open_first_contact_card`, which takes the
-- company's outreach lock, refuses when an address is held, and otherwise
-- writes the card and its pending action in the same transaction. Holds stay
-- derived from the append-only `actions` chain (no second table to release),
-- and a card can no longer exist without the action it decides on. The card
-- insert still runs `assign_decision_card_seq` (the daily quota), whose
-- per-day lock is always taken after this one, never before. An auto-approved
-- first contact (no card) is recorded through `record_auto_first_contact`
-- under the same lock (`lock_outreach_held`). That nobody is emailed twice is
-- 0018's perform-time claim on the lead; this migration keeps decisions from
-- being spent on people another open batch already holds.
-- ---------------------------------------------------------------------------

-- The open first contacts of a company, found without scanning its history.
create index if not exists actions_open_first_contact_idx
  on public.actions (company_id)
  where kind = 'email.send.first_contact' and status = 'pending';

-- Every address a first contact's payload names: `to` plus `recipients`, trimmed, lowercased, distinct.
create or replace function public.first_contact_addresses(p_payload jsonb) returns text[]
language sql immutable set search_path = public as $$
  select coalesce(array_agg(distinct a order by a), '{}'::text[])
    from (
      select lower(btrim(p_payload->>'to')) as a
      union all
      select lower(btrim(r))
        from jsonb_array_elements_text(case when jsonb_typeof(p_payload->'recipients') = 'array' then p_payload->'recipients' else '[]'::jsonb end) as r
    ) addresses
   where a is not null and a <> ''
$$;

-- The addresses every open first contact of the company holds (chain heads still `pending`).
-- Security invoker: an owner sees their own company's holds under RLS, a stranger none.
create or replace function public.held_outreach_addresses(p_company uuid) returns text[]
language sql stable security invoker set search_path = public as $$
  select coalesce(array_agg(distinct h order by h), '{}'::text[])
    from public.actions a
   cross join lateral unnest(public.first_contact_addresses(a.payload)) as h
   where a.company_id = p_company
     and a.kind = 'email.send.first_contact'
     and a.status = 'pending'
     and not exists (select 1 from public.actions s where s.supersedes = a.id)
$$;
revoke execute on function public.held_outreach_addresses(uuid) from public, anon;
grant execute on function public.held_outreach_addresses(uuid) to authenticated, service_role;

-- Takes the company's outreach lock for the rest of the transaction and returns the first of the
-- addresses another open first contact holds, or null. The caller writes its pending row under the lock.
create or replace function public.lock_outreach_held(p_company uuid, p_addresses text[]) returns text
language plpgsql security definer set search_path = public as $$
declare
  v_held text;
begin
  perform pg_advisory_xact_lock(hashtext('outreach:' || p_company::text));
  select h into v_held from unnest(public.held_outreach_addresses(p_company)) as h where h = any(p_addresses) order by h limit 1;
  return v_held;
end $$;
revoke execute on function public.lock_outreach_held(uuid, text[]) from public, anon, authenticated;
grant execute on function public.lock_outreach_held(uuid, text[]) to service_role;

-- Opens a first contact's card and records its pending action atomically.
-- p_card: the decision_cards columns the worker sends to `openCard`;
-- p_action: the actions columns of the pending row (status and card are set here).
-- Returns {"held": <address>} (nothing written) or {"card": <row>, "action_id": <uuid>};
-- a spent quota raises the trigger's check_violation and rolls both back.
create or replace function public.open_first_contact_card(p_card jsonb, p_action jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_company uuid := (p_card->>'company_id')::uuid;
  v_addresses text[] := public.first_contact_addresses(coalesce(p_action->'payload', '{}'::jsonb));
  v_held text;
  v_card public.decision_cards;
  v_action uuid;
begin
  if v_company is null or (p_action->>'company_id')::uuid is distinct from v_company then
    raise exception 'open_first_contact_card: the card and the action must name the same company' using errcode = 'invalid_parameter_value';
  end if;
  if p_card->>'action_kind' is distinct from 'email.send.first_contact' or p_action->>'kind' is distinct from 'email.send.first_contact' then
    raise exception 'open_first_contact_card: only email.send.first_contact' using errcode = 'invalid_parameter_value';
  end if;
  if cardinality(v_addresses) = 0 then
    raise exception 'open_first_contact_card: a first contact needs its recipient' using errcode = 'invalid_parameter_value';
  end if;

  v_held := public.lock_outreach_held(v_company, v_addresses);
  if v_held is not null then
    return jsonb_build_object('held', v_held);
  end if;

  insert into public.decision_cards (company_id, task_id, action_id, action_kind, tier, question, options, recommended_option_id, default_option_id, rationale, expected_impact, cost_usd, due_at, merge_key, opened_at)
  values (
    v_company, (p_card->>'task_id')::uuid, (p_card->>'action_id')::uuid, p_card->>'action_kind', p_card->>'tier', p_card->>'question', p_card->'options',
    p_card->>'recommended_option_id', p_card->>'default_option_id', p_card->>'rationale', p_card->>'expected_impact', coalesce((p_card->>'cost_usd')::numeric, 0),
    (p_card->>'due_at')::timestamptz, coalesce(p_card->>'merge_key', ''), coalesce((p_card->>'opened_at')::timestamptz, now())
  )
  returning * into v_card;

  insert into public.actions (company_id, task_id, agent_role, kind, tier, description, payload, status, external_ref, decision_card_id, sandbox)
  values (
    v_company, (p_action->>'task_id')::uuid, p_action->>'agent_role', p_action->>'kind', p_action->>'tier', p_action->>'description',
    coalesce(p_action->'payload', '{}'::jsonb), 'pending', p_action->>'external_ref', v_card.id, coalesce((p_action->>'sandbox')::boolean, true)
  )
  returning id into v_action;

  return jsonb_build_object('card', to_jsonb(v_card), 'action_id', v_action);
end $$;
revoke execute on function public.open_first_contact_card(jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.open_first_contact_card(jsonb, jsonb) to service_role;

-- Records an auto-approved first contact's pending row (an auto rule instead of a card) under the
-- same lock, refused when its own recipient (`to`) is held: each send of an auto-approved batch is
-- checked on its own, since the batch's earlier sends are already settled. Returns
-- {"held": <address>} (nothing written) or {"action_id": <uuid>}.
create or replace function public.record_auto_first_contact(p_action jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_company uuid := (p_action->>'company_id')::uuid;
  v_to text := lower(btrim(p_action->'payload'->>'to'));
  v_held text;
  v_action uuid;
begin
  if v_company is null or p_action->>'kind' is distinct from 'email.send.first_contact' or (p_action->>'auto_rule_id') is null then
    raise exception 'record_auto_first_contact: an auto-approved email.send.first_contact of one company is required' using errcode = 'invalid_parameter_value';
  end if;
  if v_to is null or v_to = '' then
    raise exception 'record_auto_first_contact: a first contact needs its recipient' using errcode = 'invalid_parameter_value';
  end if;
  if not exists (select 1 from public.auto_rules r where r.id = (p_action->>'auto_rule_id')::uuid and r.company_id = v_company and r.active and r.kind = 'email.send.first_contact') then
    raise exception 'record_auto_first_contact: no active first-contact auto rule of this company' using errcode = 'invalid_parameter_value';
  end if;

  v_held := public.lock_outreach_held(v_company, array[v_to]);
  if v_held is not null then
    return jsonb_build_object('held', v_held);
  end if;

  insert into public.actions (company_id, task_id, agent_role, kind, tier, description, payload, status, external_ref, auto_rule_id, sandbox)
  values (
    v_company, (p_action->>'task_id')::uuid, p_action->>'agent_role', p_action->>'kind', p_action->>'tier', p_action->>'description',
    coalesce(p_action->'payload', '{}'::jsonb), 'pending', p_action->>'external_ref', (p_action->>'auto_rule_id')::uuid, coalesce((p_action->>'sandbox')::boolean, true)
  )
  returning id into v_action;
  return jsonb_build_object('action_id', v_action);
end $$;
revoke execute on function public.record_auto_first_contact(jsonb) from public, anon, authenticated;
grant execute on function public.record_auto_first_contact(jsonb) to service_role;
