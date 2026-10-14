-- M1 core loop (docs/plans/M1.md, WP-A): onboarding state, thesis
-- clarifications, typed tasks, plan status, ranked memory search and the
-- private Storage bucket that holds artifact markdown.
-- Every constraint and trigger from 0001_init.sql stays as it is.

-- ---------------------------------------------------------------------------
-- onboarding (ONB-1/2)
-- ---------------------------------------------------------------------------
alter table public.companies
  add column onboarding_step text not null default 'questions'
    check (onboarding_step in ('thesis', 'questions', 'goal', 'budget', 'summary', 'done'));

alter table public.theses
  add column clarifications jsonb not null default '[]'::jsonb;

-- ---------------------------------------------------------------------------
-- plans and tasks (PLN-1, AGT-1)
-- ---------------------------------------------------------------------------
alter table public.tasks
  add column task_type text not null default 'market_report',
  add column output_summary text;

alter table public.plans
  add column status text not null default 'active';

-- ---------------------------------------------------------------------------
-- company memory: ranked full-text search over title + content
-- ---------------------------------------------------------------------------
alter table public.memory_items
  add column search tsvector generated always as (
    to_tsvector('english', coalesce(title, '') || ' ' || coalesce(content, ''))
  ) stored;
create index memory_items_search_idx on public.memory_items using gin (search);

-- Runs as the caller (security invoker) so RLS on memory_items applies to the
-- owner client while the service role sees every company it asks for.
create or replace function public.search_memory(p_company_id uuid, p_query text, p_limit int default 8)
returns table (id uuid, kind text, title text, content text, rank real)
language sql stable security invoker set search_path = public as $$
  select s.id, s.kind, s.title, s.content, s.rank
    from (
      select m.id, m.kind, m.title, m.content, m.created_at,
             ts_rank(m.search, websearch_to_tsquery('english', p_query)) as rank
        from public.memory_items m
       where m.company_id = p_company_id
         and m.search @@ websearch_to_tsquery('english', p_query)
    ) s
   order by s.rank desc, s.created_at desc
   limit greatest(1, least(coalesce(p_limit, 8), 50));
$$;

-- ---------------------------------------------------------------------------
-- artifact storage: private bucket, owner-scoped by the company id folder.
-- Object paths are companies/<company_id>/<kind>/<slug>-v<n>.md, so
-- (storage.foldername(name))[2] is the company id.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('artifacts', 'artifacts', false)
on conflict (id) do nothing;

create policy artifacts_owner_select on storage.objects for select to authenticated
  using (bucket_id = 'artifacts' and public.is_company_owner(((storage.foldername(name))[2])::uuid));

create policy artifacts_owner_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'artifacts' and public.is_company_owner(((storage.foldername(name))[2])::uuid));

create policy artifacts_owner_update on storage.objects for update to authenticated
  using (bucket_id = 'artifacts' and public.is_company_owner(((storage.foldername(name))[2])::uuid))
  with check (bucket_id = 'artifacts' and public.is_company_owner(((storage.foldername(name))[2])::uuid));

create policy artifacts_owner_delete on storage.objects for delete to authenticated
  using (bucket_id = 'artifacts' and public.is_company_owner(((storage.foldername(name))[2])::uuid));
