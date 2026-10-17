# M7 gap report

_Scaffold (Task 23). Task 24 fills every section from runs that happened, with a link to each piece of evidence; a section without evidence says so instead of guessing._

## What ran

_Task 24a: one row per step with its exact command, its result line pasted verbatim and its log under `docs/evidence/M7/local/<date>/`: local `REQUIRE_INTEGRATION=1 pnpm validate` with the stack (the `smoke LLM` skip line verbatim), `pnpm e2e` (both projects, mock runtime), and the CI `e2e-replay` job (or "no cassettes; replay job skipped")._

| Step | Command | Result line | Log |
| --- | --- | --- | --- |

## What failed

_Each failure verbatim, with its log link and the smallest reproduction; a flaky-looking failure re-run once and both outcomes recorded; "none" only when every step above was green._

## Founder-gated (open acceptance items)

_The M7 acceptance items no session can prove without the founder's accounts (`docs/evidence/M7/FOUNDER-CHECKLIST.md`); Task 24 adds a status to each row, and a row closes only when its evidence file exists._

| Item | Exact command | Evidence file expected |
| --- | --- | --- |
| Real-Claude smoke on the `smoke` profile within its cap (acceptance item 1, the `smoke:llm` half) | `pnpm smoke:llm` (CI job `llm-smoke`, after `ANTHROPIC_TEST_API_KEY` is set) | `docs/evidence/M7/smoke-llm.json` |
| The staging check passes on the deployed staging (acceptance item 2) | `pnpm -s staging:check -- --web https://staging.<web> --worker https://north-worker-staging.fly.dev --supabase https://<staging ref>.supabase.co --anon-key <staging publishable key> --json` | `docs/evidence/M7/staging-check.json` |
| The live journey on staging, nightly variant (`smoke` profile) | `pnpm e2e:staging` (`docs/runbooks/staging.md` section 15, step 8) | `docs/evidence/M7/staging-journey.txt`; `docs/evidence/M7/acceptance/<date>/journey-<project>.json` |
| The live acceptance on the `production` profile, with the founder's approval (acceptance item 3) | `gh workflow run acceptance.yml -f milestone=M7` | the pull request `evidence(M7): acceptance <date>` with `docs/evidence/M7/acceptance/<date>/`: screenshots per step and viewport, `<project>/run.json`, `staging-check.json`, `judges.json` |
| Engineering's shell under the SDK sandbox on Fly (acceptance item 4, the staging half) | the `build_site` run inside `gh workflow run acceptance.yml -f milestone=M7` | `docs/evidence/M7/acceptance/<date>/<project>/run.json` showing `sandbox: enabled` |
| Hybrid memory search on staging (acceptance item 6, the staging half) | `pnpm smoke:llm` | `docs/evidence/M7/smoke-llm.json`, a `memory_search` line with `rank` from `search_memory_hybrid` |

## Output quality notes per task type

_One subsection per task type that ran on real Claude (for example `market_report`, `build_site`): what the output lacked against its task guide and the department research, each note linked to its artifact or screenshot; if no real-Claude run happened, say so and name the run that will fill it._

## Cost per step

_Per task and per step from each viewport's `run.json` (`pnpm -s evidence:costs -- --slug <company slug> --out <dir>`, `scripts/evidence-costs.ts`) and the smoke's `smoke-llm.json`, with the profile each ran on; if no run happened, say so and give the command._

## What M8 must fix first

_An ordered list, most urgent first: the gaps the runs above found, the deferred minors and LOW security findings from the M7 ledger (each with its file and line), and the founder's walkthrough notes; each item names its evidence._
