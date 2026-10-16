# Real end-to-end testing and a live staging environment (under $100/month)

Research for the founder decision of 2026-10-16: "every change runs real Claude with a
sandboxed outside world; every milestone acceptance runs a full live end-to-end with test
accounts, driven by Playwright like a real user; no mocks for acceptance; a live staging
deployment the founder logs into; under $100/month." Checked 2026-10-16 against the live
pricing and docs pages listed under Sources (numbers in brackets).

## Summary

1. Today every acceptance test runs on `MockRuntime` fixtures and loopback-only sandbox
   routes (`apps/web/e2e/*.spec.ts`, `.github/workflows/ci.yml`). Real Claude has never run
   end to end, and the public worker mounts no `/sandbox/sites/` route (ADR 0015), so the M3
   build test cannot run on a deployed staging worker as written.
2. Opus 5.5, Sonnet 5.5 and Haiku 5.5 reject non-default `temperature`/`top_p`/`top_k`
   [6][7]. There is no determinism knob, so tests must assert structure, evidence and
   invariants, and grade quality with rubrics and thresholds rather than exact text.
3. Haiku 5.5 costs $0.10/$0.50 per MTok (prompts up to 100k tokens), 40x cheaper than Opus
   5.5 ($4/$20) [1]. A full North journey (idea, plan, research, brand, site, campaign
   draft) is about **$5.30 on production routing (budget $7)**, **$2.30 on a Sonnet/Haiku
   "staging" profile** and **$0.40 on Haiku everywhere** (assumptions in section 3.3).
4. Record-and-replay is cheap to build because the Agent SDK passes its environment to
   the Claude Code subprocess, which honours `ANTHROPIC_BASE_URL` [5]. A loopback cassette
   proxy can record real runs and replay them offline at $0. In-process tools such as nock
   cannot see the subprocess [13].
5. Long flows need explicit Playwright timeouts. The test default is 30 s, `expect` 5 s,
   `toPass` 0 [15][16]. Use `test.setTimeout`, `expect.poll` with growing intervals,
   `test.step` per phase, and `globalTimeout` for the suite.
6. Magic-link sign-in on hosted Supabase needs custom SMTP. The built-in sender delivers
   only to team addresses, at 2 messages/hour [26][27]. Use Resend (already the production
   sender) and its free receiving addresses plus `GET /emails/receiving` as the test inbox
   [35][37]. Use `auth.admin.generateLink` for the runs that do not test email [28].
7. Vercel Hobby is non-commercial only [22], so North's staging belongs in the Pro team.
   Pro includes one custom environment per project at no extra cost [23]. The automation
   bypass header works on every plan [20].
8. Staging on free tiers works: Supabase Free (2 active projects, 500 MB, pauses after 7 idle
   days) [25], Inngest Free (50k executions, 24 h traces) [31], Langfuse Hobby (50k units)
   [33], Resend Free (3,000/month) [35], Sentry Developer [34]. Fly has no free tier, but an
   auto-stopping staging worker costs about $6/month [30].
9. The live tier can run with no money at risk. Meta's sandbox ad account delivers no ads
   and needs no funding source [45]. Standard Access covers app role holders without App
   Review [44]. Stripe sandboxes isolate CI [48]. Google Ads test accounts need no approved
   token and no billing [53][54]. The catch is Google OAuth in "Testing" mode: consents
   expire after 7 days [51].
10. A five-tier pyramid fits in about **$92/month including Vercel Pro**, or about $72 if
    Pro is booked as production cost (section 6). It needs an Anthropic workspace spend limit
    as the hard backstop [3], a test-run budget guard in the worker, and a "test-account
    fence" in `AuthorityEngine.gate()` so a staging run can only touch allow-listed test
    accounts.

## Findings

### 1. Testing an app whose core is non-deterministic LLM output

**1.1 Assertion ladder.** Use cheap, deterministic checks first and model judges last.
Anthropic's eval guide favours volume over hand-graded quality. It recommends a different
model as grader, detailed rubrics, a specific output ("correct/incorrect", 1–5) and thinking
on before the score [9]. MT-Bench found strong judges agree with humans over 80% of the time,
and named position, verbosity and self-enhancement bias [10].

| Level | What it checks in North | Cost | Flake risk |
| --- | --- | --- | --- |
| A. Schema | Agent output parses against `AgentOutputSchema` / `outputJsonSchema(taskType)` (already enforced in `claude-agent-sdk.ts`) | $0 | none |
| B. Evidence and invariants | task `done` only with verified `Evidence`; one `actions` row per gated step with the right tier (K0–K3); quota ≤ 3 cards; budget not exceeded; `actions`/`ledger_entries` never updated; kill switch stops within 5 s | $0 | low |
| C. Artifact facts | site HTTP 200, `<h1>` present, company name in body, waitlist form posts; brand kit has palette + logo file; campaign draft has budget ≤ cap | $0 | low |
| D. Rubric judge | Haiku 5.5 (Batch on nightly), thinking on, JSON `{pass, score, reason}`, threshold, rubric versioned in repo; median of 3 only at acceptance | ~$0.001/judgment | medium |
| E. Screenshot judge | Playwright screenshot → vision rubric ("hierarchy, contrast, CTA above fold, matches brand palette") | 1280×800 = 1,334 visual tokens [8]; ≈$0.00013 on Haiku | medium |

Screenshot tokens are `⌈w/28⌉ × ⌈h/28⌉`. On Haiku 5.5 and other Claude 4.7+ models the
cap is 4,784 tokens [8], so a full-page judge stays under a cent even on Sonnet. Pixel-diff
snapshots (`toHaveScreenshot`) suit North's own UI. They do not suit generated sites, which
change on every run.

**1.2 Record and replay (cassettes).** The goal: record a real run once, then replay it
on every PR and at night at $0, and re-record only when the inputs that shape the prompts
change.

| Option | Sees Agent SDK subprocess? | Streams (SSE)? | Maintenance | Fit |
| --- | --- | --- | --- | --- |
| Loopback proxy via `ANTHROPIC_BASE_URL` (write ~150 lines in-repo) | yes, env passed through `options.env` [5] | yes (store raw bytes) | ours | **best** |
| nock "Nock Back" record/lockdown modes [13] | no (in-process only) | partial | nock 15.0.1, MIT, Oct 2026 [59] | `LlmClient` unit tests only |
| mitmproxy server replay [14] | yes (as HTTPS proxy) | yes | mature, Python | fallback if proxy is hard |
| Polly.js [59] | no | — | last publish 2023-07 | avoid |
| promptfoo (eval runner with `llm-rubric`) [11] | n/a (own runner) | n/a | 0.124.1, MIT, Oct 2026 [59] | prompt-level evals |
| Evalite (Vitest-based, local-first) [12] | n/a | n/a | MIT, 0.19.0 Feb 2026, "breaking changes" [59] | optional prompt evals |
| vitest-evals (Sentry) [59] | n/a | n/a | 0.17.0, Apache-2.0, Sep 2026 | optional |

Cassette rules:
- Key each request on a normalised body: drop `metadata`; replace UUIDs, ISO timestamps and
  `/data/workspaces/<taskId>` paths; sort keys; hash with SHA-256. In replay, a miss fails
  the test (nock's "lockdown" semantics [13]).
- Strip `x-api-key` and `authorization` before writing, and secret-scan `test/cassettes/`.
  Set `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1` in the subprocess so telemetry stays off
  the tape [5].
- Each cassette set carries a manifest of hashes: `agents/*.yaml`,
  `packages/agents/src/prompts/task-guides.ts`, `packages/core/src/models.ts`, and the pinned
  `@anthropic-ai/claude-agent-sdk` version (0.3.299 in `packages/agents/package.json`).
  When a hash changes the cassette is stale, and the nightly run re-records it.

**1.3 Golden runs.** A golden run is one full journey recorded with production routing at
milestone acceptance. Commit its cassettes, plus a structural snapshot: task list, task
types, tiers, evidence kinds and card count, not prose. PR-tier Playwright then replays the
golden run instead of hand-written fixtures. Langfuse Hobby includes datasets, experiments
and LLM-as-judge evaluators [33], so traces from golden runs can seed a regression dataset.

**1.4 Flake control.** Playwright `retries`, `failOnFlakyTests` (v1.52+) and `repeatEach`
are config options [18].
- Mock and replay tiers: `retries: 1` with `failOnFlakyTests: true`, since a flake there is a
  product bug.
- Real-LLM tiers: one retry; flakes are reported but do not fail the nightly. Track pass^k per
  spec over 7 nights, and quarantine a spec below 6/7 (`@quarantine` grep tag) with an issue.
- Tiers separate model variance from product bugs: replay passes and live fails points to
  the model or a prompt change; both failing is a product bug.

### 2. Playwright for flows that take minutes

- **Timeouts.** Set the timeouts per test with `test.setTimeout`, starting from the
  defaults in [15]. The full live journey gets 30 min. The suite gets `globalTimeout` 60 min.
  The current `WORKER_TIMEOUT_MS` (120 s) suits mock runs only.
- **Polling.** Use `expect.poll(fn, { timeout, intervals: [5_000, 10_000, 30_000] })`, whose
  default intervals are 100/250/500/1000 ms. `toPass` has timeout 0 unless set [16]. Poll
  a JSON read of the task state rather than `page.reload()` every 5 s. Use the user's own
  session through Supabase REST, so RLS stays in the loop. Reload the page once at the end,
  for the screenshot.
- **Structure.** Wrap each phase (sign-up, onboarding, research, brand, site, campaign) in
  `test.step`. Record the Langfuse trace id and `agent_runs.cost_usd` in
  `testInfo.annotations`, so the HTML report shows what each step cost.
- **Evidence.** Trace, video and screenshot modes are `on`, `retain-on-failure`,
  `on-first-retry`, and for traces `retain-on-first-failure` [17]. Nightly keeps traces and
  video on failure only; acceptance records `trace: 'on'` and desktop `video: 'on'`.
  Explicit `page.screenshot()` stays the evidence convention
  (`docs/evidence/M<n>/<name>-<project>.png`).
- **Deployed URL.** `E2E_BASE_URL` already exists in `apps/web/playwright.config.ts`; a
  staging config must drop `webServer`, which would otherwise try `pnpm dev`. Send
  `x-vercel-protection-bypass` and `x-vercel-set-bypass-cookie: true` through
  `extraHTTPHeaders`, as Vercel documents for Playwright on all plans [20].
- **Auth.** A `setup` project signs in once and saves `storageState` to `playwright/.auth`
  (gitignored), one account per worker when tests mutate state [19]. Hosted Supabase limits
  OTP per user (60 s) and per IP (30 per 5 min); custom SMTP starts at 30 mails/hour [26][27].

| Test inbox | Tests real delivery? | Cost | Notes |
| --- | --- | --- | --- |
| Mailpit (current, local) [39] | local SMTP only | $0 | MIT; keep for T1; `apps/web/e2e/mail.ts` already reads its API |
| `auth.admin.generateLink` [28] | no (link minted server-side) | $0 | needs the staging service role key in CI; fastest for nightly setup |
| Resend receiving (`<id>.resend.app`) [36][37] | yes, same sender as production | $0 on Free | `GET https://api.resend.com/emails/receiving` lists mail; received mail counts toward quota [35] |
| Mailosaur [38] | yes | from $20/month (annual) | 14-day trial; no reason to pay |
| Gmail test account | yes | $0 | gmail.readonly is a restricted scope [52]; Testing-mode consent expires every 7 days [51] |

### 3. Cost control

**3.1 Prices (live page, 2026-10-16) [1].**

| Model | Input | 5-min cache write | 1-h write | Cache hit | Output | Batch in/out |
| --- | --- | --- | --- | --- | --- | --- |
| `claude-opus-5-5` | $4 | $5 | $8 | $0.20 | $20 | $2 / $10 |
| `claude-sonnet-5-5` | $2 | $2.50 | $4 | $0.10 | $10 | $1 / $5 |
| `claude-haiku-5-5` (≤100k prompt) | $0.10 | $0.125 | $0.20 | $0.01 | $0.50 | $0.05 / $0.25 |
| `claude-haiku-5-5` (>100k prompt) | $0.50 | $0.625 | $1 | $0.05 | $2.50 | $0.25 / $1.25 |

All prices are per MTok. Web search costs $10 per 1,000 searches; web fetch has no extra
charge [1]. The Batch API halves token prices, and most batches finish within an hour [2].
That suits nightly judges, not PR gates.

**3.2 Levers, in order.**

1. Add model routing profiles in `packages/core/src/models.ts`, still the only home of
   model IDs: `production` (today's map), `staging` (planner/coder on Sonnet 5.5,
   drafter/classifier on Haiku 5.5) and `smoke` (all Haiku 5.5, effort `low`). Select one
   with `NORTH_MODEL_PROFILE`. Opus 5.5 defaults to effort `medium` and accepts only effort
   as its thinking control [6], so effort belongs in each profile.
2. Prompt caching is automatic in the Agent SDK [4]. Cache hits on Opus and Sonnet 5.5 cost
   0.05x input [1], so agent loops are output-dominated. The levers are effort and turn caps.
3. Keep each role's `maxBudgetUsd` (already in `agents/*.yaml`). Add a per-run test cap.
   The SDK's `total_cost_usd` is a client-side estimate from a bundled price table [4].
   Reconcile monthly against the Console.
4. Run judges through the Batch API on nightly and acceptance runs [2].
5. Use a dedicated Anthropic workspace `north-test` with its own spend limit as the hard
   stop. Workspaces can carry custom spend and rate limits. A self-set limit returns HTTP 400
   "specified workspace API usage limits" [3].
6. Add a test budget guard in the worker. Before each agent run it sums `agent_runs.cost_usd`
   for the current `test_run_id`, refuses once `NORTH_TEST_BUDGET_USD` is reached, and passes
   `maxBudgetUsd = min(role cap, remaining)` to the SDK. On the smoke profile, `max_turns`
   and compaction keep Haiku prompts under 100k tokens, above which prices are 5x [1].

**3.3 Cost of one full live run.**

Assumptions (±50%; the first real run's `agent_runs` rows replace them): every agent turn
re-reads a cached prefix that starts at 12k tokens (14k for engineering) and grows by g per
turn. Plan 8 turns, g = 3k, 2k output/turn; research 15 turns, g = 4k, 1.5k output, 8
searches; brand 8 turns, g = 2k, 2.5k output; site 40 turns, g = 3k, 3k output; campaign 8
turns, g = 2k, 2k output; onboarding questions are one `classifier` call; judges are 6 text
and 6 screenshot judgments through Batch.

| Step (role, alias) | Tokens (cache read / write / out) | Production routing | `staging` profile | `smoke` profile |
| --- | --- | --- | --- | --- |
| Sign up, onboarding questions (classifier) | 3k in / 1.5k out | $0.001 | $0.001 | $0.001 |
| Plan (strategy, planner) | 180k / 36k / 16k | $0.54 (Opus) | $0.27 (Sonnet) | $0.01 |
| Research (research, drafter) + 8 searches | 600k / 72k / 23k | $0.55 (Sonnet) | $0.11 (Haiku) | $0.11 |
| Brand kit (design, drafter) | 152k / 28k / 20k | $0.29 | $0.02 | $0.02 |
| Landing page + waitlist (engineering, coder) | 2.9M / 134k / 120k | $3.65 (Opus) | $1.83 (Sonnet) | $0.24 (part >100k) |
| Campaign draft (growth, drafter) | 152k / 28k / 16k | $0.25 | $0.01 | $0.01 |
| Judges (Batch) | ~70k in / 15k out | $0.08 | $0.08 | $0.01 |
| **Total (budget with margin)** | ~4M / 0.3M / 0.2M | **$5.34 ($7)** | **$2.31 ($2.75)** | **$0.40 ($0.45)** |

Engineering is about 70% of the production cost: output tokens at $20/MTok, with effort
`xhigh` on the `coder` alias. The role caps bound a run at $18.50 in the worst case.

### 4. Staging topology

| Service | Free tier (verified) | Paid step | Staging choice |
| --- | --- | --- | --- |
| Vercel | Hobby: personal, non-commercial only [22]; 100 deploys/day [24] | Pro $20/month with $20 credit [21]; 1 custom environment per project included [23] | `staging` custom environment in the Pro team, domain `staging.<domain>` |
| Supabase | Free: 500 MB DB, 1 GB storage, 50k MAU, 2 active projects, pause after 1 idle week [25] | Pro from $25/month; branching $0.01344 per branch-hour [25] | separate free org/project `north-staging`; the nightly keeps it awake |
| Fly.io | none; trial 2 h or 7 days [30] | per second; performance-2x 4 GB $66 per 30 days (iad); ams +3.8%; volumes $0.15/GB-month [30] | app `north-worker-staging`, `auto_stop_machines="stop"`, `min_machines_running=0`, 3 GB volume; ~60 h/month ≈ $6 |
| Inngest | Free: 50k executions, 5 concurrent steps, 24 h trace history [31] | Pro from $99/month [31] | staging environment with its own keys [32]; whether Free includes it is **unverified**; fallback is a second free account |
| Langfuse | Hobby: 50k units, 30 days, 2 users [33] | Core $29/month [33] | separate project `north-staging` |
| Sentry | Developer: 5k errors, 1 user [34] | Team $29/month [34] | same projects, `environment=staging` |
| Resend | Free: 3,000/month, 100/day, 3 domains, receiving included [35] | Pro $20/month [35] | staging sender domain + receiving inbox |
| GitHub Actions | 2,000 min/month on private repos; free on public [40] | Linux 2-core $0.006/min [40] | schedule runs on the default branch [41] |

- **Preview vs staging.** PR previews stay UI review only, since a preview's web would talk
  to a worker running `main`. Inngest auto-creates branch environments for Vercel previews;
  delete the Preview Inngest variables to stop that [32]. Real E2E runs only on staging,
  which tracks `main` (`vercel deploy --target=staging` [23]).
- **Seeding.** Run `pnpm stripe:setup` (idempotent) against the staging Stripe sandbox and
  insert one "demo company" for the founder from the existing fixtures. Test users get a
  per-run stamp, as the current specs already do (`Date.now().toString(36)`).
- **Reset.** No routine resets: once a week, purge owners matching `e2e+%` through the ADR
  0016 path, the only delete path, which keeps CLAUDE.md #3 intact. `supabase db reset
  --linked` drops every user-created entity in the remote database [29]; keep it as a last
  resort behind a guard that refuses the production project ref.
- **Secrets.** Keep ADR 0015's one-home table with a staging column. Use GitHub Environments
  `staging` and `acceptance`, with the founder as required reviewer on `acceptance`. A check
  confirms staging refs never equal production's. Playwright traces hold cookies, so they
  stay Actions artifacts with `retention-days: 7` (500 MB free [40]), never committed.

### 5. Test accounts for the live tier

| Provider | Safe test surface | What others do | Watch out |
| --- | --- | --- | --- |
| Meta Ads + Instagram | Sandbox ad account: Marketing API → Tools; one per app; no funding source; ads never deliver [45]. Standard Access for app role holders, no App Review [44] | System-user token on the sandbox account; Instagram publishing to a private test business account owned by the founder | Calls at any access level hit production data [43]. A wrong account id spends real money, hence the fence. Advanced Access needs Business Verification: "a few days", up to weeks; community reports exceed 30 days [47][60] |
| Stripe | General sandboxes, one for CI separate from local; test clocks for billing [48][49] | `stripe sandbox create` provisions keys for agents [48] | Connect platform sandboxes cannot link to connected-account sandboxes [48], so OUT-2 Connect read stays a manual test |
| Gmail (send) | New Google account as the founder's test inbox; OAuth app in Testing with ≤100 test users [51] | Send only to fenced recipients (Resend receiving addresses) | Consent and refresh token expire every 7 days in Testing [51]. `gmail.send` is sensitive, `gmail.readonly` restricted [52]. Publishing needs verification |
| GitHub | Free org `north-e2e-…` with unlimited private repos [42] | Staging OAuth app scoped to the test org; repos deleted by the weekly purge | OAuth consent with 2FA cannot be automated. The founder consents once on staging, and the encrypted token (ADR 0008) persists |
| Vercel (user's deploy target) | Founder's Pro team, projects prefixed `e2e-` | Delete projects in the weekly purge | A Hobby account for test sites is a gray zone under the non-commercial rule [22] |
| Google Ads | Test manager account + test client accounts; pending developer token works; no billing; no metrics [53][54] | Same OAuth client as production | Up to 50 test accounts; deleted after a year idle [53] |
| TikTok / YouTube | Unaudited TikTok clients post private-only [55]; YouTube uploads are **not** auto-private for unverified projects, 100 uploads/day [56] | Always set `privacyStatus=private` in tests | Public posting stays a K2 card and is never automated |
| Higgsfield | North platform account with capped credits (founder decision) | One cheap image per nightly; video only at acceptance | Plan prices disagree across sources ($15–19 Starter) [57][58]: **unverified** |

## Recommendations for North (ranked)

1. **Add model profiles and a test budget guard.** `MODEL_PROFILES` goes in
   `packages/core/src/models.ts`, with `resolveModel(alias, profile)` defaulting to
   `production`; `scripts/production-check.ts` fails unless production reports
   `profile=production`. The pure guard goes in `packages/core/src/budget/test-run.ts`, wired
   in `apps/worker/src/deps.ts`. Tests: `packages/core/test/models.test.ts`,
   `budget/test-run.test.ts`.
2. **Add a test-account fence to the gate.** `packages/core/src/authority/fence.ts` is read by
   `gate()`. When `NORTH_TEST_FENCE=1`, it blocks any external action whose target is not
   allow-listed: Meta ad account ids, GitHub orgs, Vercel project prefix `e2e-`, recipient
   domains (`*.resend.app`), Stripe keys `sk_test_`. Staging and acceptance run
   `INTEGRATIONS_MODE=live` with the fence on; the staging check asserts it on, the
   production check asserts it off. This lets the M3 build flow run on a public worker
   against the real GitHub test org and Vercel instead of `/sandbox/sites/`.
3. **Build the cassette proxy** in `scripts/llm-cassette/` (`proxy.ts`, `key.ts`, `check.ts`,
   tests run by `scripts/vitest.config.mts`). Add `ANTHROPIC_BASE_URL` to
   `SUBPROCESS_ENV_ALLOWLIST` in `packages/agents/src/runtime/claude-agent-sdk.ts`; the
   worker refuses a non-loopback base URL when `NODE_ENV=production`. The PR e2e job runs
   with `AGENT_RUNTIME=claude-agent-sdk` and `NORTH_CASSETTE_MODE=replay`.
4. **Add the real-LLM smoke on every PR.** `scripts/smoke-llm.ts` runs real Claude on the
   `smoke` profile with a $0.50 cap, against the local stack in sandbox. It covers three task
   types (onboarding questions, `market_report` with at most 3 searches, `build_site` with
   `max_turns` 15) and asserts levels A–C. In `ci.yml`, add a job `llm-smoke` with
   `concurrency: cancel-in-progress`, skipped on forks (no secrets).
5. **Stand up staging**: the Vercel `staging` custom environment, Supabase `north-staging`
   (free), Fly `north-worker-staging` (`apps/worker/fly.staging.toml`, auto-stop), an Inngest
   staging environment, a Langfuse project and a Resend domain. Document it in
   `docs/runbooks/staging.md` (mirroring `production.md`'s order) and an ADR "0017 staging
   topology and the test-account fence". Reuse `scripts/production-check.ts --env staging`.
6. **Add the staging Playwright config and journey**: `apps/web/playwright.staging.config.ts`
   (no `webServer`, bypass headers, `timeout: 30 * 60_000`, `globalTimeout: 60 * 60_000`) and
   `apps/web/e2e/live/journey.live.spec.ts` (sign up → idea → research → brand → site →
   campaign draft → kill switch). `apps/web/e2e/mail.ts` gains
   `E2E_MAIL_PROVIDER=mailpit|resend|admin`; `apps/web/e2e/judge.ts` hands screenshots and
   artifacts to `scripts/judge/run.ts` (Batch).
7. **Add workflows.** `.github/workflows/nightly-staging.yml` (cron `17 2 * * *` plus
   `workflow_dispatch`) deploys `main` to staging, runs `supabase db push`, the check and the
   journey, re-records stale cassettes into a bot PR, and opens an issue on red.
   `.github/workflows/acceptance.yml` (`workflow_dispatch`, input `milestone`, environment
   `acceptance` with founder approval) runs the production profile on all fenced live
   accounts and commits evidence through a PR.
8. **Add root scripts to `package.json`:**
   ```json
   "smoke:llm": "tsx scripts/smoke-llm.ts",
   "cassette:proxy": "tsx scripts/llm-cassette/proxy.ts",
   "cassette:check": "tsx scripts/llm-cassette/check.ts",
   "e2e:replay": "NORTH_CASSETTE_MODE=replay pnpm --filter @north/web e2e",
   "e2e:staging": "pnpm --filter @north/web exec playwright test -c playwright.staging.config.ts --grep-invert @live",
   "e2e:live": "pnpm --filter @north/web exec playwright test -c playwright.staging.config.ts --grep @live",
   "judge": "tsx scripts/judge/run.ts",
   "staging:check": "tsx scripts/production-check.ts -- --env staging",
   "staging:seed": "tsx scripts/staging-seed.ts",
   "staging:purge-e2e": "tsx scripts/purge-due.ts -- --match 'e2e+%' --yes"
   ```
9. **Set the evidence conventions** (table below) and add a `docs/evidence/README.md` line
   per tier.

### Test pyramid for North

| Tier | Trigger | Runtime / world | Models | Budget | Evidence stored |
| --- | --- | --- | --- | --- | --- |
| T0 unit | every commit, PR | Vitest, pure | none | $0 | CI log only |
| T1 integration + mock/replay E2E | every PR (existing jobs) | local Supabase, Inngest dev, `MockRuntime` or cassette replay, sandbox | none (replay) | $0 | Actions artifact: Playwright report, `docs/evidence/M6/ci-*.png` (as today) |
| T2 real-LLM smoke | every PR push + merge to `main` | local stack in CI, sandbox, real Agent SDK | `smoke` (Haiku 5.5) | $0.50/run cap | artifact `smoke-llm.json`: per task model, tokens, cost, schema/evidence pass, duration |
| T3 nightly real E2E | cron 02:17 UTC; `staging` profile every other Sunday | staging URL, real Claude, fenced live GitHub/Vercel, Meta sandbox, Stripe sandbox, Resend inbox | `smoke`; biweekly `staging` | $1/run; $3 biweekly | artifact (7 days): HTML report, failure traces, `summary.json` (costs, judge scores, Langfuse ids); re-recorded cassettes via PR; issue on failure |
| T4 milestone live acceptance | `workflow_dispatch`, founder approves | staging, all fenced test accounts, real email magic link, no North mocks | `production` | $10/run | committed `docs/evidence/M<n>/acceptance/<date>/`: `run.json` (sha, profile, redacted account ids, cost per step), mobile + desktop screenshots per step, `judges.json` (rubric version, scores), `staging-check.json`; trace and video as artifacts |

## Monthly cost (target: under $100)

| Line | Basis | $/month |
| --- | --- | --- |
| Claude: T2 PR smoke | 50 runs × $0.10 | 5 |
| Claude: T3 nightly | 30 × $0.45 (`smoke`) | 14 |
| Claude: T3 fidelity run | 2 × $2.75 (`staging`) | 6 |
| Claude: T4 acceptance | 2 × $7 (one milestone + one re-run) | 14 |
| Claude: judges + founder exploring staging | Batch judges; light use | 6 |
| **Claude subtotal** (workspace spend limit $50) | | **45** |
| Higgsfield credits | entry plan, capped (price unverified) | 15 |
| Fly staging worker | performance-2x, ~60 h, 3 GB volume | 6 |
| GitHub Actions overage | ~1,000 min over the free 2,000 (if private) | 6 |
| Supabase, Inngest, Langfuse, Sentry, Resend | free tiers above | 0 |
| Vercel Pro | shared with production; staging = included custom env | 20 |
| **Total** | ($72 if Vercel Pro is booked to production) | **92** |

## Accounts, keys and secrets the founder provides

| # | Item | Where | Cost | Lead time | Home |
| --- | --- | --- | --- | --- | --- |
| 1 | Anthropic workspace `north-test`, API key, spend limit $50 | Console → Workspaces, Billing [3] | usage | minutes; new orgs may start in a lower Evaluation tier [3] | GitHub env `staging`/`acceptance`, Fly staging `ANTHROPIC_API_KEY` |
| 2 | Vercel staging environment, `VERCEL_TOKEN`, automation bypass secret | Project → Environments; Deployment Protection [20][23] | in Pro | minutes | GitHub env; Playwright env `VERCEL_AUTOMATION_BYPASS_SECRET` |
| 3 | Supabase `north-staging`: URL, publishable key, service role key, DB password, `SUPABASE_ACCESS_TOKEN` | new free org [25] | $0 | minutes | Vercel staging (public), Fly staging, GitHub env |
| 4 | Fly app + `FLY_API_TOKEN` (deploy token for that app) | `fly launch`, `fly tokens create deploy` | ~$6 | minutes; card required [30] | GitHub env |
| 5 | Inngest staging event + signing keys | Inngest environments [32] | $0 | minutes | Vercel staging, Fly staging |
| 6 | Langfuse staging keys; Sentry DSNs (reuse) | langfuse.com, sentry.io | $0 | minutes | Fly staging |
| 7 | Resend: verified `staging.<domain>`, API key, SMTP creds for Supabase, receiving address | resend.com [35][36] | $0 | DNS propagation, hours | Fly staging, Supabase Auth SMTP, GitHub env (`E2E_RESEND_KEY`) |
| 8 | Stripe CI sandbox: `sk_test_…`, webhook secret | Dashboard → Sandboxes [48] | $0 | minutes | Fly staging |
| 9 | GitHub test org + staging OAuth app (client id/secret, callback `https://staging.<domain>/api/connections/github/callback`) | github.com/organizations/new | $0 [42] | minutes | Vercel (id), Fly (secret) |
| 10 | Meta developer account, Business app, Marketing API, sandbox ad account, system-user token; `META_APP_ID`/`SECRET` | developers.facebook.com [44][45] | $0 | same day for Standard Access; days to weeks only if Advanced Access/Business Verification [47] | Fly staging; account id in fence list |
| 11 | Instagram professional test account linked to a test Page | Meta Business Suite | $0 | same day | connection on staging |
| 12 | Google Cloud project: OAuth client (Testing), founder's test Gmail as test user | console.cloud.google.com [51] | $0 | minutes; re-consent every 7 days | Fly staging `GOOGLE_CLIENT_*` |
| 13 | Google Ads test manager + test account; developer token (pending is fine) | ads.google.com, API Center [53][54] | $0 | token request same day | Fly staging |
| 14 | Higgsfield platform account + key, monthly credit cap | higgsfield.ai | ~$15 | minutes | Fly staging |
| 15 | Staging `CONNECTIONS_ENCRYPTION_KEY`, VAPID pair | `openssl rand -base64 32`, `npx web-push generate-vapid-keys` | $0 | minutes | Fly staging |
| 16 | GitHub Environments `staging`, `acceptance` (founder as required reviewer) | repo Settings → Environments | $0 | minutes | — |

## Risks

- **Spend.** A prompt regression or runaway loop can spend fast. Back the guard and the role
  caps with the server-enforced workspace limit [3]. The SDK's own cost figure is an estimate
  [4].
- **Real-world side effects.** Meta sandbox calls go to production endpoints [43], and a
  test could approve its own K2 card. The fence must default-deny, and acceptance must use a
  fresh company so the 3-card quota (CLAUDE.md #4) holds on wall-clock time. The staging
  clock must stay `wall`, as the production check asserts.
- **Cassette drift and leakage.** Cassettes hold prompts and outputs. They contain only
  synthetic companies, are scrubbed, and are secret-scanned. A Claude Code release changes
  its request shape, so pin the SDK and let `cassette:check` gate.
- **Judge drift.** Pin the judge model and rubric version in `judges.json`. Re-baseline when
  either changes. Never let a judge alone mark a task `done`: Evidence still rules
  (CLAUDE.md #2).
- **Free-tier limits.** Supabase pauses after 7 idle days and has 500 MB [25]; Inngest keeps
  traces 24 h [31]; Langfuse allows 50k units [33] (redaction stays on); Resend 100/day [35].
- **Consents and access.** Google Testing consents expire weekly [51], and GitHub/Meta OAuth
  with 2FA cannot be scripted. Live acceptance therefore depends on stored connections the
  founder refreshes.
- **Cold starts.** The auto-stopped Fly worker cold-starts on an Inngest call. Verify that
  the start fits Inngest's request timeout, and that the kill switch still stops a live
  Agent SDK subprocess within 5 s (a T3 assertion).
- **Pricing claims to verify.** Higgsfield plan prices and Inngest Free environments are
  unverified. The Fly 4 GB shared-CPU price is derived, not published [30].

## Open questions for the founder

1. Is `dinccetintas/North` private? That decides whether Actions minutes cost anything [40].
2. Is Vercel Pro ($20) booked to production or to the $100 test budget?
3. Do you have Google Workspace? An Internal OAuth app may avoid the 7-day expiry, which
   applies to external Testing apps [50] (unverified for Internal).
4. Is a Haiku-only nightly plus a biweekly Sonnet run enough fidelity, or should the nightly
   use the `staging` profile ($80+/month)?
5. Should staging track `main` on every merge, or a `staging` branch you promote?
6. Which identity owns the Meta, Google and GitHub test accounts? Meta requires a real
   person behind the developer account.
7. May golden cassettes (synthetic prompts and outputs) be committed to the repo?
8. What is the monthly Higgsfield credit cap, and is video generation in scope for nightly
   runs or only at acceptance?

## Sources

1. Claude pricing — https://platform.claude.com/docs/en/about-claude/pricing
2. Batch processing — https://platform.claude.com/docs/en/build-with-claude/batch-processing
3. Rate and spend limits, workspaces — https://platform.claude.com/docs/en/api/rate-limits
4. Agent SDK cost tracking — https://code.claude.com/docs/en/agent-sdk/cost-tracking
5. Claude Code via a gateway (`ANTHROPIC_BASE_URL`, Agent SDK env) — https://code.claude.com/docs/en/llm-gateway-connect
6. Opus 5.5 migration guide (sampling, effort default) — https://platform.claude.com/docs/en/models/opus-5-5/migration-guide
7. Haiku 5.5 migration guide (sampling) — https://platform.claude.com/docs/en/models/haiku-5-5/migration-guide
8. Vision token cost — https://platform.claude.com/docs/en/build-with-claude/vision
9. Develop tests / LLM grading tips — https://platform.claude.com/docs/en/test-and-evaluate/develop-tests
10. Zheng et al., Judging LLM-as-a-Judge (MT-Bench) — https://arxiv.org/abs/2306.05685
11. promptfoo `llm-rubric` — https://www.promptfoo.dev/docs/configuration/expected-outputs/model-graded/llm-rubric/
12. Evalite — https://github.com/mattpocock/evalite
13. Nock Back — https://github.com/nock/nock#nock-back
14. mitmproxy server-side replay — https://docs.mitmproxy.org/stable/overview/features/
15. Playwright timeouts — https://playwright.dev/docs/test-timeouts
16. Playwright assertions (`expect.poll`, `toPass`) — https://playwright.dev/docs/test-assertions
17. Playwright use options (trace, video, screenshot) — https://playwright.dev/docs/test-use-options
18. Playwright TestConfig (`failOnFlakyTests`, `repeatEach`) — https://playwright.dev/docs/api/class-testconfig
19. Playwright authentication — https://playwright.dev/docs/auth
20. Vercel Protection Bypass for Automation — https://vercel.com/docs/deployment-protection/methods-to-bypass-deployment-protection/protection-bypass-automation
21. Vercel pricing — https://vercel.com/pricing
22. Vercel fair use (commercial use) — https://vercel.com/docs/limits/fair-use-guidelines
23. Vercel environments and custom environments — https://vercel.com/docs/deployments/environments
24. Vercel limits — https://vercel.com/docs/limits
25. Supabase pricing — https://supabase.com/pricing
26. Supabase Auth rate limits — https://supabase.com/docs/guides/auth/rate-limits
27. Supabase custom SMTP — https://supabase.com/docs/guides/auth/auth-smtp
28. Supabase `auth.admin.generateLink` — https://supabase.com/docs/reference/javascript/auth-admin-generatelink
29. Supabase CLI `db reset` — https://supabase.com/docs/reference/cli/supabase-db-reset
30. Fly.io pricing — https://docs.fly.io/about/pricing
31. Inngest pricing — https://www.inngest.com/pricing
32. Inngest environments — https://www.inngest.com/docs/platform/environments
33. Langfuse pricing — https://langfuse.com/pricing
34. Sentry pricing — https://sentry.io/pricing/
35. Resend pricing — https://resend.com/pricing
36. Resend receiving — https://resend.com/docs/dashboard/receiving/introduction
37. Resend list received emails — https://resend.com/docs/api-reference/emails/list-received-emails
38. Mailosaur pricing — https://mailosaur.com/pricing
39. Mailpit — https://github.com/axllent/mailpit
40. GitHub Actions billing — https://docs.github.com/en/billing/concepts/product-billing/github-actions
41. GitHub workflow events (schedule) — https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows
42. GitHub pricing — https://github.com/pricing
43. Meta Marketing API authorization and tiers — https://developers.facebook.com/docs/marketing-api/overview/authorization
44. Meta access levels — https://developers.facebook.com/docs/graph-api/overview/access-levels
45. Meta Marketing API sandbox re-enabled — https://developers.secure.facebook.com/blog/post/2023/06/21/marketing-api-sandbox-capability-now-re-enabled
46. Meta test users — https://developers.facebook.com/docs/development/build-and-test/test-users
47. Meta App Review FAQ — https://developers.facebook.com/docs/resp-plat-initiatives/individual-processes/app-review/AR-FAQs
48. Stripe sandboxes — https://docs.stripe.com/sandboxes
49. Stripe test clocks — https://docs.stripe.com/billing/testing/test-clocks
50. Google OAuth 2.0 (refresh token expiry) — https://developers.google.com/identity/protocols/oauth2
51. Google OAuth publishing status (Testing, 100 users, 7 days) — https://support.google.com/cloud/answer/15549945
52. Gmail API scopes — https://developers.google.com/gmail/api/auth/scopes
53. Google Ads API test accounts — https://developers.google.com/google-ads/api/docs/best-practices/test-accounts
54. Google Ads API onboarding (pending token on test accounts) — https://developers.google.com/google-ads/api/docs/get-started/onboarding
55. TikTok Content Posting API — https://developers.tiktok.com/doc/content-posting-api-get-started
56. YouTube `videos.insert` — https://developers.google.com/youtube/v3/docs/videos/insert
57. Higgsfield pricing (Higgsfield-hosted, April 2026) — https://geo.higgsfield.ai/task/blog/higgsfield-ai-pricing-plans
58. Higgsfield pricing (third party, July 2026) — https://www.costbench.com/software/ai-video-generators/higgsfield/
59. npm registry pages checked 2026-10-16 — https://www.npmjs.com/package/nock, https://www.npmjs.com/package/promptfoo, https://www.npmjs.com/package/evalite, https://www.npmjs.com/package/vitest-evals, https://www.npmjs.com/package/@pollyjs/core, https://www.npmjs.com/package/@anthropic-ai/claude-agent-sdk
60. Meta developer community, Business Verification delays — https://developers.facebook.com/community/threads/1438748957482484/
