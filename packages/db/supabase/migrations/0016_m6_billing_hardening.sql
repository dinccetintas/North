-- M6 security review, billing findings (ADR 0014; review H1, L1, L2, L9, L10):
--   * billing_events.type accepts checkout.session.async_payment_succeeded, the
--     event that grants a pack bought with a delayed method (H1);
--   * billing_events.payload is the reduced, sanitised event core parsed (no
--     email, address or hosted invoice URL), payload_sha256 the hash of the
--     raw signed body; rows no user owns are swept after 30 days (L2,
--     UNKNOWN_BILLING_EVENT_DAYS in core);
--   * billing_sessions.completed_at, set by the worker when the session's own
--     checkout event is applied, and a lookup by provider_ref: the user hint
--     of a checkout event is trusted only for a session the worker created
--     (L1), and a second subscription checkout is refused while one is open
--     (L10);
--   * credit_reserve: a run's consume written at dispatch, refused at a
--     balance of 0 under the per-user credits lock (L9).
-- Idempotent: every statement can run again.

-- ---------------------------------------------------------------------------
-- billing_events (H1, L2)
-- ---------------------------------------------------------------------------
alter table public.billing_events drop constraint if exists billing_events_type_check;
alter table public.billing_events add constraint billing_events_type_check check (type in (
  'checkout.session.completed', 'checkout.session.async_payment_succeeded',
  'customer.subscription.created', 'customer.subscription.updated', 'customer.subscription.deleted',
  'invoice.paid', 'invoice.payment_failed'
));

alter table public.billing_events add column if not exists payload_sha256 text;
alter table public.billing_events drop constraint if exists billing_events_payload_sha256_check;
alter table public.billing_events add constraint billing_events_payload_sha256_check check (payload_sha256 is null or payload_sha256 ~ '^[0-9a-f]{64}$');

-- Append-only except `applied_at`, set once (0012), now with the hash in the
-- frozen columns; a delete is allowed only inside billing_events_sweep_unknown
-- and only for an unapplied row no user owns, older than the sweep's cutoff.
create or replace function public.billing_events_append_only() returns trigger
language plpgsql as $$
declare
  v_before timestamptz;
begin
  if tg_op = 'UPDATE' and old.applied_at is null and new.applied_at is not null
     and (new.id, new.event_id, new.type, new.received_at) = (old.id, old.event_id, old.type, old.received_at)
     and new.user_id is not distinct from old.user_id and new.payload = old.payload
     and new.payload_sha256 is not distinct from old.payload_sha256 then
    return new;
  end if;
  if tg_op = 'DELETE' then
    v_before := nullif(current_setting('north.billing_events_sweep_before', true), '')::timestamptz;
    if v_before is not null and old.user_id is null and old.applied_at is null and old.received_at < v_before then
      return old;
    end if;
  end if;
  raise exception 'append-only table: % rows cannot be updated or deleted', tg_table_name
    using errcode = 'restrict_violation';
end $$;

-- The retention sweep's call (worker, service role): removes stored events no
-- user owns once they are older than p_before, never younger than 30 days on
-- the database's own clock. Returns the number removed.
create or replace function public.billing_events_sweep_unknown(p_before timestamptz) returns int
language plpgsql security definer set search_path = public as $$
declare
  v_before timestamptz := least(coalesce(p_before, now()), now() - interval '30 days');
  v_n int;
begin
  perform set_config('north.billing_events_sweep_before', v_before::text, true);
  delete from public.billing_events where user_id is null and applied_at is null and received_at < v_before;
  get diagnostics v_n = row_count;
  perform set_config('north.billing_events_sweep_before', '', true);
  return v_n;
end $$;
revoke execute on function public.billing_events_sweep_unknown(timestamptz) from public, anon, authenticated;
grant execute on function public.billing_events_sweep_unknown(timestamptz) to service_role;

-- ---------------------------------------------------------------------------
-- billing_sessions (L1, L10): written by the worker only (0012's grants
-- stand: owners insert user_id, kind, plan_id and pack_id, nothing else).
-- ---------------------------------------------------------------------------
alter table public.billing_sessions add column if not exists completed_at timestamptz;
create index if not exists billing_sessions_provider_ref_idx on public.billing_sessions (provider_ref) where provider_ref is not null;

-- ---------------------------------------------------------------------------
-- credit_reserve (L9): the run's `consume` (-1, ref run:<agentRunId>) written
-- before the run starts. Under the same per-user lock as the overdraft
-- trigger: 'exists' when the ref is already there, 'refused' at a balance of
-- 0 or below (nothing written), else 'reserved'. Concurrent dispatches cannot
-- start more runs than the balance covers.
-- ---------------------------------------------------------------------------
create or replace function public.credit_reserve(p_user_id uuid, p_ref text) returns text
language plpgsql security definer set search_path = public as $$
declare
  v_balance int;
begin
  if p_user_id is null or p_ref is null or char_length(p_ref) not between 1 and 200 then
    raise exception 'credit_reserve: a user and a ref of 1 to 200 characters are required' using errcode = 'invalid_parameter_value';
  end if;
  perform pg_advisory_xact_lock(hashtext('credits:' || p_user_id::text));
  if exists (select 1 from public.credit_entries where user_id = p_user_id and ref = p_ref) then
    return 'exists';
  end if;
  select coalesce(sum(amount), 0) into v_balance from public.credit_entries where user_id = p_user_id;
  if v_balance <= 0 then
    return 'refused';
  end if;
  insert into public.credit_entries (user_id, kind, amount, ref, note) values (p_user_id, 'consume', -1, p_ref, '');
  return 'reserved';
end $$;
revoke execute on function public.credit_reserve(uuid, text) from public, anon, authenticated;
grant execute on function public.credit_reserve(uuid, text) to service_role;
