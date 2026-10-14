-- M1 security review fixes (docs/plans/M1.md "Security review").

-- Audit rows carry the task they belong to.
alter table public.audit_tool_calls
  add column task_id uuid references public.tasks(id) on delete set null;
create index audit_tool_calls_task_idx on public.audit_tool_calls (task_id);

-- Task and plan vocabularies are enforced in the database as well as in Zod.
alter table public.tasks
  add constraint tasks_task_type_check check (task_type in (
    'market_report', 'personas', 'competitor_map', 'prd', 'business_plan',
    'investor_deck', 'brand_kit', 'plan_week', 'brief'
  )),
  add constraint tasks_role_check check (role in (
    'chief_of_staff', 'research', 'strategy_product', 'engineering', 'design',
    'growth', 'sales', 'ops_finance'
  ));
alter table public.plans
  add constraint plans_status_check check (status in ('active', 'superseded', 'archived'));

-- Artifacts are evidence: owners read them, only the worker (service role) writes them.
drop policy if exists artifacts_owner_insert on storage.objects;
drop policy if exists artifacts_owner_update on storage.objects;
drop policy if exists artifacts_owner_delete on storage.objects;
drop policy if exists artifacts_owner_select on storage.objects;
create policy artifacts_owner_select on storage.objects for select to authenticated
  using (
    bucket_id = 'artifacts'
    and (storage.foldername(name))[1] = 'companies'
    and (storage.foldername(name))[2] ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    and public.is_company_owner(((storage.foldername(name))[2])::uuid)
  );

-- Memory search is for signed-in owners and the worker, never anonymous callers.
revoke execute on function public.search_memory(uuid, text, int) from public, anon;
grant execute on function public.search_memory(uuid, text, int) to authenticated, service_role;
