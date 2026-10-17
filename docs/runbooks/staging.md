# Runbook: staging

Staging (STG-1) is production's topology with its own accounts, fenced to test
accounts: `apps/web` in the Vercel Pro team's `staging` custom environment,
`apps/worker` as the Fly app `north-worker-staging`
(`apps/worker/fly.staging.toml`), the hosted Supabase project `north-staging`,
the Inngest environment `staging`. Stripe (sandbox), Resend (a staging
subdomain that sends and receives), VAPID, Langfuse (`north-staging`) and
optionally Sentry are accounts with keys. The founder logs into it; the nightly
journey (T3) and the milestone acceptance (T4) run against it. Every file that
describes staging lives in the repo (`apps/worker/fly.staging.toml`,
`apps/worker/Dockerfile`, `apps/web/vercel.json`, `.env.example`'s staging
block, this runbook, `scripts/production-check.ts`,
`scripts/staging-purge-e2e.ts`); only the values live in dashboards.

Rules that hold on every step:

- **Staging never shares a value with production**: its own Supabase project,
  Inngest keys, encryption key, unsubscribe secret, VAPID pair, OAuth apps and
  Stripe sandbox. Never copy a key from one to the other.
- **Staging is born live, on real Claude, inside the fence.** `fly.staging.toml`
  sets `INTEGRATIONS_MODE=live`, `AGENT_RUNTIME=claude-agent-sdk`,
  `NORTH_ENV=staging` and `NORTH_TEST_FENCE=1`: the gate refuses every outside
  target that is not on the `NORTH_FENCE_*` lists (the Meta sandbox ad account,
  the GitHub test org, `e2e-` Vercel projects, `staging.<domain>` inboxes, and
  `sk_test_` Stripe keys, built in). Empty lists deny everything (TST-5).
- **Spend is capped twice**: the `north-test` Anthropic workspace ($50 limit) and
  the gateway's `NORTH_DAILY_CAP_USD` (1 on the `smoke` profile).
- The founder provisions the accounts (`docs/evidence/M7/FOUNDER-CHECKLIST.md`,
  Task 23); whoever deploys runs the commands below. Write values as
  `<your key>` in notes and tickets, never the key.

Placeholders: `<web>` is the web's production host (staging is
`staging.<web>`), `<domain>` the mail domain (staging mail is
`staging.<domain>`), `<staging ref>` the `north-staging` project ref.

Order: Supabase → Inngest → Fly → Vercel → Stripe → Sentry, Resend, VAPID,
Langfuse → staging check → mode and profile → the e2e purge → test accounts →
incidents. Section 15 lists what was never run.

## 1. Supabase (`north-staging`)

1. Create the project `north-staging` on the free plan (region Frankfurt, next
   to Fly's `ams`). Note the ref, the URL, the publishable (anon) key, the
   service role key and the database password. The free plan pauses a project
   after a week without activity; the nightly run keeps it awake.
2. Migrations, then the Edge Function, with the CLI only:
   ```bash
   cd packages/db
   npx supabase link --project-ref <staging ref>
   npx supabase db push                  # 0001 … 0022: tables, RLS, triggers, both buckets, the embedding queue
   npx supabase functions deploy embed   # LRN-7: embeds memory items (Supabase.ai gte-small)
   ```
3. Vault: the embedding queue posts to `embed` only once the project knows its
   URL and service key (0021's header). SQL editor, once per project, by hand,
   never in a migration:
   ```sql
   select vault.create_secret('https://<staging ref>.supabase.co', 'project_url');
   select vault.create_secret('<staging service role key>', 'service_role_key');
   ```
   After the first memory write, `select public.embedding_queue_depth();` falls
   to 0 within a minute (pg_cron runs `util.process_embeddings` every 10 s).
4. Storage: `artifacts` and `exports` are **private** after the push; the
   staging check fails if one is public.
5. Auth → URL configuration: Site URL `https://staging.<web>`; redirect URL
   `https://staging.<web>/auth/callback`. Email (magic link) on.
6. Auth → SMTP: **custom SMTP through Resend is required**, not optional: the
   hosted built-in mailer only delivers to the project's team members, so a
   magic link to `e2e-…@staging.<domain>` would never arrive. Host
   `smtp.resend.com`, port 465, user `resend`, password the sending key
   (section 7), sender `North Staging <auth@staging.<domain>>`. Check Auth →
   Rate Limits allows a few sign-ins an hour (each run signs up once).
7. The service role key goes to Fly staging (section 3), the GitHub environment
   `staging` (`STAGING_SERVICE_ROLE_KEY`, for the e2e purge) and, for a one-off
   command, your shell. Nowhere else.

## 2. Inngest (environment `staging`)

1. Create the environment `staging`; copy its **event key** and **signing key**.
2. After sections 3 and 4 are deployed, sync both serve endpoints:
   `https://staging.<web>/api/inngest` and
   `https://north-worker-staging.fly.dev/api/inngest`.
3. The web sits behind Deployment Protection (section 4), so Inngest needs the
   bypass secret to reach `/api/inngest`: give it to Inngest's Vercel
   integration, or sync the URL with `?x-vercel-protection-bypass=<secret>`
   (Vercel reads the bypass from a header or that query parameter). Not
   verified in this task: on the first sync the app must list its functions; a
   401 means the bypass is missing.
4. Both processes get both keys; `INNGEST_DEV` stays unset (the staging check
   fails on a serve endpoint in dev mode).

## 3. Fly (the worker, `north-worker-staging`)

```bash
fly launch --no-deploy --copy-config --config apps/worker/fly.staging.toml   # first time; keep the name north-worker-staging
fly volumes create north_staging_data --config apps/worker/fly.staging.toml --region ams --size 3
fly secrets set --config apps/worker/fly.staging.toml \
  SUPABASE_URL=https://<staging ref>.supabase.co SUPABASE_SERVICE_ROLE_KEY=<staging service role key> \
  INNGEST_EVENT_KEY=<staging event key> INNGEST_SIGNING_KEY=<staging signing key> \
  NEXT_PUBLIC_APP_URL=https://staging.<web> NORTH_WORKER_PUBLIC_URL=https://north-worker-staging.fly.dev \
  ANTHROPIC_API_KEY=<north-test workspace key> \
  CONNECTIONS_ENCRYPTION_KEY=<openssl rand -base64 32> UNSUBSCRIBE_SECRET=<openssl rand -hex 32>
fly deploy --config apps/worker/fly.staging.toml --dockerfile apps/worker/Dockerfile
fly ssh console --config apps/worker/fly.staging.toml \
  -C "sh -c 'mkdir -p /data/workspaces /data/sandbox /data/agent-config && chown -R node:node /data'"
curl -fsS https://north-worker-staging.fly.dev/health
```

- The first deploy boots only with that first set: `NODE_ENV=production` needs
  `INNGEST_SIGNING_KEY`; live mode needs `CONNECTIONS_ENCRYPTION_KEY` and
  `NORTH_WORKER_PUBLIC_URL`; the SDK runtime needs `ANTHROPIC_API_KEY` (the
  `north-test` workspace's key, never production's); `UNSUBSCRIBE_SECRET` is 16
  characters or more and never `sandbox-unsubscribe-secret` (without it every
  outreach send is refused).
- The volume mounted at `/data` hides the image's `/data` directories (root
  owned on a fresh volume), so the `chown` line runs once, before the first
  agent run (Task 15 ruling). If a run logs `EACCES` under `/data`, run it
  again and `fly machine restart --config apps/worker/fly.staging.toml`.
- `fly.staging.toml` lists every secret by group; the connection and fence
  secrets come in section 13, the billing ones in section 5, the delivery and
  observability ones in sections 6–9. Until section 13 the fence lists are
  empty and the fence denies every outside target.
- `auto_stop_machines = true`, `min_machines_running = 0`: an idle staging
  machine stops and the next request (Inngest's cron calls included) starts it.
  The first request after a stop waits for the boot; `curl` the health line
  before a check.
- Mode, runtime, profile and cap are in `[env]` (`live`, `claude-agent-sdk`,
  `smoke`, `$1`); section 11 changes them for one run.
- The task workspaces of purged e2e users stay on the volume (section 12). Once
  a week, **staging only**:
  `fly ssh console --config apps/worker/fly.staging.toml -C "sh -c 'find /data/workspaces /data/agent-config -mindepth 1 -maxdepth 1 -mtime +2 -exec rm -rf {} +'"`.

## 4. Vercel (the web, the Pro team's `staging` environment)

1. Custom environments need Pro or Enterprise (Pro: one per project, no extra
   cost; Vercel docs updated 2026-09-17). In the production project: Settings →
   Environments → Create Environment: name `staging`, **Branch Tracking** on
   with the branch `staging`, attach the domain `staging.<web>` (add the DNS
   record Vercel shows), and import the variables from Preview, then replace
   every value below. The environment's domain points at its latest
   deployment.
2. Environment variables of `staging` (`vercel env add <NAME> staging` prompts
   for the value; `vercel pull --environment=staging` reads them back):

   | Name | Value |
   | --- | --- |
   | `NEXT_PUBLIC_APP_URL` | `https://staging.<web>` |
   | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | `north-staging`'s URL and publishable key |
   | `INNGEST_EVENT_KEY`, `INNGEST_SIGNING_KEY` | section 2 |
   | `INTEGRATIONS_MODE` | `live` (settings offer the real Connect buttons; the worker enforces the mode) |
   | `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | section 8 |
   | `NEXT_PUBLIC_SENTRY_DSN` | section 6, or unset |
   | `GITHUB_CLIENT_ID`, `GITHUB_OAUTH_SCOPE`, `VERCEL_INTEGRATION_SLUG`, `META_APP_ID`, `GOOGLE_CLIENT_ID` | the staging apps' public ids (section 13) |

   Never, as in production: `SUPABASE_SERVICE_ROLE_KEY`, `STRIPE_*`,
   `ANTHROPIC_API_KEY`, `CONNECTIONS_ENCRYPTION_KEY`, any `*_CLIENT_SECRET`,
   `LANGFUSE_SECRET_KEY`, `RESEND_API_KEY`, `VAPID_PRIVATE_KEY`, `SENTRY_DSN`,
   `UNSUBSCRIBE_SECRET`. Leave `AGENT_RUNTIME` unset too: the web's health line
   must read `llm: "mock"` (the web never calls the model; the check fails
   otherwise).
3. **Deployment Protection** (Settings → Deployment Protection): Vercel
   Authentication on, so only team members open `staging.<web>`, and
   **Protection Bypass for Automation**: generate the secret. Machines send it
   as the header `x-vercel-protection-bypass`. Who needs it: the live
   journey's Playwright config (Task 20), `pnpm staging:check` (it reads
   `VERCEL_AUTOMATION_BYPASS_SECRET` from the environment and sends it to the
   web's origin only), Inngest (section 2.3). Store it in the GitHub environment
   `staging` as `VERCEL_AUTOMATION_BYPASS_SECRET`.
4. Deploy: push the branch `staging`, or from the repository root (the
   project's Root Directory is `apps/web`; `vercel link` once, the CLI keeps
   `.vercel/` out of git):
   ```bash
   vercel deploy --target=staging
   ```
   Open `https://staging.<web>/login` signed in to Vercel as a team member.
   `apps/web/vercel.json` needs no change for a custom environment.

## 5. Stripe (sandbox only)

Staging never holds a live key: the fence allows `sk_test_` only. Use a Stripe
sandbox of its own (Dashboard → Sandboxes), so staging's events never reach
production's test-mode endpoint.

```bash
pnpm stripe:setup -- --worker-url https://north-worker-staging.fly.dev --dry-run
STRIPE_SECRET_KEY=<sk_test_…> pnpm stripe:setup -- --worker-url https://north-worker-staging.fly.dev
fly secrets set STRIPE_SECRET_KEY=<sk_test_…> STRIPE_WEBHOOK_SECRET=<signing secret> --config apps/worker/fly.staging.toml
```

The portal, the terms URL and the restricted read key are as in production
(production runbook, section 5), with `https://staging.<web>`. The user's own
Stripe read (OUT-2) uses the sandbox's Connect client:
`fly secrets set STRIPE_CONNECT_CLIENT_ID=<id> STRIPE_CONNECT_CLIENT_SECRET=<secret> --config apps/worker/fly.staging.toml`,
redirect URI `https://staging.<web>/api/connections/stripe/callback`.

## 6. Sentry (optional)

Staging runs without Sentry when both DSNs are unset. To prove the issue
webhook (PRO-2) there, create staging projects: `SENTRY_DSN` and
`SENTRY_CLIENT_SECRET` on Fly staging (the internal integration's webhook is
`https://north-worker-staging.fly.dev/webhooks/sentry`),
`NEXT_PUBLIC_SENTRY_DSN` on Vercel `staging`.

## 7. Resend (`staging.<domain>`: sends and receives)

Facts below from Resend's docs, read 2026-10-17.

1. Domains → Add `staging.<domain>`; add the sending records Resend shows;
   verify.
2. **Receiving**: the domain's details → the receiving toggle on; add the single
   MX record shown, at the lowest priority for that name. A subdomain is the
   recommended shape when the root already has MX records. Receiving needs no
   TXT record. Resend receives for **any** address on the domain: the inbox
   `e2e@staging.<domain>` and the per-run sign-up addresses
   `e2e-<stamp>-<project>@staging.<domain>` of the live journey.
3. Keys: a **sending** key limited to the domain (the worker's
   `RESEND_API_KEY` and Supabase's SMTP password, section 1.6), and a key that
   may read received mail for the e2e reader only (`E2E_RESEND_KEY` in the
   GitHub environment `staging`). The reader (Task 20) lists
   `GET https://api.resend.com/emails/receiving?limit=<1..100>` (paged with
   `after`/`before`; there is **no recipient filter**, so it matches `to`
   itself) and reads `GET https://api.resend.com/emails/receiving/{id}` for
   `html` and `text`.
4. `fly secrets set RESEND_API_KEY=<sending key> RESEND_FROM="North Staging <decisions@staging.<domain>>" --config apps/worker/fly.staging.toml`

## 8. VAPID (web push)

A staging pair, never production's:

```bash
npx web-push generate-vapid-keys
fly secrets set VAPID_PUBLIC_KEY=<public> VAPID_PRIVATE_KEY=<private> VAPID_SUBJECT=mailto:<you> --config apps/worker/fly.staging.toml
```
and `NEXT_PUBLIC_VAPID_PUBLIC_KEY=<public>` on Vercel `staging`.

## 9. Langfuse (`north-staging`)

Create the project `north-staging`;
`fly secrets set LANGFUSE_PUBLIC_KEY=<pk> LANGFUSE_SECRET_KEY=<sk> LANGFUSE_HOST=https://cloud.langfuse.com --config apps/worker/fly.staging.toml`.
`LANGFUSE_REDACT` stays `1` as in production. Judge scores of the nightly land
here (spec section 8).

## 10. Verify: the staging check (read-only)

```bash
curl -fsS https://north-worker-staging.fly.dev/health > /dev/null              # wake the machine (auto-stop)
read -rs VERCEL_AUTOMATION_BYPASS_SECRET && export VERCEL_AUTOMATION_BYPASS_SECRET
read -rs STRIPE_READ_KEY && export STRIPE_READ_KEY                            # optional: the sandbox's restricted read key
pnpm -s staging:check -- \
  --web https://staging.<web> --worker https://north-worker-staging.fly.dev \
  --supabase https://<staging ref>.supabase.co --anon-key <staging publishable key> --json \
  > docs/evidence/M7/staging-check.json
unset VERCEL_AUTOMATION_BYPASS_SECRET STRIPE_READ_KEY
```

`pnpm staging:check` already passes `--env staging` (a second `--env` is a
usage error); `pnpm production:check -- --env staging …` is the same command.
`-s` keeps pnpm's banner out of the JSON file; drop `--json` to read it as
lines. Green means every check `pass`: the worker line with `fence` true,
`env` staging, `mode` live, `runtime` claude-agent-sdk, a gateway that is not
replaying, `unsubscribe` true and the day's budget on the line; the web line
with `llm` mock; `/sandbox/sites/` and `/sandbox/clock` 404 on the worker; no
anonymous row in `companies`; both buckets private; manifest and service
worker; both Inngest endpoints in cloud mode with both keys; the Stripe endpoint (with the read key; without it, and
without `NORTH_USAGE_READ_KEY`, those two `skip`, which does not fail). Exit 1
on any failure. Run it after every deploy and first in any incident.

## 11. Mode, runtime and profile (no flip)

Staging has no flip: it starts live on the SDK runtime. Secrets override
`[env]`, which is how a workflow changes the profile for one run and resets it:

```bash
fly secrets set NORTH_MODEL_PROFILE=staging NORTH_DAILY_CAP_USD=3 --config apps/worker/fly.staging.toml      # biweekly fidelity run
fly secrets set NORTH_MODEL_PROFILE=production NORTH_DAILY_CAP_USD=10 --config apps/worker/fly.staging.toml  # milestone acceptance
fly secrets unset NORTH_MODEL_PROFILE NORTH_DAILY_CAP_USD --config apps/worker/fly.staging.toml              # back to smoke / $1
```

A cheap, idle staging is `fly secrets set AGENT_RUNTIME=mock INTEGRATIONS_MODE=sandbox --config apps/worker/fly.staging.toml`;
unset both to return. Never turn the fence off on staging.

## 12. Purging e2e users (RET-1, ADR 0016)

Every live journey signs up a fresh `e2e-<stamp>-<project>@staging.<domain>`
user. `pnpm staging:purge-e2e` lists the auth users whose address has that
shape (`e2e-` and then anything, at exactly `E2E_MAIL_DOMAIN`, or at any
`staging.<domain>` host when it is unset) and, with `--yes`, purges each through
the one delete path: it ends the user's entitlement with the service role
(ADR 0016's smoke cleanup), then the worker's `purgeOwner` (the purge mark,
storage objects, `purge_owner` with reason `e2e`, one `purge_log` row each,
then the auth user).

```bash
read -rs SUPABASE_SERVICE_ROLE_KEY && export SUPABASE_SERVICE_ROLE_KEY   # north-staging's service role key
export NORTH_ENV=staging NORTH_PRODUCTION_SUPABASE_REF=<production ref> \
  SUPABASE_URL=https://<staging ref>.supabase.co E2E_MAIL_DOMAIN=staging.<domain>
pnpm staging:purge-e2e              # lists
pnpm staging:purge-e2e -- --yes     # purges, prints the count
unset SUPABASE_SERVICE_ROLE_KEY NORTH_ENV NORTH_PRODUCTION_SUPABASE_REF SUPABASE_URL E2E_MAIL_DOMAIN
```

It refuses before reading anything unless `NORTH_ENV=staging` is set **and**
`SUPABASE_URL` does not contain `NORTH_PRODUCTION_SUPABASE_REF`; without a
production ref it refuses unless you pass `--i-know-this-is-not-production`.
Task workspaces stay on the worker's volume (the image carries no scripts);
section 3 prunes them. The nightly and acceptance workflows run the same
command last (Task 21), with the environment's `STAGING_SUPABASE_URL` and
`STAGING_SERVICE_ROLE_KEY` as `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`.

## 13. Test accounts and connections (the fence, TST-5)

Each connection is the founder's test account, and each allow-list names only
it. Set the worker's secrets with `--config apps/worker/fly.staging.toml`, the
public ids on Vercel `staging` too.

1. **GitHub**: a test organisation (e.g. `<test-org>`) and a staging OAuth app
   owned by it: homepage `https://staging.<web>`, callback
   `https://staging.<web>/api/connections/github/callback`. Fly:
   `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`,
   `NORTH_FENCE_GITHUB_OWNERS=<test-org>`; Vercel: `GITHUB_CLIENT_ID`,
   `GITHUB_OAUTH_SCOPE=repo`.
2. **Vercel** (deploy connection): a staging integration, redirect
   `https://staging.<web>/api/connections/vercel/callback`. Fly:
   `VERCEL_CLIENT_ID`, `VERCEL_CLIENT_SECRET`, `NORTH_FENCE_VERCEL_PREFIX=e2e-`
   (the default); Vercel: `VERCEL_INTEGRATION_SLUG`. Agents may only touch
   `e2e-` projects.
3. **Google** (Gmail outreach): a Google Cloud OAuth client whose consent
   screen stays in **Testing**, the founder's test Gmail as a test user, scopes
   `gmail.send` and `gmail.readonly`, redirect
   `https://staging.<web>/api/connections/gmail/callback`. Fly:
   `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`; Vercel: `GOOGLE_CLIENT_ID`.
   **In Testing, consent lapses every 7 days**: reconnect Gmail in the staging
   settings weekly until the consent screen is published. Outreach may only go
   to `NORTH_FENCE_RECIPIENT_DOMAINS=staging.<domain>` (subdomains too), which
   lands in Resend's receiving inbox (section 7).
4. **Meta** (ads): the Meta app in development mode (the founder as tester),
   Graph API v26.0, a **sandbox ad account**, redirect
   `https://staging.<web>/api/connections/meta_ads/callback`. Fly: `META_APP_ID`,
   `META_APP_SECRET`, `NORTH_FENCE_META_AD_ACCOUNTS=act_<sandbox account id>`;
   Vercel: `META_APP_ID`.
5. **Anthropic**: the `north-test` workspace with a $50 spend limit; its key is
   Fly's `ANTHROPIC_API_KEY` (section 3) and the repository secret
   `ANTHROPIC_TEST_API_KEY` (the per-PR LLM smoke).
6. Sign in at `https://staging.<web>`, create a company, connect each account
   from Settings and keep the screenshots in `docs/evidence/M7/`.

## 14. Incident first steps

1. `pnpm -s staging:check -- … --json > docs/evidence/incident-staging-<date>.json`.
2. Stop agents for one company with its kill switch (5 s SLA); for everything:
   `fly secrets set AGENT_RUNTIME=mock --config apps/worker/fly.staging.toml`
   (and `INTEGRATIONS_MODE=sandbox` if external effects are the problem), or
   `fly scale count 0 --config apps/worker/fly.staging.toml`.
3. Spend: the gateway's `/health` `budget` (the day's spend and cap), then the
   `north-test` workspace in the Anthropic console.
4. Inngest `staging` → Runs; Langfuse `north-staging`;
   `fly logs --config apps/worker/fly.staging.toml`.

## 15. Founder-gated: what this task could not verify

Task 19 wrote the files and proved the scripts locally (the purge path, the
guard, the check's bypass header, the TOML against the worker's env schema);
no staging account existed, so **nothing here has run against staging**. Once
the founder has provisioned the accounts (Supabase `north-staging`, Fly app and
token, the Vercel Pro `staging` environment with its domain and bypass secret,
Inngest `staging`, Resend `staging.<domain>` with receiving and its keys, the
Stripe sandbox, the GitHub test org and its OAuth app, the Google OAuth client
in Testing, the Meta sandbox ad account, Langfuse `north-staging`, the
`north-test` key as Fly's `ANTHROPIC_API_KEY` and as `ANTHROPIC_TEST_API_KEY`),
run, in order:

1. Supabase (section 1): `cd packages/db && npx supabase link --project-ref <staging ref> && npx supabase db push && npx supabase functions deploy embed`,
   then the two `vault.create_secret` lines, the Auth URLs and the Resend SMTP.
   Evidence: the push output; `select public.embedding_queue_depth();` at 0
   after a memory write; a magic link arriving at `e2e@staging.<domain>`.
2. Fly (section 3): `fly launch --no-deploy --copy-config --config apps/worker/fly.staging.toml`,
   `fly volumes create north_staging_data --config apps/worker/fly.staging.toml --region ams --size 3`,
   the `fly secrets set … --config apps/worker/fly.staging.toml` lines of
   sections 3, 5, 7–9 and 13,
   `fly deploy --config apps/worker/fly.staging.toml --dockerfile apps/worker/Dockerfile`,
   the `chown` line. Evidence: `curl -fsS https://north-worker-staging.fly.dev/health`
   reads `env` staging, `fence` true, `runtime` claude-agent-sdk, `mode` live.
3. Vercel (section 4): the environment, its variables, Deployment Protection,
   then `vercel deploy --target=staging`. Evidence: `https://staging.<web>/login`
   opens for a team member.
4. Inngest (section 2): sync both endpoints, the web's through the bypass.
   Evidence: both apps listed with their functions.
5. The check (section 10):
   `pnpm -s staging:check -- --web https://staging.<web> --worker https://north-worker-staging.fly.dev --supabase https://<staging ref>.supabase.co --anon-key <staging publishable key> --json > docs/evidence/M7/staging-check.json`
   with `VERCEL_AUTOMATION_BYPASS_SECRET` exported. Evidence:
   `docs/evidence/M7/staging-check.json` with `"ok": true` and every check `pass`
   (`usage-ratios` is `skip` without `NORTH_USAGE_READ_KEY`, which is fine).
6. The connections (section 13). Evidence: one screenshot per connected test
   account in `docs/evidence/M7/`.
7. After the first live journey (Task 20), the purge (section 12):
   `pnpm staging:purge-e2e -- --yes`. Evidence: `purged N of N e2e user(s)`.
