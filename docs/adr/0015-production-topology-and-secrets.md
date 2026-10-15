# ADR 0015: Production topology and where every secret lives

Status: accepted (2026-10-15)

## Context

M6 puts North in front of paying users and the founder's own company. ADR
0006 split the system into a web app and a worker, ADR 0007 fixed the worker
as one Fly.io container with a volume, and the design spec named Vercel,
hosted Supabase and Inngest Cloud. Until now every environment was local:
`pnpm dev` with the Inngest Dev Server, a local Supabase (Docker or the
Docker-free stack), sandbox adapters and the mock runtime. Secrets were
`.env` files, and CI proved only that the worker image builds and that
worker-class secrets never appear in `apps/web/src`.

Launch needs the topology written down in files the repo owns, a rule for
which process may hold which secret, a way to move migrations to the hosted
database, and a check that the deployment the founder is looking at is the
one the repo describes, without that check being able to change anything.
It also needs the sandbox-by-default rule (CLAUDE.md #5) to survive
production: a freshly deployed North must not spend money or contact anyone
until the founder flips it.

## Decision

**Four hosted services, two of ours.** `apps/web` on Vercel (framework
Next.js, root directory `apps/web`, Node 24, `apps/web/vercel.json` for the
build command and the function region; preview deployments on pull
requests, production on `main`). `apps/worker` on Fly.io as ADR 0007 left it
(`apps/worker/fly.toml`, the Dockerfile, one machine, the `/data` volume for
workspaces and the sandbox root; `performance-2x` / 4 GB when the SDK
runtime is on). Hosted Supabase for Auth, Postgres, Storage (two private
buckets: `artifacts`, `exports`) and the RLS the tests prove; migrations
move with `supabase link` + `supabase db push` from `packages/db`, never by
hand in the dashboard. Inngest Cloud with two app syncs, the web's
`/api/inngest` and the worker's `/api/inngest`, one event key and one
signing key per environment. Stripe (test mode until launch), Sentry (one
project for the web, one for the worker), Resend and VAPID as they were.

**Each secret has one home.** The rule is the one CI already enforces,
written out:

| Secret | Web (Vercel) | Worker (Fly) | Notes |
| --- | --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `NEXT_PUBLIC_APP_URL` | yes | yes (URL only) | public |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | never | yes | the service role never leaves the worker |
| `INNGEST_EVENT_KEY` | yes | yes | both send events |
| `INNGEST_SIGNING_KEY` | yes | yes | each serve endpoint verifies its own calls |
| `ANTHROPIC_API_KEY` | never | yes | agents run in the worker only |
| `CONNECTIONS_ENCRYPTION_KEY` | never | yes | ADR 0008 |
| OAuth client secrets (`GITHUB_`, `VERCEL_`, `META_APP_`, `GOOGLE_`, `STRIPE_CONNECT_`) | never (ids only) | yes | ADR 0008, 0010 |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | never | yes | ADR 0014 |
| `SENTRY_CLIENT_SECRET` | never | yes | ADR 0013 |
| `SENTRY_DSN` (worker), `NEXT_PUBLIC_SENTRY_DSN` (web) | public DSN only | worker DSN only | the CI grep matches `SENTRY_DSN` not preceded by `_` |
| `SENTRY_AUTH_TOKEN` | build-time only | never | source maps |
| `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY`, `LANGFUSE_HOST` | never | yes | OBS-1 |
| `RESEND_API_KEY`, `VAPID_PRIVATE_KEY` | never | yes | platform notifications |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | yes | as `VAPID_PUBLIC_KEY` | public |
| `INTEGRATIONS_MODE`, `AGENT_RUNTIME` | mode only (for "Connect (sandbox)") | yes | default `sandbox` / `mock` |
| `RETENTION_PURGE_ENABLED` | never | yes | default off (ADR 0016) |

Fly secrets are set with `fly secrets set`; Vercel's through the project's
environment settings, per environment. Neither is ever committed; `.env.example`
documents every name with its home.

**Production is sandbox until the founder flips it.** The worker's
`INTEGRATIONS_MODE` and `AGENT_RUNTIME` default to `sandbox` and `mock` in
every environment, the production Fly app included. Going live is two
secrets (`INTEGRATIONS_MODE=live`, `AGENT_RUNTIME=claude-agent-sdk`) set by
the founder, in that order, after `production:check` is green in sandbox.
The loopback-only sandbox routes (sites, simulation, clock, billing pages)
are never mounted on `0.0.0.0`, so a public sandbox worker exposes nothing
but `/health`, `/api/inngest` and the two webhooks.

**The production check is read-only.** `scripts/production-check.ts` takes
the two public URLs and the anon key (and, optionally, a restricted
read-only Stripe key) and verifies: both health lines (mode, runtime, which
webhooks are mounted, the worker clock is the wall clock); an anonymous
`select` on `companies` returns zero rows; both buckets refuse an anonymous
list; the manifest and the service worker are served with the right content
types; the Inngest introspection on both serve endpoints reports the
function count; the Stripe webhook endpoint for the worker exists and is
enabled; every user's usage ratio for the period. It issues no write, holds
no service role key, and exits non-zero on the first failure. It is the
last step of the runbook and the first step of any incident.

**CI runs the whole proof.** `.github/workflows/ci.yml` keeps the validate
job and gains an `e2e` job: local Supabase, the web, the worker and the
Inngest Dev Server in sandbox + mock mode, `REQUIRE_SMOKE_M1=1 pnpm validate`
(every smoke, M1 through M6) and `pnpm e2e`. Nothing in CI touches a hosted
service or a key.

## Consequences

- The repo describes production: `vercel.json`, `fly.toml`, the Dockerfile,
  `.env.example`, `docs/runbooks/production.md` and `production-check.ts`.
  A new environment is the runbook plus the secrets table; nothing lives
  only in a dashboard except the values themselves.
- The web bundle can never contain a service role key, a Stripe key or a
  client secret: CI fails before deploy. Adding a secret means adding a row
  to the table above and, if it is worker-class, to the grep.
- A deploy of the worker that drops to sandbox (a missing key) is visible in
  `/health` and in the production check, not in a silent fallback.
- The founder's flip to live is two secrets and one command, reversible the
  same way; the sandbox pages cannot leak onto the public host.
- Migrations reach the hosted database through the CLI with the same files
  the local stack runs, so the integration tests describe production's
  schema.
- A second region or a second worker machine needs the Inngest concurrency
  keys already in place and a second volume; the Fly configuration is the
  place to change it, not the code.
