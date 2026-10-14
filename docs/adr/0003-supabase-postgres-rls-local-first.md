# ADR 0003: Supabase Postgres with RLS, local stack first

Status: accepted (2026-10-14)

## Context

The spec mandates per-company isolation proven by tests, encrypted tokens,
vector memory and file storage. The existing hosted Supabase project's database
credentials fail from the MCP connection today, so the hosted project cannot be
the development target.

## Decision

Supabase is the data platform: Auth (Google + magic link), Postgres with RLS on
every table keyed by `company_id`/`user_id`, pgvector for `memory_items`, Storage
for artifacts, Vault for OAuth tokens. Schema lives in SQL migrations managed by
the Supabase CLI; TypeScript types are generated. Development and CI run the
local stack in Docker (`supabase start`); production points at a hosted project
configured by the founder.

## Consequences

- RLS tests are first-class (M0 acceptance) and run against a real Postgres.
- The worker uses the service role but asserts a company scope on every query.
- No ORM layer; repositories in `packages/db` wrap supabase-js calls.
