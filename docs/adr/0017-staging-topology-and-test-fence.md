# ADR 0017: Staging topology and the test-account fence

Status: accepted (2026-10-17)

## Context

ADR 0015 wrote production down: four hosted services, one home per secret, a
read-only check, and the rule that a freshly deployed North stays in sandbox
(`INTEGRATIONS_MODE=sandbox`, `AGENT_RUNTIME=mock`) until the founder flips
it. Every test so far ran on the local stack in that mode: sandbox adapters,
the mock runtime, Mailpit for the magic link. Nothing proved that the founder
journey works with real Claude, real adapters and a real inbox.

M7 asks for that proof (spec section 8,
`docs/superpowers/specs/2026-10-16-north-studio-phase-design.md`): STG-1, a
staging environment the founder logs into; TST-3, a nightly real journey on
it; TST-4, a milestone live acceptance with founder approval and committed
evidence; TST-5, a test-account fence in `gate()`. A staging that runs live
adapters holds live-capable keys, so something has to make it impossible for
a staging run to reach anything but the founder's test accounts, and
production must be unable to run with staging's relaxations (a fence,
recorded model calls, a cheaper model profile). Every live journey also signs
up a fresh user, and North has exactly one delete path (ADR 0016); staging
needs to remove those users without opening a second one.

## Decision

**Staging is production's topology with its own accounts.** The same code and
the same worker image, in five hosted pieces that share no value with
production (`docs/runbooks/staging.md`). The web runs in the Vercel Pro team's
custom environment `staging` of the production project (Branch Tracking on
the branch `staging`, the domain `staging.<web>`,
`vercel deploy --target=staging`), behind Deployment Protection with
Protection Bypass for Automation, so only team members and machines holding
the bypass secret reach it. The worker is the Fly app `north-worker-staging`
(`apps/worker/fly.staging.toml`): the production Dockerfile, region `ams`,
the volume `north_staging_data` at `/data`, a `performance-2x` / 4 GB machine
that stops when idle (`auto_stop_machines = true`,
`min_machines_running = 0`). The database is a separate Supabase project,
`north-staging`, migrated with the same CLI commands as production plus the
`embed` Edge Function, with custom SMTP through Resend (the hosted mailer delivers only to the project's
team members, so a magic link to an e2e address would never arrive). Inngest
has an environment `staging` with both serve endpoints synced. Resend has the
subdomain `staging.<domain>`, which sends (the worker's mail, Supabase Auth's
SMTP) and receives: one MX record, and any address on the domain lands in
Resend's receiving inbox, the inbox `e2e@staging.<domain>` and the per-run
sign-up addresses `e2e-<stamp>-<project>@staging.<domain>` alike. The journey
reads the magic link through Resend's receiving API with a full-access key
that lives only in the GitHub environment. Stripe is a sandbox of its own,
Langfuse a `north-staging` project, VAPID a staging pair, Sentry optional.

**Staging is born live, on real Claude, inside the fence.** Unlike
production, the `[env]` block of `fly.staging.toml` sets
`INTEGRATIONS_MODE=live` and `AGENT_RUNTIME=claude-agent-sdk`, together with
`NORTH_ENV=staging`, `NORTH_TEST_FENCE=1`, `NORTH_MODEL_PROFILE=smoke`,
`NORTH_DAILY_CAP_USD=1` and `NORTH_CASSETTE_MODE=off`. The model key is the
`north-test` Anthropic workspace's, whose $50 spend limit is the hard ceiling
under the gateway's daily cap (ADR 0019). A workflow raises the profile and
the cap for one run with `fly secrets set` (a secret overrides `[env]`) and
resets them afterwards. The staging web carries neither `AGENT_RUNTIME` nor a
model key, so its health line reads `llm: "mock"`.

**The fence is a block inside `gate()`.** `packages/core/src/authority/fence.ts`
holds the policy (`FencePolicy`) and the pure verdict (`fenceVerdict`).
`gate()` (`packages/core/src/authority/gate.ts`) checks, in order, the kill
switch, the fence, the outreach rules (CMP-1), the budget cap, the auto rules
and the tier; a fence block is final (no card or auto rule rescues it) and
carries the tier of what it stopped. The worker names the outside targets
before the gate decides (`fenceTargetsOf` in
`apps/worker/src/services/fence-targets.ts`, `fenceCheckFor` in
`apps/worker/src/services/fence.ts`): every `act:` ad account of the owner's
Meta connection; the GitHub connection's login and, for a push or a pull
request, the owner of `payload.fullName`, which must be a plain `owner/repo`
(`isRepoFullName`) because the adapter puts it into an API path; the Vercel
project the payload names; every address a send could reach (the batch list,
`to`, `cc`, `bcc`). Payload targets are read in both modes, connection
targets only in live mode, where an adapter reaches out. No action kind names
a Stripe key: the platform's own key is fenced at start-up instead, where
`stripeBillingConfig` (`packages/integrations/src/live/stripe-billing.ts`)
refuses a key that is not a test key (`isStripeTestKey`: `sk_test_` or
`rk_test_`) while the fence is on, and billing stays on the sandbox adapter. A
target that cannot be named becomes an `unknown` target that no policy lets
through, so an action never passes by omission. Three groups carry no target:
kinds without an outside effect, the cap raise (`budget.cap.raise` writes
North's own budget row) and the kinds that only stop spend (`ads.pause`): a
fence must never keep money flowing. A fenced action is recorded `blocked`
with the marker `test_fence` and a `blocked_reason` naming the first target
outside the fence, on one line and cut at 80 characters.

**Default deny, allow-lists from the environment only.** The fence is on only
when `NORTH_TEST_FENCE` is exactly `1` (`fencePolicyFromEnv`), and the
worker's schema refuses any value but `0` and `1`. The lists are
`NORTH_FENCE_META_AD_ACCOUNTS`, `NORTH_FENCE_GITHUB_OWNERS` and
`NORTH_FENCE_RECIPIENT_DOMAINS` (comma-separated) and
`NORTH_FENCE_VERCEL_PREFIX` (default `e2e-`). They start empty, so an
unconfigured fence lets through only `e2e-*` Vercel projects (and, for a
`stripe_key` target, an `sk_test_` prefix). A recipient passes only as
exactly one readable address at an allowed domain or one of its subdomains.
`apps/worker/src/env.ts` checks the shape of every entry and fails boot on a
malformed one (a `;` separator, an `@` in a login), and `fencePolicyFor`
normalises Meta ids to `act_<digits>`. No table, page, card or agent can
widen the fence: changing it is a Fly secret and a restart (section 13 of the
runbook).

**`NORTH_ENV` names the deployment, and the guards run both ways.** Under
`NODE_ENV=production` the worker refuses to boot with `NORTH_TEST_FENCE=1`,
with a cassette mode other than `off` or with a model profile other than
`production`, unless `NORTH_ENV=staging` (`apps/worker/src/env.ts`): a
production worker cannot run fenced, recording or on cheaper models. The
other direction is the staging check. `pnpm staging:check` is
`scripts/production-check.ts` with `--env staging` (or
`NORTH_CHECK_ENV=staging`), and the env swaps only the worker health rules
of `scripts/production-check-rules.ts`. Production needs profile
`production`, fence off, env `production`, a gateway that is off or live and
a day's budget that is not exhausted; staging needs fence on, env `staging`,
a gateway that is off, live or recording (a replaying one would test nothing
real), one of the three profiles and, on the SDK runtime, the gateway's
budget on the health line. In both, a live worker must verify unsubscribe
links and the web must report `llm: "mock"`. Both workflows run the check
before the journey, so a staging worker without its fence fails the run
before the journey starts.

**The e2e purge goes through ADR 0016's delete path.**
`pnpm staging:purge-e2e` (`scripts/staging-purge-e2e.ts`) is the only new way
M7 deletes anything, and it opens no new path: for each e2e user it ends the
entitlement with the service role and calls the worker's `purgeOwner` with
reason `e2e` (`purgeTestUser` in `scripts/lib/purge-smoke-user.ts`, ADR
0016's smoke cleanup, which the smokes now share). It refuses before reading
anything unless `NORTH_ENV=staging`, `E2E_MAIL_DOMAIN` is set to
`staging.<domain>` and no label of `SUPABASE_URL`'s host equals
`NORTH_PRODUCTION_SUPABASE_REF` (with no production ref it needs
`--i-know-this-is-not-production`). It matches only `e2e-*@` exactly that
domain, never the inbox `e2e@`; it leaves users younger than
`--older-than-minutes` (default 120) so a run still going keeps its user; it
only lists without `--yes`; each purge writes its `purge_log` row.

**Two workflows run staging, each behind a GitHub environment.**
`.github/workflows/nightly-staging.yml` (TST-3) runs at 02:17 UTC or by hand
in the environment `staging`, on the `smoke` profile with a $1 cap, or
`staging` with $3 for the biweekly fidelity run.
`.github/workflows/acceptance.yml` (TST-4) runs by hand only, in the
environment `acceptance`, whose required reviewer is the founder, on the
`production` profile with $10. Both deploy
the default branch in one order (configuration check, `supabase db push`,
`vercel deploy --target=staging`, the worker with the run's profile staged),
then run the staging check, the journey and the cost per company, reset the
worker to `smoke` / $1 when they raised it, run the evidence guard, and purge
their e2e users with `--older-than-minutes 0`. They share the concurrency
group `staging-journey`: one run at a time, and a running one is never
cancelled. Both environments limit deployment branches to the default
branch (a repository setting the founder makes), and `acceptance` also
refuses any other ref in a job of its own before the founder is asked to
approve. The nightly keeps its evidence as a 7-day artifact and opens an
issue on red; the acceptance commits its evidence through a pull request
(`docs/evidence/README.md`). Until
`vars.STAGING_WEB_URL` is set, a run is a green skip with a notice. The
repository must stay private: a failed run's artifacts (the Playwright report
and traces) can hold the Vercel bypass cookie and the e2e users' session
tokens.

## Consequences

- The repo describes staging as it describes production:
  `fly.staging.toml`, `docs/runbooks/staging.md`, the two workflows,
  `docs/evidence/README.md` and the staging block of `.env.example`. Only the
  values live in dashboards.
- Founder-gated before anything runs. The accounts: the Vercel Pro `staging`
  environment and its domain, the Supabase project `north-staging`, the Fly
  app and volume, the Inngest environment, the Resend domain with receiving,
  a Stripe sandbox, the Langfuse project, the `north-test` Anthropic
  workspace with its $50 limit, a GitHub test organisation with a staging
  OAuth app, a Google OAuth client in Testing with the founder's test Gmail
  (consent lapses every 7 days), a Meta app in development mode with a
  sandbox ad account. The secrets: Fly secrets, the Vercel `staging`
  variables, the two Supabase Vault secrets, and every GitHub environment
  secret and variable, once per environment (environment secrets are not
  shared). The settings: the environments `staging` and `acceptance` with
  deployment branches limited to the default branch and the founder as
  `acceptance`'s required reviewer, Actions allowed to open pull requests,
  the repository private. Runbook section 15 lists each step with the
  command that proves it and the evidence file it writes.
- Unproven until the first real run, because no staging account existed
  when this was written (runbook section 15, `docs/plans/M7.progress.md`):
  every deploy; Inngest syncing through Deployment Protection; Vercel's
  bypass cookie surviving the redirect back from the Supabase sign-in link;
  the build-free `flyctl secrets set` reset on an auto-stopped machine; the
  engineering sandbox on a Fly machine (ADR 0019); every cost and duration
  the nightly and the acceptance will report.
- A live key on staging can reach only what the founder listed: a missing
  list entry fails closed (the action is blocked and the row says which
  target), never open. In live mode, an action kind whose provider
  `fenceTargetsOf` does not read is fenced as `unknown` until its target
  reading is added there.
- A production worker cannot take staging's fence, cassettes or profiles
  without failing boot, nor change `NORTH_ENV` itself without failing the
  production check (`env` must read `production`); staging cannot drop its
  fence without failing the check that precedes every journey.
- Each workflow run purges its own e2e users at the end, so the staging
  project does not collect them, and every removal is a `purge_log` row like
  any other purge.

## Alternatives

- **The fence in each adapter.** Every adapter would carry its own copy of
  the rule, a new adapter could ship without it, and a refusal would not be
  an `actions` row. In `gate()` it is one pure function, recorded like every
  other block, and covered by CLAUDE.md non-negotiable 1.
- **Allow-lists in the database or on a settings page.** Anything a user, a
  card or an agent can write could widen the fence. In the environment, only
  a deploy-level change by the founder can.
- **Staging on sandbox adapters and the mock runtime.** Production's default
  would prove nothing the CI `e2e` job does not already prove (ADR 0015).
- **An always-on staging machine.** It would keep the gateway's in-memory
  day across idle hours, but an always-on `performance-2x` is outside the
  budget (runbook section 3); the gateway seeds its day from `agent_runs` at
  boot instead (ADR 0019).
- **Deleting e2e users with `auth.admin.deleteUser`.** The cascade reaches
  append-only tables (`credit_entries` first) and fails, which is why every
  smoke used to leave its owner behind (`scripts/lib/purge-smoke-user.ts`);
  forcing it would be a second delete path. Ending the entitlement and
  purging keeps ADR 0016's single path.
- **A separate staging check script.** One script with `--env` keeps every
  check but the worker's health rules identical in both deployments, so the
  difference is one small, tested file (`scripts/production-check-rules.ts`).
