-- ---------------------------------------------------------------------------
-- 0021 (M7, LRN-7): memory embeddings inside Supabase, and hybrid search.
--
-- The Supabase "automatic embeddings" recipe, adapted to North's names:
--
--   * memory_items gains embedding halfvec(384) (the never-written
--     vector(1536) is dropped first), department, provenance, status
--     ('active' | 'retired'), valid_until, and a 'preference' kind.
--   * An after insert / after update of (title, content) trigger enqueues one
--     job on the pgmq queue `embedding_jobs`:
--       { id, schema, table, contentFunction: 'memory_embedding_input',
--         embeddingColumn: 'embedding' }
--     (writing the embedding itself does not enqueue, so there is no loop).
--   * util.process_embeddings() reads the queue (util.next_embedding_batches:
--     batches of 10 rows, at most 10 requests per run, one row once per run),
--     and POSTs { ids, msgIds, schema, table, contentFunction, embeddingColumn }
--     to the `embed` Edge Function (supabase/functions/embed) through pg_net,
--     with the service key. The Edge Function embeds
--     `memory_embedding_input(row)` with Supabase.ai.Session('gte-small'),
--     writes the vector and acknowledges the jobs (embedding_jobs_ack).
--     pg_cron runs process_embeddings every 10 seconds.
--   * search_memory_hybrid fuses the full-text rank and the cosine rank with
--     Reciprocal Rank Fusion; search_memory (full text only) returns the same
--     row shape. Both see active, unexpired items only.
--   * embedding_queue_depth() lets tests and a later health check read the
--     queue without exposing the pgmq schema through PostgREST.
--
-- Which piece is live where. The queue, the trigger, the search functions and
-- util.process_embeddings exist in all three environments; the pieces that need
-- an extension are guarded by pg_available_extensions / to_regprocedure checks.
--
--                         Docker-free stack | supabase start (CI) | Supabase cloud
--   pgvector (halfvec)    yes               | yes                 | yes
--   pgmq queue + trigger  yes               | yes                 | yes
--   pg_net dispatch       no: the function  | yes, once the two   | yes, once the two
--                         returns 0, the    | Vault secrets below | Vault secrets below
--                         queue only        | are set             | are set
--                         accumulates       |                     |
--   pg_cron schedule      no (extension     | yes                 | yes
--                         absent)           |                     |
--   Vault                 no (settings      | yes                 | yes
--                         fallback)         |                     |
--
-- Until the project URL and the service key are known, process_embeddings
-- returns without reading the queue, so no job is lost or hidden. Set them
-- once per project, by hand, never in a migration (the service key is entered
-- by the operator only):
--     select vault.create_secret('https://<project-ref>.supabase.co', 'project_url');
--     select vault.create_secret('<service role key>', 'service_role_key');
-- Where Vault does not exist, util.project_url() and util.service_role_key()
-- fall back to the database settings app.settings.supabase_url and
-- app.settings.service_role_key. That fallback is for the Docker-free stack
-- only: a database setting is readable by every role, so staging and
-- production use Vault.
--
-- Retry. Delivery is at least once, through the pgmq visibility timeout (the
-- recipe's shape). A job is read with vt = 300 s and is NOT deleted when it is
-- handed to pg_net (that call is asynchronous). The request carries the job ids
-- (`msgIds`, side by side with `ids`); the Edge Function calls
-- public.embedding_jobs_ack(msgIds) only for the rows it embedded, or whose row
-- no longer exists or has no text (retrying cannot help those). A cold start, a
-- model error, a failed write or a 5xx therefore leaves the job on the queue and
-- it is read again after 300 s. A job read more than 5 times
-- (util.next_embedding_batches) is moved to the archive (pgmq.a_embedding_jobs)
-- instead of being sent again, so a poison row cannot loop. That row keeps
-- `embedding is null`; the full-text leg still finds it. To repair rows whose
-- jobs were archived, enqueue them again (service role or SQL):
--     update public.memory_items set title = title where embedding is null;
-- (the trigger fires on every update that names title or content).
-- public.embedding_jobs_claim() runs the same reader without the HTTP call, for
-- tests and for an operator without pg_net.
--
-- 0020 follow-up: the identity sequence of agent_session_entries is revoked
-- from the Data API roles (a review finding from Task 7).
-- ---------------------------------------------------------------------------

create extension if not exists pgmq;

do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_net') then
    create extension if not exists pg_net;
  end if;
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- memory_items: embedding, department, provenance, status, validity, kind
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (
    select 1 from pg_attribute
     where attrelid = 'public.memory_items'::regclass and attname = 'embedding' and not attisdropped
       and format_type(atttypid, atttypmod) = 'vector(1536)'
  ) then
    alter table public.memory_items drop column embedding;
  end if;
end $$;

alter table public.memory_items
  add column if not exists embedding halfvec(384),
  add column if not exists department text,
  add column if not exists provenance jsonb not null default '{}'::jsonb,
  add column if not exists status text not null default 'active',
  add column if not exists valid_until timestamptz;

alter table public.memory_items drop constraint if exists memory_items_status_check;
alter table public.memory_items add constraint memory_items_status_check check (status in ('active', 'retired'));
alter table public.memory_items drop constraint if exists memory_items_department_check;
alter table public.memory_items add constraint memory_items_department_check
  check (department is null or char_length(department) between 1 and 60);
alter table public.memory_items drop constraint if exists memory_items_provenance_check;
alter table public.memory_items add constraint memory_items_provenance_check
  check (jsonb_typeof(provenance) = 'object' and pg_column_size(provenance) <= 8192);
alter table public.memory_items drop constraint if exists memory_items_kind_check;
alter table public.memory_items add constraint memory_items_kind_check
  check (kind in ('thesis', 'persona', 'decision', 'learning', 'doc', 'preference'));

create index if not exists memory_items_embedding_idx on public.memory_items using hnsw (embedding halfvec_cosine_ops);

comment on column public.memory_items.embedding is
  'gte-small embedding (384 dimensions, normalised) of memory_embedding_input(row), written by the embed Edge Function; null until it runs.';
comment on column public.memory_items.department is
  'The staff department the item belongs to (sales, growth, ...); null for company-wide memory.';
comment on column public.memory_items.provenance is
  'Where the item came from (a retro, a task, a card) as a JSON object of at most 8 KB.';
comment on column public.memory_items.status is
  'active, or retired: a retired item stays for the record and is never searched or injected.';
comment on column public.memory_items.valid_until is
  'After this instant the item is no longer searched; null means it does not expire.';

-- The text that is embedded, also usable as a PostgREST computed column
-- (`select=id,input:memory_embedding_input`), which is how the Edge Function reads it.
create or replace function public.memory_embedding_input(m public.memory_items) returns text
language sql immutable security invoker set search_path = '' as $$
  select m.title || E'\n' || m.content;
$$;
revoke execute on function public.memory_embedding_input(public.memory_items) from public, anon, authenticated;
grant execute on function public.memory_embedding_input(public.memory_items) to service_role;

-- ---------------------------------------------------------------------------
-- the queue and its trigger (util is not exposed through the Data API)
-- ---------------------------------------------------------------------------
create schema if not exists util;
revoke all on schema util from public, anon, authenticated;

do $$
begin
  if to_regclass('pgmq.q_embedding_jobs') is null then
    perform pgmq.create('embedding_jobs');
  end if;
end $$;

-- Trigger function: arguments are the content function and the embedding column.
-- Security definer so the inserting role (service_role) needs no access to pgmq.
create or replace function util.queue_embeddings() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform pgmq.send(
    'embedding_jobs',
    jsonb_build_object(
      'id', new.id,
      'schema', tg_table_schema,
      'table', tg_table_name,
      'contentFunction', tg_argv[0],
      'embeddingColumn', tg_argv[1]
    )
  );
  return new;
end $$;
revoke execute on function util.queue_embeddings() from public, anon, authenticated;

drop trigger if exists memory_items_embed on public.memory_items;
create trigger memory_items_embed after insert or update of title, content on public.memory_items
  for each row execute function util.queue_embeddings('memory_embedding_input', 'embedding');

-- Messages not yet deleted, including those another reader holds invisible.
create or replace function public.embedding_queue_depth() returns bigint
language sql stable security definer set search_path = '' as $$
  select count(*) from pgmq.q_embedding_jobs;
$$;
revoke execute on function public.embedding_queue_depth() from public, anon, authenticated;
grant execute on function public.embedding_queue_depth() to service_role;

-- The Edge Function's acknowledgement: deletes the jobs it finished. Returns how
-- many existed (a job already acknowledged, or archived, counts 0).
create or replace function public.embedding_jobs_ack(p_msg_ids bigint[]) returns int
language sql security definer set search_path = '' as $$
  select count(*)::int from pgmq.delete('embedding_jobs', coalesce(p_msg_ids, '{}'::bigint[]));
$$;
revoke execute on function public.embedding_jobs_ack(bigint[]) from public, anon, authenticated;
grant execute on function public.embedding_jobs_ack(bigint[]) to service_role;

-- ---------------------------------------------------------------------------
-- util.project_url() / util.service_role_key(): Vault first, then the database setting
-- ---------------------------------------------------------------------------
create or replace function util.project_url() returns text
language plpgsql stable security definer set search_path = '' as $$
declare
  v_value text;
begin
  if to_regclass('vault.decrypted_secrets') is not null then
    execute $q$select decrypted_secret from vault.decrypted_secrets where name = 'project_url' limit 1$q$ into v_value;
  end if;
  return coalesce(nullif(v_value, ''), nullif(current_setting('app.settings.supabase_url', true), ''));
end $$;

create or replace function util.service_role_key() returns text
language plpgsql stable security definer set search_path = '' as $$
declare
  v_value text;
begin
  if to_regclass('vault.decrypted_secrets') is not null then
    execute $q$select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key' limit 1$q$ into v_value;
  end if;
  return coalesce(nullif(v_value, ''), nullif(current_setting('app.settings.service_role_key', true), ''));
end $$;
revoke execute on function util.project_url() from public, anon, authenticated;
revoke execute on function util.service_role_key() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- util.next_embedding_batches(): reads up to p_requests x p_size jobs (they stay
-- invisible to other readers for p_vt_seconds, and are NOT deleted) and groups
-- them into request bodies
--   { ids, msgIds, schema, table, contentFunction, embeddingColumn }
-- with at most p_size rows per body. `ids` and `msgIds` run side by side (one
-- entry per job, ascending by message id); a row with several waiting jobs (an
-- insert and an edit) goes into one body. A job read more than p_max_reads
-- times has failed that often: it is archived and not sent again.
-- ---------------------------------------------------------------------------
drop function if exists util.next_embedding_batches(int, int, int);
create or replace function util.next_embedding_batches(p_size int, p_requests int, p_vt_seconds int, p_max_reads int default 5)
returns table (body jsonb)
language plpgsql security definer set search_path = '' as $$
declare
  v_size int := greatest(coalesce(p_size, 10), 1);
  v_jobs jsonb;
begin
  select coalesce(jsonb_agg(to_jsonb(m)), '[]'::jsonb) into v_jobs
    from pgmq.read('embedding_jobs', greatest(coalesce(p_vt_seconds, 300), 1), greatest(coalesce(p_requests, 10), 1) * v_size) m;
  perform pgmq.archive('embedding_jobs', array(
    select (j ->> 'msg_id')::bigint from jsonb_array_elements(v_jobs) j where (j ->> 'read_ct')::int > p_max_reads));

  return query
  with jobs as (
    select j.msg_id,
           j.message -> 'id' as row_id,
           j.message ->> 'schema' as schema_name,
           j.message ->> 'table' as table_name,
           j.message ->> 'contentFunction' as content_function,
           j.message ->> 'embeddingColumn' as embedding_column
      from jsonb_to_recordset(v_jobs) as j(msg_id bigint, read_ct int, message jsonb)
     where j.read_ct <= p_max_reads
  ), numbered as (
    select j.*,
           (dense_rank() over (
              partition by j.schema_name, j.table_name, j.content_function, j.embedding_column
              order by j.row_id) - 1) / v_size as batch_no
      from jobs j
  )
  select jsonb_build_object(
           'ids', jsonb_agg(n.row_id order by n.msg_id),
           'msgIds', jsonb_agg(n.msg_id order by n.msg_id),
           'schema', n.schema_name,
           'table', n.table_name,
           'contentFunction', n.content_function,
           'embeddingColumn', n.embedding_column
         )
    from numbered n
   group by n.schema_name, n.table_name, n.content_function, n.embedding_column, n.batch_no;
end $$;
revoke execute on function util.next_embedding_batches(int, int, int, int) from public, anon, authenticated;

-- The same reader for the service role over the Data API (tests; an operator
-- without pg_net who sends the bodies to `embed` by hand).
create or replace function public.embedding_jobs_claim(p_batch_size int default 10, p_requests int default 10, p_vt_seconds int default 300)
returns table (body jsonb)
language sql security definer set search_path = '' as $$
  select b.body from util.next_embedding_batches(p_batch_size, p_requests, p_vt_seconds) b;
$$;
revoke execute on function public.embedding_jobs_claim(int, int, int) from public, anon, authenticated;
grant execute on function public.embedding_jobs_claim(int, int, int) to service_role;

-- ---------------------------------------------------------------------------
-- util.process_embeddings(): queue -> embed Edge Function. Returns the number
-- of jobs handed to pg_net; 0 when pg_net or the project settings are absent,
-- in which case the queue is left untouched. It deletes nothing: the Edge
-- Function acknowledges what it embedded, the rest returns after p_timeout_ms.
-- ---------------------------------------------------------------------------
create or replace function util.process_embeddings(
  p_batch_size int default 10,
  p_max_requests int default 10,
  p_timeout_ms int default 300000
) returns int
language plpgsql security definer set search_path = '' as $$
declare
  v_timeout int := greatest(coalesce(p_timeout_ms, 300000), 1000);
  v_url text;
  v_key text;
  v_batch record;
  v_sent int := 0;
begin
  if to_regprocedure('net.http_post(text, jsonb, jsonb, jsonb, integer)') is null then
    return 0;
  end if;
  v_url := util.project_url();
  v_key := util.service_role_key();
  if v_url is null or v_key is null then
    return 0;
  end if;

  for v_batch in
    select b.body from util.next_embedding_batches(p_batch_size, p_max_requests, v_timeout / 1000) b
  loop
    perform net.http_post(
      url => v_url || '/functions/v1/embed',
      headers => jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_key),
      body => v_batch.body,
      timeout_milliseconds => v_timeout
    );
    v_sent := v_sent + jsonb_array_length(v_batch.body -> 'msgIds');
  end loop;
  return v_sent;
end $$;
revoke execute on function util.process_embeddings(int, int, int) from public, anon, authenticated;

-- pg_cron: every 10 seconds (absent on the Docker-free stack).
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('process-embeddings', '10 seconds', $job$select util.process_embeddings()$job$);
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- search: full text and hybrid (RRF), active and unexpired items only.
-- Both run as the caller (security invoker): RLS shows an owner their company
-- and the service role the company it asks for.
-- ---------------------------------------------------------------------------
drop function if exists public.search_memory(uuid, text, int);
create function public.search_memory(p_company_id uuid, p_query text, p_limit int default 8)
returns table (id uuid, kind text, title text, content text, department text, rank real)
language sql stable security invoker set search_path = public as $$
  select s.id, s.kind, s.title, s.content, s.department, s.rank
    from (
      select m.id, m.kind, m.title, m.content, m.department, m.created_at,
             ts_rank(m.search, websearch_to_tsquery('english', p_query)) as rank
        from public.memory_items m
       where m.company_id = p_company_id
         and m.status = 'active'
         and (m.valid_until is null or m.valid_until > now())
         and m.search @@ websearch_to_tsquery('english', p_query)
    ) s
   order by s.rank desc, s.created_at desc, s.id
   limit greatest(1, least(coalesce(p_limit, 8), 50));
$$;
revoke execute on function public.search_memory(uuid, text, int) from public, anon;
grant execute on function public.search_memory(uuid, text, int) to authenticated, service_role;

-- Reciprocal Rank Fusion: score = 1/(k + rank in full text) + 1/(k + rank by cosine distance),
-- each leg limited to the best 2 x p_limit candidates. An item without an embedding takes part
-- through its words alone; a null p_embedding makes the semantic leg empty. `rank` is the
-- fused score (about 0.01 to 0.04 with k = 60), not comparable with search_memory's ts_rank.
-- search_path includes `extensions` because Supabase installs pgvector there.
create or replace function public.search_memory_hybrid(
  p_company_id uuid,
  p_query text,
  p_embedding halfvec(384),
  p_limit int default 8,
  p_rrf_k int default 60
) returns table (id uuid, kind text, title text, content text, department text, rank real)
language sql stable security invoker set search_path = public, extensions as $$
  with live as (
    select m.id, m.kind, m.title, m.content, m.department, m.created_at, m.search, m.embedding
      from public.memory_items m
     where m.company_id = p_company_id
       and m.status = 'active'
       and (m.valid_until is null or m.valid_until > now())
  ), full_text as (
    select l.id, rank() over (order by ts_rank_cd(l.search, websearch_to_tsquery('english', p_query)) desc) as pos
      from live l
     where l.search @@ websearch_to_tsquery('english', p_query)
     order by pos
     limit greatest(1, least(coalesce(p_limit, 8), 50)) * 2
  ), semantic as (
    select l.id, rank() over (order by l.embedding <=> p_embedding) as pos
      from live l
     where l.embedding is not null and p_embedding is not null
     order by l.embedding <=> p_embedding
     limit greatest(1, least(coalesce(p_limit, 8), 50)) * 2
  )
  select r.id, r.kind, r.title, r.content, r.department, r.rank
    from (
      select l.id, l.kind, l.title, l.content, l.department, l.created_at,
             (coalesce(1.0 / (greatest(1, coalesce(p_rrf_k, 60)) + f.pos), 0)
              + coalesce(1.0 / (greatest(1, coalesce(p_rrf_k, 60)) + s.pos), 0))::real as rank
        from full_text f
        full outer join semantic s on s.id = f.id
        join live l on l.id = coalesce(f.id, s.id)
    ) r
   order by r.rank desc, r.created_at desc, r.id
   limit greatest(1, least(coalesce(p_limit, 8), 50));
$$;
revoke execute on function public.search_memory_hybrid(uuid, text, halfvec, int, int) from public, anon;
grant execute on function public.search_memory_hybrid(uuid, text, halfvec, int, int) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 0020 follow-up: the Data API roles never touch the identity sequence of
-- agent_session_entries (the table is service role only).
-- ---------------------------------------------------------------------------
revoke all on sequence public.agent_session_entries_id_seq from authenticated, anon;
