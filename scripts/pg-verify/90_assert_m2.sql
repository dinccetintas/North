-- M2 database guarantees, asserted directly in SQL after all migrations applied.
\set ON_ERROR_STOP on

begin;
insert into auth.users (id, email) values ('11111111-1111-4111-8111-111111111111', 'ceo@north.test');
-- handle_new_auth_user creates the profile row with quota 3.
insert into public.companies (id, owner_id, name, slug)
  values ('22222222-2222-4222-8222-222222222222', '11111111-1111-4111-8111-111111111111', 'Verify Co', 'verify-co');

-- Task types: the two K2 types are accepted, anything else is refused.
insert into public.tasks (company_id, role, task_type, title) values ('22222222-2222-4222-8222-222222222222', 'growth', 'campaign_spec', 'Ad test');
insert into public.tasks (company_id, role, task_type, title) values ('22222222-2222-4222-8222-222222222222', 'sales', 'outreach_batch', 'Cold emails');
do $$ begin
  begin
    insert into public.tasks (company_id, role, task_type, title) values ('22222222-2222-4222-8222-222222222222', 'growth', 'mine_bitcoin', 'x');
    raise exception 'FAIL: unknown task type accepted';
  exception when check_violation then raise notice 'OK tasks_task_type_check refuses mine_bitcoin'; end;
end $$;

-- DEC-3: seq assigned by trigger 1..3; the fourth card of the day is refused.
create temp table opened as
  with ins as (
    insert into public.decision_cards (company_id, action_kind, tier, question, options, recommended_option_id, default_option_id, rationale, due_at)
    select '22222222-2222-4222-8222-222222222222', 'ads.start', 'K2', 'Approve?', '[{"id":"approve","label":"Approve"},{"id":"decline","label":"Decline"}]', 'approve', 'decline', 'r', now() + interval '1 day'
    from generate_series(1, 3)
    returning seq
  )
  select seq from ins;
do $$ declare seqs int[]; begin
  select array_agg(seq order by seq) into seqs from opened;
  if seqs <> array[1,2,3] then raise exception 'FAIL: seq %', seqs; end if;
  raise notice 'OK seq assigned 1..3 (default 0 overridden by trigger)';
  begin
    insert into public.decision_cards (company_id, action_kind, tier, question, options, recommended_option_id, default_option_id, rationale, due_at)
      values ('22222222-2222-4222-8222-222222222222', 'ads.start', 'K2', 'Fourth?', '[{"id":"approve","label":"Approve"},{"id":"decline","label":"Decline"}]', 'approve', 'decline', 'r', now() + interval '1 day');
    raise exception 'FAIL: fourth card accepted';
  exception when check_violation then raise notice 'OK DEC-3: fourth card of the day refused (%)', sqlerrm; end;
end $$;

-- merge_key defaults to '' and action_id is nullable.
do $$ declare mk text; aid uuid; begin
  select merge_key, action_id into mk, aid from public.decision_cards where question = 'Approve?' limit 1;
  if mk <> '' or aid is not null then raise exception 'FAIL: merge_key/action_id defaults'; end if;
  raise notice 'OK merge_key default and nullable action_id';
end $$;

-- DEC-2: a default answer must equal the safe default.
do $$ declare cid uuid; begin
  select id into cid from public.decision_cards where question = 'Approve?' limit 1;
  begin
    update public.decision_cards set answered_option_id = 'approve', answered_at = now(), answered_by = 'default' where id = cid;
    raise exception 'FAIL: default answer with the non-default option accepted';
  exception when check_violation then raise notice 'OK default answer must be the safe default'; end;
  update public.decision_cards set answered_option_id = 'decline', answered_at = now(), answered_by = 'default' where id = cid;
  raise notice 'OK default answer equal to the safe default accepted';
end $$;

-- K3 never has a default (existing constraint) and cannot be answered by default (new constraint).
do $$ begin
  begin
    insert into public.decision_cards (company_id, action_kind, tier, question, options, recommended_option_id, default_option_id, rationale, due_at, day)
      values ('22222222-2222-4222-8222-222222222222', 'contract.sign', 'K3', 'Sign?', '[{"id":"approve","label":"Approve"},{"id":"decline","label":"Decline"}]', 'approve', 'decline', 'r', now() + interval '1 day', current_date + 1);
    raise exception 'FAIL: K3 with default accepted';
  exception when check_violation then raise notice 'OK K3 cannot carry a default'; end;
end $$;

-- Append-only action chains: supersedes is unique, so a row is replaced at most once.
do $$ declare a1 uuid; a2 uuid; begin
  insert into public.actions (company_id, agent_role, kind, tier, description, status) values ('22222222-2222-4222-8222-222222222222', 'engineering', 'deploy.preview', 'K1', 'Deploy', 'notified') returning id into a1;
  insert into public.actions (company_id, agent_role, kind, tier, description, status, supersedes) values ('22222222-2222-4222-8222-222222222222', 'engineering', 'deploy.preview', 'K1', 'Deploy', 'executed', a1) returning id into a2;
  begin
    insert into public.actions (company_id, agent_role, kind, tier, description, status, supersedes) values ('22222222-2222-4222-8222-222222222222', 'engineering', 'deploy.preview', 'K1', 'Deploy', 'failed', a1);
    raise exception 'FAIL: second supersede accepted';
  exception when unique_violation then raise notice 'OK actions_supersedes_idx keeps chains linear'; end;
end $$;

-- push_subscriptions: endpoint unique; notifications: channel/status checks.
insert into public.push_subscriptions (user_id, endpoint, p256dh, auth) values ('11111111-1111-4111-8111-111111111111', 'https://push.example.test/1', 'p', 'a');
do $$ begin
  begin
    insert into public.push_subscriptions (user_id, endpoint, p256dh, auth) values ('11111111-1111-4111-8111-111111111111', 'https://push.example.test/1', 'p', 'a');
    raise exception 'FAIL: duplicate endpoint accepted';
  exception when unique_violation then raise notice 'OK push endpoint unique'; end;
  begin
    insert into public.notifications (company_id, user_id, channel, kind, status) values ('22222222-2222-4222-8222-222222222222', '11111111-1111-4111-8111-111111111111', 'sms', 'x', 'sent');
    raise exception 'FAIL: sms channel accepted';
  exception when check_violation then raise notice 'OK notifications_channel_check'; end;
  begin
    insert into public.notifications (company_id, user_id, channel, kind, status) values ('22222222-2222-4222-8222-222222222222', '11111111-1111-4111-8111-111111111111', 'push', 'x', 'queued');
    raise exception 'FAIL: queued status accepted';
  exception when check_violation then raise notice 'OK notifications_status_check'; end;
end $$;

-- RLS is on for the new tables and the owner policies exist.
do $$ declare n int; begin
  select count(*) into n from pg_policies where tablename in ('push_subscriptions', 'notifications');
  if n < 2 then raise exception 'FAIL: expected policies on push_subscriptions/notifications, found %', n; end if;
  if not (select relrowsecurity from pg_class where oid = 'public.push_subscriptions'::regclass) then raise exception 'FAIL: RLS off on push_subscriptions'; end if;
  if not (select relrowsecurity from pg_class where oid = 'public.notifications'::regclass) then raise exception 'FAIL: RLS off on notifications'; end if;
  raise notice 'OK RLS enabled with % policies on the M2 tables', n;
end $$;

rollback;
