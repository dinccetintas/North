-- ---------------------------------------------------------------------------
-- 0018 (SLS-K2): a person receives at most one first contact, whatever
-- approved it (a card or an auto rule).
--
-- Right before the provider call the worker claims the lead with one
-- conditional update (`claimLeadForContact`): `new` → `contacted`, naming the
-- first-contact action in `contact_action_id`. Only one action can win; the
-- same action may claim again (a retried perform step) until its message id
-- is recorded. A failed send releases its own unsent claim with the reverse
-- conditional update (`releaseLeadContact`), so the lead is `new` again, as a
-- failed send always left it. Only the service role updates leads (0008).
-- ---------------------------------------------------------------------------

alter table public.leads add column if not exists contact_action_id uuid;

-- A new lead is unclaimed; an owner's upload can never carry a claim.
alter table public.leads drop constraint if exists leads_new_is_unclaimed;
alter table public.leads add constraint leads_new_is_unclaimed check (status <> 'new' or contact_action_id is null);
