-- 0009 M4 hardening (security review M1).
--
-- budget_apply added p_extra unconditionally, so a cap card approved after
-- midnight (p_day = yesterday) raised the row's *current* day's cap. The
-- extra now follows the same day guard as the spend: it applies only when
-- p_day is the row's extra day (or later, which rolls the day first). The
-- result gains `applied`: false when the call's day is already over for the
-- spend or the extra, so the worker can record the action failed instead of
-- resuming a campaign under a cap that was never raised.
-- Every grant and revoke from 0008 stays (same signature, same owner).
create or replace function public.budget_apply(p_company_id uuid, p_category text, p_day date, p_spend numeric, p_extra numeric, p_total numeric) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  b public.budgets%rowtype;
  d date := coalesce(p_day, current_date);
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

revoke execute on function public.budget_apply(uuid, text, date, numeric, numeric, numeric) from public, anon, authenticated, service_role;
