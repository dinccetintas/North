-- M2 security review fixes (docs/plans/M2.md "Security review"):
--   * owners read the audit log and cards; only the worker (service role) writes
--     actions and opens cards, and an owner's only write on a card is the answer;
--   * the quota trigger serialises concurrent inserts per company and day;
--   * tasks keep the run result so a task parked on a card can finish later
--     with its artifact evidence (settlement no longer lives inside the run).

-- ---------------------------------------------------------------------------
-- actions: append-only AND worker-only. Owners keep select through the
-- existing owner policy; the insert privilege goes away for signed-in users.
-- ---------------------------------------------------------------------------
revoke insert, update, delete on public.actions from authenticated, anon;

-- ---------------------------------------------------------------------------
-- decision_cards: owners may answer (three columns, only while unanswered);
-- everything else is the worker's.
-- ---------------------------------------------------------------------------
drop policy if exists decision_cards_owner_all on public.decision_cards;
create policy decision_cards_owner_select on public.decision_cards for select
  using (public.is_company_owner(company_id));
create policy decision_cards_owner_answer on public.decision_cards for update
  using (public.is_company_owner(company_id) and answered_at is null)
  with check (public.is_company_owner(company_id));
revoke insert, update, delete on public.decision_cards from authenticated, anon;
grant update (answered_option_id, answered_at, answered_by) on public.decision_cards to authenticated;

-- ---------------------------------------------------------------------------
-- DEC-3 under concurrency: two runs of the same company opening cards at the
-- same moment both read max(seq); the lock makes the second one wait and see
-- the first. The unique key stays as the last line of defence.
-- ---------------------------------------------------------------------------
create or replace function public.assign_decision_card_seq() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  quota int;
  next_seq int;
begin
  perform pg_advisory_xact_lock(hashtext(new.company_id::text || ':' || new.day::text));
  select u.daily_decision_quota into quota
    from public.companies c join public.users u on u.id = c.owner_id
   where c.id = new.company_id;
  if quota is null then
    raise exception 'company % has no owner', new.company_id;
  end if;
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
-- tasks.result: what the agent run produced (artifact ids, cost, summary), so
-- the settlement path can mark the task done with the right evidence.
-- ---------------------------------------------------------------------------
alter table public.tasks add column result jsonb not null default '{}'::jsonb;
