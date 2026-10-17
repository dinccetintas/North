# Evidence

North's rule is "no evidence, no done". This folder holds the evidence of each
milestone, and this page says which test tier produces which file, where it
lives, and how the two staging workflows (`nightly-staging`, `acceptance`) are
set up. The tiers are spec section 8
(`docs/superpowers/specs/2026-10-16-north-studio-phase-design.md`, TST-1..5).

Evidence is committed, so it is redacted: no key, no address, no task or
company id (`run.json` carries the company's slug and the first 12 hex of its
id's SHA-256). `scripts/evidence-guard.sh` looks for the values of
`VERCEL_AUTOMATION_BYPASS_SECRET` and `E2E_RESEND_KEY` in everything the staging
workflows upload or commit (the Playwright report and results, the nightly's
`nightly/` folder, and for the acceptance the whole `docs/evidence/<milestone>/`
folder, which is the pull request's `add-paths` scope) and fails the run when it
finds one: nothing is uploaded or committed after a hit.

## The five tiers

| Tier | Trigger | World | Model profile | Cap | Evidence |
| --- | --- | --- | --- | --- | --- |
| T0 unit | every commit | pure | none | $0 | CI log |
| T1 integration and replay E2E | every PR | local stack, sandbox adapters, MockRuntime or cassette replay | none | $0 | Playwright report |
| T2 real-Claude smoke | every PR push and merge | local stack in CI, sandbox | `smoke` (Haiku tier) | $0.50/run | `smoke-llm.json`: tokens, cost, schema and evidence checks |
| T3 nightly real E2E | cron, plus a biweekly `staging` profile run | staging, real Claude, fenced live test accounts | `smoke`; biweekly `staging` | $1/run, $3 biweekly | HTML report, traces, `summary.json`, judge scores; re-recorded cassettes by PR (M8); an issue on red |
| T4 milestone live acceptance | manual dispatch, founder approves | staging, all fenced test accounts, real magic-link email, no North mocks | `production` | $10/run | `docs/evidence/M<n>/acceptance/<date>/`: run.json, mobile and desktop screenshots per step, judges.json, staging-check.json |

What each tier stores in this repository, and what it does not:

- **T0, T1**: the CI log and the Playwright reports are CI artifacts (job
  `e2e`, artifact `e2e-evidence`); the screenshots the flows save on the runner
  are `ci-*.png` under the milestone's folder.
- **T2**: job `llm-smoke` writes `smoke-llm.json` (artifact
  `llm-smoke-evidence`); a real run's file is kept in the milestone's folder.
- **T3**: the nightly's evidence is a **CI artifact for 7 days**, not a
  commit: the Playwright HTML report (traces and `summary.json` inside it),
  `staging-check.json`, and a `nightly/<date>/` folder with the journey's
  screenshots, `journey-<project>.json` and one `run.json` per viewport. The
  biweekly fidelity run (`staging` profile, $3) is the same workflow started by
  hand with `profile` set to `staging`. Judge scores arrive with the eval
  harness (Task 24).
- **T4**: committed, through the pull request the acceptance workflow opens
  (`evidence(M<n>): acceptance <date>`).
- **Cassettes are not recorded by the nightly in M7.** The staging worker runs
  `NORTH_CASSETTE_MODE=off` (`apps/worker/fly.staging.toml`); recording there
  would need `record` mode and a way to fetch the files from the Fly volume.
  Cassettes are recorded by hand (`cassettes/README.md`, Re-recording) until
  then. M8 follow-up: a nightly that records, and a pull request that commits
  the files.

## Directory layout

```
docs/evidence/M<n>/
  ci-*.png                  T1: screenshots saved by the Playwright flows in CI
  smoke-llm.json            T2: one real-Claude smoke run (tokens, cost, checks)
  staging-check.json        the read-only staging check after a deploy (docs/runbooks/staging.md section 10)
  nightly/<date>/           T3, CI artifact only (7 days), never committed
    NN-<step>-<project>.png     a screenshot per journey step and viewport
    journey-<project>.json      the notes of one journey (slug, outcome, kill switch time)
    <project>/run.json          cost per task of that viewport's company
  acceptance/<date>/        T4, committed by the acceptance pull request
    NN-<step>-<project>.png
    journey-<project>.json
    <project>/run.json          project is mobile or desktop
    staging-check.json
    judges.json                 { "status": "pending" } until Task 24 fills it
```

The journey (`apps/web/e2e/live`) writes its screenshots and notes to
`docs/evidence/M7/acceptance/<date>/` whatever the milestone; the nightly copies
them to `nightly/<date>/` and the acceptance workflow moves them to
`docs/evidence/<milestone>/acceptance/<date>/`.

## The two workflows

Both deploy the same way (migrations, web, worker), check the deployment
read-only (`pnpm staging:check`, which already passes `--env staging`), run one
journey, read the cost per company (`pnpm evidence:costs`), reset the worker's
profile and purge the `e2e-` users (`pnpm staging:purge-e2e`). They share the
concurrency group `staging-journey` (one run at a time, none cancelled).

| | `nightly-staging.yml` | `acceptance.yml` |
| --- | --- | --- |
| Starts | 02:17 UTC every day, or by hand | by hand only, with `milestone` (`M7`) |
| Environment | `staging` | `acceptance` (the founder approves each run) |
| Profile and cap | `smoke` and $1; `staging` and $3 by input | `production` and $10 |
| Journey | `pnpm e2e:staging` (the campaign card stays open) | `pnpm e2e:live` (the campaign card is answered in the UI) |
| Result | artifact `nightly-staging-evidence`; **an issue `nightly staging failed <date>`** on red | artifact `acceptance-evidence` and the pull request `evidence(<milestone>): acceptance <date>` on branch `evidence/<milestone>-<date>` |
| After | profile reset to `smoke` / $1 when it was `staging` (a build-free `flyctl secrets set`, right after the journey and its costs); e2e users purged | profile reset to `smoke` / $1 (same); e2e users purged |

Order of the steps: configuration check (before anything is deployed or
spent), `supabase db push`, `vercel deploy --target=staging` (Vercel CLI
62.0.0, pinned in both files), the profile secrets staged with `flyctl secrets
set ... --stage` and `flyctl deploy` (one restart applies both), the staging
check, the journey, the costs (they read the profile from the worker's
`/health`, so they come before the reset), the reset (`flyctl secrets set
NORTH_MODEL_PROFILE=smoke NORTH_DAILY_CAP_USD=1`, no `--stage`: one rolling
restart on the current image, no rebuild, so it is quick and cannot fail on a
build), the evidence guard, the upload, the
purge, and (nightly) the issue. `flyctl` comes from `superfly/flyctl-actions`
pinned to the commit of its tag 1.6.

**Configuration check.** With `vars.STAGING_WEB_URL` empty, staging is not
provisioned: the first step prints a notice and every later step is skipped, so
the run is green, deploys nothing and opens no issue. With it set and any other
name missing, the run fails there, naming the names (never values). A run
never passes as a dry run.

**Concurrency.** The group `staging-journey` holds one running run and one
waiting run; a newer waiting run replaces an older waiting one, and a run in
progress is never cancelled. An `acceptance` run that waits for the founder's
approval holds the group, so approve or reject it promptly.

**Branches.** Staging only ever runs the default branch's migrations and code.
A schedule runs the default branch. A manual dispatch must select the default
branch under "Use workflow from"; the environments `staging` and `acceptance`
restrict deployment branches to the default branch (a founder setting, below),
so the environment refuses any other ref before a step runs. `acceptance` also
has a job of its own that fails unless `$GITHUB_REF` is exactly
`refs/heads/<default branch>` (a tag named like the branch does not pass) and
prints the refused ref; it runs before the founder is asked to approve. The
"Run workflow" button exists only once the workflow file is on the default
branch, so the first run by hand happens after the merge: Actions,
`nightly-staging`, Run workflow, profile `smoke`.

## Secrets and variables

Set them in GitHub, Settings, Environments: `staging` for the nightly,
`acceptance` for the acceptance. **Environment secrets are not shared between
environments**, so `acceptance` needs its own copy of every entry (the same
values). `acceptance` also gets the setting Required reviewers: the founder.
Values never go into a workflow file, a commit or a ticket; write `<your key>`.

| Name | Kind | Used for | Where the value comes from |
| --- | --- | --- | --- |
| `FLY_API_TOKEN` | secret | `flyctl` (profile secrets, deploy) | Fly deploy token for `north-worker-staging` |
| `VERCEL_TOKEN` | secret | `vercel deploy --target=staging` | Vercel token of the Pro team |
| `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID` | secret | pick the project without `vercel link` | the Vercel team id and the project id (project Settings, General) |
| `STAGING_DB_URL` | secret | `supabase db push --db-url` | the **full, percent-encoded** Postgres URI of `north-staging`, the session-pooler one (runners have no IPv6 and the direct host is IPv6-only on the free plan). It replaces the brief's `SUPABASE_STAGING_DB_PASSWORD` |
| `STAGING_SUPABASE_URL` | secret | the check, the journey (`E2E_SUPABASE_URL`), costs and the purge (`SUPABASE_URL`) | `https://<staging ref>.supabase.co` |
| `STAGING_ANON_KEY` | secret | the staging check | `north-staging`'s publishable (anon) key |
| `STAGING_SERVICE_ROLE_KEY` | secret | costs and the purge only | `north-staging`'s service role key |
| `E2E_RESEND_KEY` | secret | the journey reads the magic link | a **full-access** Resend key (a sending key cannot read mail) |
| `VERCEL_AUTOMATION_BYPASS_SECRET` | secret | the check and the journey get through Deployment Protection | Vercel, Deployment Protection, Protection Bypass for Automation |
| `NORTH_PRODUCTION_SUPABASE_REF` | secret | the purge refuses the production project | the production Supabase project ref |
| `NORTH_USAGE_READ_KEY` | secret, optional | the check's `usage-ratios` (a skip without it) | the usage read key |
| `STAGING_WEB_URL` | variable | the web under test (`E2E_BASE_URL`), https. **Empty means staging is not provisioned and the run skips** | `https://staging.<web>` |
| `STAGING_WORKER_URL` | variable | health wait, the check, the profile in `run.json` | `https://north-worker-staging.fly.dev` |
| `E2E_MAIL_DOMAIN` | variable | sign-up host, purge host; must be `staging.<domain>` | the Resend receiving subdomain |
| `E2E_MAIL_FROM_DOMAIN` | variable, optional | drops mail from any other sender domain | usually the same subdomain |

One-time repository settings:

- Settings, Actions, General, Workflow permissions: **Allow GitHub Actions to
  create and approve pull requests** (the acceptance pull request). It adds
  files under `docs/evidence/` only. A pull request opened with the workflow
  token does not start the `ci` workflow: close and reopen it to run `ci`, or
  merge it as an administrator.
- Environments `staging` and `acceptance`: set Deployment branches to the
  default branch only, from day one (a scheduled run uses the default branch
  only, and `acceptance` refuses any other).
- **The repository must be private.** The artifacts of a failed run (the
  Playwright report and traces) can hold the Vercel bypass cookie and the e2e
  users' session tokens; a public repository would publish them for 7 days.
- The Fly app, volume, Vercel environment, Supabase project and Resend domain
  exist (`docs/runbooks/staging.md`); nothing in these workflows creates them.

## Founder-gated

Nothing here has run against staging: no staging deployment, environment or
secret existed when the workflows were written. They were checked with
`actionlint` and `shellcheck`, and every script they call was run for its
arguments. After the merge to the default branch and the settings above, the
first real run is the nightly by hand with profile `smoke`; its URL goes into
`docs/plans/M7.progress.md`.

Before the environment `staging` has `STAGING_WEB_URL`, a scheduled run is a
green skip with a notice (see the configuration check above), so the schedule
can be merged before staging exists.
