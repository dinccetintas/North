-- M6 A6-6 (docs/plans/M6.md; the ADR 0011 follow-up): budgets run on the
-- owner-local day. The worker passes localDay(tz, clock()) to
-- apply_budget_spend and raise_daily_cap; when no day is given the database
-- takes owner_local_date(company), never the UTC current_date. The activation
-- check, a fresh line's dates and a total-cap raise use it too.
-- record_attribution is unchanged: its callers pass the day.
-- Every grant from 0008/0009 stays (same signatures, same owner).

-- The owner's date now, in their zone (UTC for an unknown company or zone).
-- Runs as the caller: an owner reads only their own company's zone; inside the
-- security definer functions below it reads any.
create or replace function public.owner_local_date(p_company_id uuid) returns date
language plpgsql stable set search_path = public as $$
declare
  tz text;
begin
  select u.timezone into tz from public.companies c join public.users u on u.id = c.owner_id where c.id = p_company_id;
  return (now() at time zone coalesce(tz, 'UTC'))::date;
exception when others then
  return (now() at time zone 'UTC')::date;
end $$;
revoke execute on function public.owner_local_date(uuid) from public, anon;
grant execute on function public.owner_local_date(uuid) to authenticated, service_role;

-- A fresh budget line starts on the owner's date (the column defaults are the
-- UTC date, and a default cannot read the company). Only a zero amount's date
-- is moved, so an explicit spend row is never re-dated.
create or replace function public.budgets_local_dates() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  d date := public.owner_local_date(new.company_id);
begin
  if new.spent_today_usd = 0 then
    new.spent_today_date := d;
  end if;
  if new.daily_extra_usd = 0 then
    new.daily_extra_date := d;
  end if;
  return new;
end $$;
create trigger budgets_local_dates before insert on public.budgets
  for each row execute function public.budgets_local_dates();

-- BUD-1 (0008), with today being the owner's date.
create or replace function public.campaigns_within_budget() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  b public.budgets%rowtype;
  today date;
  spent_today numeric;
  extra numeric;
begin
  if new.status <> 'active' then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.status = 'active' and old.daily_budget_usd = new.daily_budget_usd then
    return new;
  end if;
  select * into b from public.budgets where company_id = new.company_id and category = 'ads';
  if not found then
    raise exception 'budget_cap' using errcode = 'check_violation', detail = 'no ads budget for this company';
  end if;
  today := public.owner_local_date(new.company_id);
  spent_today := case when b.spent_today_date = today then b.spent_today_usd else 0 end;
  extra := case when b.daily_extra_date = today then b.daily_extra_usd else 0 end;
  if new.daily_budget_usd > b.daily_limit_usd + extra then
    raise exception 'budget_cap' using errcode = 'check_violation',
      detail = format('daily budget %s exceeds the effective daily cap %s', new.daily_budget_usd, b.daily_limit_usd + extra);
  end if;
  if spent_today >= b.daily_limit_usd + extra then
    raise exception 'budget_cap' using errcode = 'check_violation',
      detail = format('today''s ads cap %s is spent (%s)', b.daily_limit_usd + extra, spent_today);
  end if;
  if b.spent_total_usd >= b.total_limit_usd then
    raise exception 'budget_cap' using errcode = 'check_violation',
      detail = format('the ads total cap %s is spent (%s)', b.total_limit_usd, b.spent_total_usd);
  end if;
  return new;
end $$;

-- 0009's budget_apply with the owner's date as the default day.
create or replace function public.budget_apply(p_company_id uuid, p_category text, p_day date, p_spend numeric, p_extra numeric, p_total numeric) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  b public.budgets%rowtype;
  d date := coalesce(p_day, public.owner_local_date(p_company_id));
  v_applied boolean := true;
begin
  if p_spend < 0 or p_extra < 0 or p_total < 0 then
    raise exception 'budget amounts must be zero or more' using errcode = 'check_violation';
  end if;
  select * into b from public.budgets where company_id = p_company_id and category = p_category for update;
  if not found then
    raise exception 'no % budget for company %', p_category, p_company_id using errcode = 'no_data_found';
  end if;
  if d > b.spent_today_date then
    b.spent_today_usd := 0;
    b.spent_today_date := d;
  end if;
  if d > b.daily_extra_date then
    b.daily_extra_usd := 0;
    b.daily_extra_date := d;
  end if;
  if d >= b.spent_today_date then
    b.spent_today_usd := b.spent_today_usd + p_spend;
  elsif p_spend > 0 then
    v_applied := false;
  end if;
  if d >= b.daily_extra_date then
    b.daily_extra_usd := b.daily_extra_usd + p_extra;
  elsif p_extra > 0 then
    v_applied := false;
  end if;
  b.spent_total_usd := b.spent_total_usd + p_spend;
  b.total_limit_usd := b.total_limit_usd + p_total;
  update public.budgets
     set spent_today_usd = b.spent_today_usd, spent_today_date = b.spent_today_date,
         spent_total_usd = b.spent_total_usd, daily_extra_usd = b.daily_extra_usd,
         daily_extra_date = b.daily_extra_date, total_limit_usd = b.total_limit_usd
   where id = b.id;
  return jsonb_build_object(
    'spent_today', b.spent_today_usd,
    'spent_total', b.spent_total_usd,
    'daily_extra', b.daily_extra_usd,
    'daily_limit_effective', b.daily_limit_usd + b.daily_extra_usd,
    'total_limit', b.total_limit_usd,
    'cap_daily', b.spent_today_usd >= b.daily_limit_usd + b.daily_extra_usd,
    'cap_total', b.spent_total_usd >= b.total_limit_usd,
    'applied', v_applied
  );
end $$;

-- The public wrappers default to null, so budget_apply takes the owner's date.
create or replace function public.apply_budget_spend(p_company_id uuid, p_category text, p_amount numeric, p_day date default null) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if p_amount is null or p_amount < 0 then
    raise exception 'apply_budget_spend: amount must be zero or more' using errcode = 'check_violation';
  end if;
  return public.budget_apply(p_company_id, p_category, p_day, p_amount, 0, 0);
end $$;

create or replace function public.raise_daily_cap(p_company_id uuid, p_category text, p_amount numeric, p_day date default null) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if p_amount is null or p_amount < 0 then
    raise exception 'raise_daily_cap: amount must be zero or more' using errcode = 'check_violation';
  end if;
  return public.budget_apply(p_company_id, p_category, p_day, 0, p_amount, 0);
end $$;

create or replace function public.raise_total_cap(p_company_id uuid, p_category text, p_amount numeric) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if p_amount is null or p_amount < 0 then
    raise exception 'raise_total_cap: amount must be zero or more' using errcode = 'check_violation';
  end if;
  return public.budget_apply(p_company_id, p_category, null, 0, 0, p_amount);
end $$;

revoke execute on function public.budget_apply(uuid, text, date, numeric, numeric, numeric) from public, anon, authenticated, service_role;
revoke execute on function public.apply_budget_spend(uuid, text, numeric, date) from public, anon, authenticated;
revoke execute on function public.raise_daily_cap(uuid, text, numeric, date) from public, anon, authenticated;
revoke execute on function public.raise_total_cap(uuid, text, numeric) from public, anon, authenticated;
grant execute on function public.apply_budget_spend(uuid, text, numeric, date) to service_role;
grant execute on function public.raise_daily_cap(uuid, text, numeric, date) to service_role;
grant execute on function public.raise_total_cap(uuid, text, numeric) to service_role;
