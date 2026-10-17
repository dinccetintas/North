# Runbook: staging

Staging (STG-1) is production's topology with its own accounts, fenced to test
accounts: the web in the Vercel Pro team's `staging` custom environment, the
worker as the Fly app `north-worker-staging` (`apps/worker/fly.staging.toml`),
Supabase `north-staging`, the Inngest environment `staging`; Stripe (sandbox),
Resend (a subdomain that sends and receives), VAPID, Langfuse and optionally
Sentry are accounts with keys. The founder logs into it; the nightly journey
(T3) and the milestone acceptance (T4) run against it. Every file describing
it is in the repo; only the values live in dashboards.

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
- **Spend: a hard ceiling and a daily cap.** The `north-test` Anthropic
  workspace's $50 limit is the hard ceiling. Under it the model gateway caps
  each UTC day at `NORTH_DAILY_CAP_USD` (1 on the `smoke` profile). Every wake
  from auto-stop, deploy and `fly secrets set` restarts the process, so the
  worker seeds the gateway at boot with the day's spend recorded in
  `agent_runs` (`/health` → `budget.seededUsd`); the cap survives restarts
  that way, and a failed read seeds the full cap (nothing runs; fail closed).
  The seed is a lower bound: `agent_runs` holds the SDK's price per run, not
  the gateway's, and a run cut off by the restart may be missing from it.
  M8 follow-up: the gateway persists its own priced spend per day.
- The founder provisions the accounts (`docs/evidence/M7/FOUNDER-CHECKLIST.md`,
  Task 23); whoever deploys runs the commands below. Write values as
  `<your key>` in notes and tickets, never the key.

Placeholders: `<web>` is the production web host (staging is `staging.<web>`),
`<domain>` the mail domain, `<staging ref>` the `north-staging` project ref.
Sections follow production's order; section 15 lists what was never run.

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
7. The service role key goes only to Fly staging, the GitHub environment
   `staging` (`STAGING_SERVICE_ROLE_KEY`, the e2e purge) and a one-off shell.

## 2. Inngest (environment `staging`)

1. Create the environment `staging`; copy its **event key** and **signing key**.
2. After sections 3 and 4, sync `https://staging.<web>/api/inngest` and
   `https://north-worker-staging.fly.dev/api/inngest`.
3. The web is behind Deployment Protection (section 4), so Inngest needs the
   bypass secret. Prefer the header: give the secret to Inngest's Vercel
   integration where it supports Deployment Protection, so it sends
   `x-vercel-protection-bypass` itself. The fallback, syncing
   `…/api/inngest?x-vercel-protection-bypass=<secret>` (Vercel reads that
   query parameter too), puts the secret in the app URL Inngest's dashboard
   shows to everyone with access; rotate it if that URL is shared. Unverified:
   the first sync must list the functions; a 401 means no bypass.
4. Both processes get both keys; `INNGEST_DEV` stays unset (the check fails on
   a serve endpoint in dev mode).

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

- The first deploy boots only with that set: production mode needs
  `INNGEST_SIGNING_KEY`, live mode `CONNECTIONS_ENCRYPTION_KEY` and
  `NORTH_WORKER_PUBLIC_URL`, the SDK runtime `ANTHROPIC_API_KEY` (the
  `north-test` key); `UNSUBSCRIBE_SECRET` is 16+ characters and never the
  sandbox default (without it every outreach send is refused).
- A volume at `/data` hides the image's `/data` directories (root owned when
  fresh), so the `chown` line runs once before the first agent run (Task 15
  ruling); after an `EACCES` under `/data`, run it again and `fly machine restart`.
- The other secrets come in sections 5–9 and 13 (`fly.staging.toml` lists them
  by group); until section 13 the fence lists are empty and deny everything.
- `auto_stop_machines = true`, `min_machines_running = 0`: an idle machine
  stops and the next request (Inngest crons included) waits for its boot, so
  `curl` the health line before a check. It stays on: an always-on
  `performance-2x` is outside the budget. Mode, runtime, profile and the cap
  (`$1` per UTC day, seeded at boot) are in `[env]`; section 11 changes them.
- A task's workspace is `/data/workspaces/<task id>` (`taskWorkspace`,
  `packages/agents`) and stays after the e2e purge (section 12);
  `/data/workspaces/exports` and `/data/agent-config/<company id>` (each
  company's agent config) must persist. Weekly, **staging only**, remove the
  task workspaces untouched for 2 days and nothing else (GNU find):
  ```bash
  fly ssh console --config apps/worker/fly.staging.toml -C "sh -c 'find /data/workspaces -mindepth 1 -maxdepth 1 -type d -mtime +2 -regextype posix-extended -regex \".*/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\" -print -exec rm -rf {} +'"
  ```

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
   MX record shown, with the priority value Resend shows (it will be the only
   MX record on the subdomain). A subdomain is the recommended shape when the
   root already has MX records. Receiving needs no
   TXT record. Resend receives for **any** address on the domain: the inbox
   `e2e@staging.<domain>` and the per-run sign-up addresses
   `e2e-<stamp>-<project>@staging.<domain>` of the live journey.
3. Keys: a **sending** key limited to the domain (the worker's
   `RESEND_API_KEY` and Supabase's SMTP password, section 1.6), and a
   **full-access** key for the e2e reader (`E2E_RESEND_KEY`): a sending-only
   key cannot read received mail. The full-access key lives only in the GitHub
   environment `staging`, never on Fly, Vercel or in a file. The reader (Task 20) lists
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
usage error); `-s` keeps pnpm's banner out of the JSON; drop `--json` for
lines. Green is every check `pass`: the worker with `fence` true, `env`
staging, `mode` live, `runtime` claude-agent-sdk, no replaying gateway,
`unsubscribe` true and the day's budget (spend, cap, boot seed); the web with
`llm` mock; no sandbox route on the worker; no anonymous `companies` row;
private buckets; manifest and service worker; both Inngest endpoints in cloud
mode; the Stripe endpoint (`skip` without the read key, as `usage-ratios` is
without `NORTH_USAGE_READ_KEY`; a skip does not fail). Run it after every
deploy and first in any incident.

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
user. `pnpm staging:purge-e2e` lists the auth users whose address is `e2e-`
and then anything at exactly `E2E_MAIL_DOMAIN` (required) and who were created
at least `--older-than-minutes` ago (default 120, so a run still going keeps
its user; the dry run lists the younger ones it skips), and with `--yes`
purges each through the one delete path: it ends the user's entitlement with
the service role (ADR 0016's smoke cleanup), then the worker's `purgeOwner`
(the purge mark, storage objects, `purge_owner` with reason `e2e`, one
`purge_log` row each, then the auth user).

```bash
read -rs SUPABASE_SERVICE_ROLE_KEY && export SUPABASE_SERVICE_ROLE_KEY   # north-staging's service role key
export NORTH_ENV=staging NORTH_PRODUCTION_SUPABASE_REF=<production ref> \
  SUPABASE_URL=https://<staging ref>.supabase.co E2E_MAIL_DOMAIN=staging.<domain>
pnpm -s staging:purge-e2e              # lists what it would purge and what it skips
pnpm -s staging:purge-e2e -- --yes     # purges, prints the count
unset SUPABASE_SERVICE_ROLE_KEY NORTH_ENV NORTH_PRODUCTION_SUPABASE_REF SUPABASE_URL E2E_MAIL_DOMAIN
```

It refuses before reading anything unless `NORTH_ENV=staging` and
`E2E_MAIL_DOMAIN=staging.<domain>` are set **and** no label of
`SUPABASE_URL`'s host equals `NORTH_PRODUCTION_SUPABASE_REF` (any case); with
no production ref, only `--i-know-this-is-not-production` lets it run. Task
workspaces stay on the volume (section 3 prunes them). The nightly and
acceptance workflows run it last (Task 21) with `STAGING_SUPABASE_URL` and
`STAGING_SERVICE_ROLE_KEY` as `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`.

## 13. Test accounts and connections (the fence, TST-5)

Each connection is a founder's test account and each allow-list names only it;
worker secrets with `--config apps/worker/fly.staging.toml`, public ids on Vercel too.

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
3. Spend: the gateway's `/health` `budget` (the day's spend, cap and boot
   seed; `staging:check` prints them), then the `north-test` workspace in the
   Anthropic console (the hard ceiling).
4. Inngest `staging` → Runs; Langfuse `north-staging`;
   `fly logs --config apps/worker/fly.staging.toml`.

## 15. Founder-gated: what this task could not verify

Task 19 proved the scripts locally (the purge path, the guard, the age floor,
the check's bypass header, the gateway's boot seed, the TOML against the
worker's env schema); no staging account existed, so **nothing here has run
against staging**. Once the founder has provisioned the accounts (section 13,
`FOUNDER-CHECKLIST.md`), run these in order with `set -o pipefail`; each writes
one evidence file under `docs/evidence/M7/` and prints no key.

1. Supabase (section 1; then append the `embedding_queue_depth()` reading, 0 after a memory write):
   ```bash
   (cd packages/db && npx supabase link --project-ref <staging ref> && npx supabase db push && npx supabase functions deploy embed) 2>&1 | tee docs/evidence/M7/staging-supabase.txt
   ```
2. Fly (section 3, after its secrets): the health line reads `env` staging, `fence` true, `runtime` claude-agent-sdk, `mode` live, a `budget` with `seededUsd`.
   ```bash
   { fly deploy --config apps/worker/fly.staging.toml --dockerfile apps/worker/Dockerfile && fly ssh console --config apps/worker/fly.staging.toml -C "sh -c 'mkdir -p /data/workspaces /data/sandbox /data/agent-config && chown -R node:node /data && ls -ld /data/*'" && curl -fsS https://north-worker-staging.fly.dev/health; } 2>&1 | tee docs/evidence/M7/staging-fly-deploy.txt
   ```
3. Vercel (section 4; `VERCEL_AUTOMATION_BYPASS_SECRET` exported): `login 200`, and `401` without the bypass.
   ```bash
   { vercel deploy --target=staging && curl -sS -o /dev/null -w "login %{http_code}\n" -H "x-vercel-protection-bypass: $VERCEL_AUTOMATION_BYPASS_SECRET" https://staging.<web>/login && curl -sS -o /dev/null -w "without bypass %{http_code}\n" https://staging.<web>/login; } 2>&1 | tee docs/evidence/M7/staging-vercel.txt
   ```
4. Inngest (section 2, after both syncs): both introspections read `"mode":"cloud"` with a function count.
   ```bash
   { curl -sS https://north-worker-staging.fly.dev/api/inngest; echo; curl -sS -H "x-vercel-protection-bypass: $VERCEL_AUTOMATION_BYPASS_SECRET" https://staging.<web>/api/inngest; echo; } | tee docs/evidence/M7/staging-inngest.txt
   ```
5. Resend (section 7, after a magic link went to `e2e@staging.<domain>`): the list's metadata (`id`, `to`, `from`, `subject`, `created_at`) shows it.
   ```bash
   curl -sS "https://api.resend.com/emails/receiving?limit=5" -H "Authorization: Bearer $E2E_RESEND_KEY" | tee docs/evidence/M7/staging-resend.txt
   ```
6. The check (section 10; the bypass secret exported): `"ok": true`, every check `pass` (`usage-ratios` may `skip`).
   ```bash
   pnpm -s staging:check -- --web https://staging.<web> --worker https://north-worker-staging.fly.dev --supabase https://<staging ref>.supabase.co --anon-key <staging publishable key> --json | tee docs/evidence/M7/staging-check.json
   ```
7. The connections (section 13): one screenshot per test account, `docs/evidence/M7/staging-connection-<provider>.png`.
8. The live journey (Task 20; the nightly variant, `smoke` profile): `2 passed` (mobile, desktop), or a failure that names the step. Screenshots and `journey-<project>.json` (with the company `slug`) land in `docs/evidence/M7/acceptance/<date>/`; then the costs per company, with section 12's service-role env and `EVIDENCE_ALLOW_REMOTE_DB=1`. Without `E2E_BASE_URL` the spec only skips (`E2E_BASE_URL not set: …`), which proves nothing.
   ```bash
   read -rs E2E_RESEND_KEY && export E2E_RESEND_KEY                         # the full-access key (section 7)
   read -rs VERCEL_AUTOMATION_BYPASS_SECRET && export VERCEL_AUTOMATION_BYPASS_SECRET
   export E2E_BASE_URL=https://staging.<web> E2E_MAIL_PROVIDER=resend E2E_MAIL_DOMAIN=staging.<domain> E2E_EVIDENCE_DATE=$(date -u +%F)
   pnpm e2e:staging 2>&1 | tee docs/evidence/M7/staging-journey.txt
   D=docs/evidence/M7/acceptance/$E2E_EVIDENCE_DATE
   for p in mobile desktop; do EVIDENCE_ALLOW_REMOTE_DB=1 EVIDENCE_WORKER_URL=https://north-worker-staging.fly.dev pnpm -s evidence:costs -- --slug "$(node -p "require('./$D/journey-$p.json').slug")" --out "$D/$p"; done
   ```
9. After the first live journey (Task 20), the purge (section 12, its env exported): `purged N of N e2e user(s)`.
   ```bash
   pnpm -s staging:purge-e2e -- --yes 2>&1 | tee docs/evidence/M7/staging-purge.txt
   ```
