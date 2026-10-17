# Runbook: production

North in production is four hosted services, two of them ours (ADR 0015):
`apps/web` on Vercel, `apps/worker` on Fly.io, hosted Supabase (Auth,
Postgres, Storage), Inngest Cloud. Stripe, Sentry, Resend, VAPID and
Langfuse are accounts with keys. Every file that describes production lives in
the repo (`apps/web/vercel.json`, `apps/worker/fly.toml`,
`apps/worker/Dockerfile`, `.env.example`, this runbook,
`scripts/production-check.ts`); only the values live in dashboards.

Rules that hold on every step:

- Each secret has one home (ADR 0015's table, `.env.example`). The web never
  gets a worker secret; CI fails if `apps/web/src` names one.
- Production starts in **sandbox + mock** (CLAUDE.md #5). The founder flips it
  (section 11) after a green check in sandbox.
- Stripe runs in **test mode** until launch. Live keys are entered by the
  founder only, in their own shell or dashboard.
- Write values as `<your key>` in notes and tickets, never the key.

Order: Supabase → Inngest → Fly → Vercel → Stripe → Sentry, Resend, VAPID,
Langfuse → production check → the founder's company → (later) the flip.

## 1. Supabase (hosted)

1. Create the project (region close to Fly's `ams`, e.g. Frankfurt). Note the
   project ref, the URL, the publishable (anon) key and the service role key.
2. Migrations, then the Edge Function, move with the CLI only, never by hand
   in the dashboard:
   ```bash
   cd packages/db
   npx supabase link --project-ref <ref>
   npx supabase db push                  # 0001 … 0022: tables, RLS, triggers, both buckets, the embedding queue
   npx supabase functions deploy embed   # added by M7 (LRN-7): embeds memory items and search queries (Supabase.ai gte-small)
   ```
3. Vault (added by M7, founder only): the embedding queue posts to `embed`
   only once the project knows its URL and service key (migration 0021's
   header). SQL editor, once per project, by hand, never in a migration:
   ```sql
   select vault.create_secret('https://<ref>.supabase.co', 'project_url');
   select vault.create_secret('<service role key>', 'service_role_key');
   ```
   After the first memory write, `select public.embedding_queue_depth();`
   falls to 0 within a minute (pg_cron runs `util.process_embeddings` every
   10 s). Without the function, a live worker's query embedding fails and
   memory search goes by words alone; without the two secrets,
   `util.process_embeddings` leaves the queue unread and no item is
   embedded. **The production check (section 10) verifies neither yet**: it
   reads no Edge Function and no queue depth, so run the query above by hand
   after this step.
4. Storage: `artifacts` and `exports` exist after the push and are **private**
   (`public = false`). Do not toggle either to public; the production check fails if one is.
5. Auth → URL configuration: Site URL `https://<web>`; redirect URL
   `https://<web>/auth/callback`. Email (magic link) on; custom SMTP through
   Resend (section 7) so links do not come from the shared sender.
6. Never paste the service role key anywhere but Fly (section 3), the Vault
   secret of step 3 and, for a one-off founder command, your shell.

## 2. Inngest Cloud

1. Create the app environment `production`; copy the **event key** and the
   **signing key**.
2. After sections 3 and 4 are deployed, sync both serve endpoints:
   `https://<web>/api/inngest` and `https://<worker>/api/inngest`
   (Apps → Sync new app, or the Vercel integration for the web).
3. Both processes get both keys (the web sends events, the worker runs and
   sends them). `INNGEST_DEV` must be unset in production; the production
   check fails on a serve endpoint in dev mode.

## 3. Fly (the worker)

```bash
fly launch --no-deploy --copy-config --config apps/worker/fly.toml   # first time
fly volumes create north_workspaces --region ams --size 10
fly secrets set SUPABASE_URL=<url> SUPABASE_SERVICE_ROLE_KEY=<service role key> \
  INNGEST_EVENT_KEY=<event key> INNGEST_SIGNING_KEY=<signing key> \
  NEXT_PUBLIC_APP_URL=https://<web>
fly deploy --config apps/worker/fly.toml --dockerfile apps/worker/Dockerfile
fly ssh console --config apps/worker/fly.toml -C "sh -c 'mkdir -p /data/workspaces /data/sandbox /data/agent-config && chown -R node:node /data'"   # added by M7: once, before the first agent run (the volume hides the image's /data)
curl -fsS https://<worker>.fly.dev/health
```

`fly.toml` lists every secret by group. Leave `INTEGRATIONS_MODE` and
`AGENT_RUNTIME` unset (sandbox, mock). The `[[vm]]` block is
`shared-cpu-2x` / 2 GB for the mock runtime; before the SDK runtime is turned
on, switch it to `performance-2x` / 4 GB (`fly scale vm performance-2x
--memory 4096`). The worker binds `0.0.0.0`, so none of the sandbox routes
(the sites under `/sandbox/sites/`, the billing pages, the simulation and
clock routes) is mounted there, which the production check asserts (404),
and the Stripe webhook only exists once `STRIPE_WEBHOOK_SECRET` is set
(section 5). On a loopback worker (local, CI) every `/sandbox/*` request and
a webhook that verifies with the public sandbox secret need a loopback
`Host` with the worker's port, and a state change a same-origin browser
context or no browser at all.

## 4. Vercel (the web)

1. Import the repository; **Root Directory** `apps/web`; framework Next.js;
   Node 24. `apps/web/vercel.json` sets the install and build commands and the
   function region (`fra1`, next to Fly's `ams`). Pull requests get preview
   deployments; `main` is production.
2. Environment variables (Production, and Preview with preview values):

   | Name | Value |
   | --- | --- |
   | `NEXT_PUBLIC_APP_URL` | `https://<web>` |
   | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | the project URL and the publishable key |
   | `INNGEST_EVENT_KEY`, `INNGEST_SIGNING_KEY` | section 2 |
   | `INTEGRATIONS_MODE` | `sandbox` (it only decides whether settings offer "Connect (sandbox)") |
   | `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | section 8 |
   | `NEXT_PUBLIC_SENTRY_DSN` | the web project's DSN (section 6) |
   | `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, `SENTRY_PROJECT` | build time only, for source maps |
   | `GITHUB_CLIENT_ID`, `GITHUB_OAUTH_SCOPE`, `VERCEL_INTEGRATION_SLUG`, `META_APP_ID`, `GOOGLE_CLIENT_ID` | public OAuth ids |

   Never: `SUPABASE_SERVICE_ROLE_KEY`, `STRIPE_*`, `ANTHROPIC_API_KEY`,
   `CONNECTIONS_ENCRYPTION_KEY`, any `*_CLIENT_SECRET`, `LANGFUSE_SECRET_KEY`,
   `RESEND_API_KEY`, `VAPID_PRIVATE_KEY`, `SENTRY_DSN` (CI fails on any of
   them in a tracked file of `apps/web` outside the e2e harness).

   The billing redirect page follows a session URL only to
   `https://checkout.stripe.com/…` or `https://billing.stripe.com/…`, and,
   while the web's `INTEGRATIONS_MODE` is `sandbox`, to the worker's sandbox
   billing pages at exactly `SANDBOX_SITE_BASE_URL` (default
   `http://127.0.0.1:<WORKER_PORT>`, the worker's own default); anything else
   shows "Billing could not start". Every response carries
   `frame-ancestors 'none'`, `X-Frame-Options: DENY`, `nosniff` and
   `strict-origin-when-cross-origin` (`next.config.ts`).
3. Deploy; open `https://<web>/login`; install it from the browser menu on
   Android and with Share → Add to Home Screen on iOS (screens into
   `docs/evidence/M6/`).

## 5. Stripe (the platform's billing, test mode first)

Prices and credits come from `packages/core/src/billing/plans.ts` only; no
price id lives in code or in an env var.

1. Preview, then create the products, the prices (lookup keys) and the webhook
   endpoint; the script is idempotent and refuses a live-mode key without `--live`:
   ```bash
   pnpm stripe:setup -- --worker-url https://<worker>.fly.dev --dry-run
   STRIPE_SECRET_KEY=<your test key> pnpm stripe:setup -- --worker-url https://<worker>.fly.dev
   ```
2. Dashboard → Developers → Webhooks → the new endpoint → reveal the signing
   secret, then set both keys in one command so the worker never runs with half:
   ```bash
   fly secrets set STRIPE_SECRET_KEY=<your test key> STRIPE_WEBHOOK_SECRET=<signing secret>
   ```
   `/health` now reports `webhooks.stripe: true`.
3. Customer portal (Settings → Billing → Customer portal): allow cancellation
   at the period end, invoice history and payment method updates; return URL
   `https://<web>/settings/billing`. Plan switches: upgrades now with
   proration, **downgrades at the period end** (otherwise an upgrade just
   before a renewal and a downgrade after it return proration credit; plan
   credits are granted only for `subscription_create` / `subscription_cycle`
   invoices, ADR 0014 amendment).
4. Checkout terms: once `https://<web>/legal/terms` is live, set it as the
   terms of service URL (Settings → Public details) so Checkout collects
   consent (`consent_collection.terms_of_service: required`).
5. A **restricted key** for the production check: Developers → API keys →
   Create restricted key, only "Webhook Endpoints: Read". Keep it in your
   shell for the check; it is never stored.
6. Changing a price: edit `plans.ts`, run `stripe:setup` again (a new price,
   the lookup key transferred), deploy. Existing subscriptions keep their price.
   Run `stripe:setup` again too whenever `BILLING_EVENT_TYPES` changes (M6 added
   `checkout.session.async_payment_succeeded`): `production:check` fails while
   the endpoint misses an event the worker handles.
7. The user's own Stripe read (OUT-2) is a separate Connect app: redirect URI
   `https://<web>/api/connections/stripe/callback`, scope `read_only`;
   `fly secrets set STRIPE_CONNECT_CLIENT_ID=<id> STRIPE_CONNECT_CLIENT_SECRET=<secret>`.
   It never shares a key with the platform account.

## 6. Sentry (two projects)

- **Web**: a Next.js project; its DSN is `NEXT_PUBLIC_SENTRY_DSN` on Vercel
  (public). `SENTRY_AUTH_TOKEN` is a Vercel build variable only.
- **Worker**: a Node project; its DSN is `SENTRY_DSN` on Fly (`fly secrets
  set SENTRY_DSN=<dsn>`).
- **Issue webhook (PRO-2)**: an internal integration with the "issue"
  webhook to `https://<worker>.fly.dev/webhooks/sentry`; its client secret is
  `SENTRY_CLIENT_SECRET` on Fly. Link the founder's company to its Sentry
  project (service role, from your shell):
  ```bash
  SUPABASE_URL=<url> SUPABASE_SERVICE_ROLE_KEY=<service role key> pnpm sentry:project -- <company-slug> <sentry-project-slug>
  ```
- Send one test event from each project's settings and keep the screenshot
  (`docs/evidence/M6/`).

## 7. Resend

Verify the sending domain; `fly secrets set RESEND_API_KEY=<key>
RESEND_FROM="North <decisions@your-domain>"`. Use Resend's SMTP credentials
for Supabase Auth's custom SMTP (section 1.5).

## 8. VAPID (web push)

```bash
npx web-push generate-vapid-keys
fly secrets set VAPID_PUBLIC_KEY=<public> VAPID_PRIVATE_KEY=<private> VAPID_SUBJECT=mailto:<you>
```
and `NEXT_PUBLIC_VAPID_PUBLIC_KEY=<public>` on Vercel.

## 9. Langfuse (OBS-1)

`fly secrets set LANGFUSE_PUBLIC_KEY=<pk> LANGFUSE_SECRET_KEY=<sk>
LANGFUSE_HOST=https://cloud.langfuse.com`. `LANGFUSE_REDACT` stays `1`: no
prompt text or tool input leaves the worker. Traces appear once agents run on
the SDK runtime (section 11).

## 10. Verify: the production check (read-only)

```bash
read -rs STRIPE_READ_KEY && export STRIPE_READ_KEY           # optional: the restricted read-only key
read -rs NORTH_USAGE_READ_KEY && export NORTH_USAGE_READ_KEY # optional: a key that may read usage
pnpm production:check -- \
  --web https://<web> --worker https://<worker>.fly.dev \
  --supabase https://<ref>.supabase.co --anon-key <publishable key>
unset STRIPE_READ_KEY NORTH_USAGE_READ_KEY
```

It issues no write and holds no service role key. It checks both health lines
(mode, runtime, webhooks mounted, clock = wall), that the public worker
mounts no sandbox route (`/sandbox/sites/` and `/sandbox/clock` are 404), that
an anonymous select on `companies` returns nothing, that both buckets refuse
an anonymous list and are not public, the manifest and the service worker
with their content types, both Inngest serve endpoints (functions, cloud
mode, keys), and the Stripe endpoint (exists, enabled, every billing event
type). The two keys are read from the environment only: `STRIPE_READ_KEY`
for the Stripe endpoint and `NORTH_USAGE_READ_KEY` for every user's usage
ratio of the month (usage rows are owner-only, so it needs a key that may
read them). There is no flag for either, so neither lands in shell history
or `ps`; `read -s` keeps them off the screen too, and a check without its key
is skipped. `--json` prints the result for the evidence folder. Exit 1 on any
failure. It prints the mode it found: production stays `sandbox` / `mock`
until section 11. Run it after every deploy and first in any incident.

`--env staging` (or `pnpm staging:check`, or `NORTH_CHECK_ENV=staging`) swaps
only the worker health rules (`scripts/production-check-rules.ts`); every
other check runs unchanged. Production needs profile `production`, fence off,
env `production`, a gateway that is off or live (never recording or
replaying) and, with a gateway, a day's budget that is not exhausted. Staging
needs fence on, env `staging`, a gateway that is off, live or recording
(never replaying), one of the three model profiles and, on the SDK runtime,
the gateway's budget on the health line. In both, a live worker must verify
unsubscribe links, and the web's health line must report `llm: "mock"`: the
web never holds the model key and never calls the model (ADR 0019).

## 11. The flip to live (and back)

Only after a green production check in sandbox, and only by the founder:

```bash
fly scale vm performance-2x --memory 4096          # the SDK runtime's machine
fly secrets set CONNECTIONS_ENCRYPTION_KEY=<openssl rand -base64 32> ANTHROPIC_API_KEY=<key>
fly secrets set INTEGRATIONS_MODE=live             # first: real adapters, the user's own connections
fly secrets set AGENT_RUNTIME=claude-agent-sdk     # second: real agents
pnpm production:check -- …                         # mode live, runtime claude-agent-sdk
```

Back to sandbox is the same two secrets (`INTEGRATIONS_MODE=sandbox`,
`AGENT_RUNTIME=mock`), in reverse order. Stripe moves to live keys
separately: `stripe:setup` against the live account with `--live`, then
`STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` replaced together.

## 12. Retention and the purge (RET-1, ADR 0016)

- A subscription that ends pauses every company (`subscription_ended`); data
  stays 90 days (`retention_until`) and exports keep working.
- The daily `retention-sweep` (04:07 UTC) archives the companies of owners
  past retention, marks `purge_due`, and removes expired export objects. With
  `RETENTION_PURGE_ENABLED` unset it deletes nothing else.
- The founder purges on request, through the one delete path (`purge_begin`
  marks the entitlement so nothing can reactivate it → storage objects and the
  owner's worker workspaces → `purge_owner` → `auth.admin.deleteUser`; a
  `purge_log` row records a hash of the user id and the counts). A payment that
  arrives while a purge runs is refused by the database and deleted with the
  user: refund it in the Stripe Dashboard (the event stays unapplied in the
  worker log with reason `purging`). Workspaces live on the worker's disk, so
  run the script on the worker (`fly ssh console`) or with `WORKSPACE_ROOT` set:
  ```bash
  SUPABASE_URL=<url> SUPABASE_SERVICE_ROLE_KEY=<service role key> pnpm purge:due            # lists
  SUPABASE_URL=<url> SUPABASE_SERVICE_ROLE_KEY=<service role key> pnpm purge:due -- --yes   # purges
  ```
- A legal erasure request before `retention_until`: set the user's
  `retention_until` to now in the SQL editor (the only manual row change this
  runbook allows; note the request id), then `pnpm purge:due -- --yes --reason erasure`.
- Turning the automatic purge on is `fly secrets set RETENTION_PURGE_ENABLED=1`
  (a founder decision, M6 founder questions).

## 13. The founder's company (the 30-day run)

1. Sign in at `https://<web>`, subscribe (test card `4242 4242 4242 4242`):
   the plan flips on the webhook, not on the redirect (`billing-confirming` →
   `billing-confirmed`). Screens into `docs/evidence/M6/`.
2. Create the company with its thesis, goal and budget; connect GitHub and
   Vercel; connect the Stripe read (section 5.7); link the Sentry project
   (section 6).
3. Answer cards from the phone; keep the first seven daily briefs and the
   Langfuse traces under `docs/evidence/M6/founder/` (the run continues after
   the milestone closes).
4. Portal cancel once at the end of the test period to record the pause and
   the export (`/settings/export`).

## 14. Incident first steps

1. `pnpm -s production:check -- … --json > docs/evidence/incident-<date>.json` (`-s`: no pnpm banner in the JSON).
2. Stop spend and agents for one company with its kill switch (5 s SLA); for
   everything: `fly secrets set AGENT_RUNTIME=mock` (and
   `INTEGRATIONS_MODE=sandbox` if external effects are the problem).
3. Inngest Cloud → Runs: failed functions, retries; Sentry for both projects;
   `fly logs` for the worker.
4. Billing: Stripe → Webhooks → the endpoint's deliveries. A replayed event is
   a 200 `{ duplicate: true }` and changes nothing; an unknown customer is a
   202 stored unapplied.
