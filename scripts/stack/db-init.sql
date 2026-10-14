-- Roles and grants the Supabase platform normally provisions, for a plain
-- PostgreSQL running the North stack without Docker (scripts/stack/up.sh).
-- Passwords are local-only placeholders; the database listens on loopback.
\set ON_ERROR_STOP on

do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin noinherit; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin noinherit; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin noinherit bypassrls; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticator') then create role authenticator login noinherit password 'authenticator'; end if;
  if not exists (select 1 from pg_roles where rolname = 'supabase_auth_admin') then create role supabase_auth_admin login noinherit createrole password 'supabase_auth_admin'; end if;
  if not exists (select 1 from pg_roles where rolname = 'supabase_storage_admin') then create role supabase_storage_admin login noinherit createrole password 'supabase_storage_admin'; end if;
end $$;
alter role postgres password 'postgres';
-- GoTrue and the storage API keep their migration tables in their own schemas.
alter role supabase_auth_admin set search_path = auth;
alter role supabase_storage_admin set search_path = storage;
grant anon, authenticated, service_role to authenticator;
grant anon, authenticated, service_role to postgres;

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
create schema if not exists auth authorization supabase_auth_admin;
create schema if not exists storage authorization supabase_storage_admin;

grant usage on schema public, extensions to anon, authenticated, service_role;
grant all on schema public to postgres;
grant usage on schema auth, storage to anon, authenticated, service_role;
grant all on schema storage to postgres;
grant all on schema auth to postgres;
grant usage on schema public to supabase_storage_admin, supabase_auth_admin;

-- Objects the North migrations create (as postgres) are readable through PostgREST.
alter default privileges for role postgres in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges for role postgres in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges for role postgres in schema public grant execute on functions to anon, authenticated, service_role;
alter default privileges for role postgres in schema storage grant all on tables to anon, authenticated, service_role;
alter default privileges for role supabase_storage_admin in schema storage grant all on tables to anon, authenticated, service_role;
alter default privileges for role supabase_storage_admin in schema storage grant execute on functions to anon, authenticated, service_role;
