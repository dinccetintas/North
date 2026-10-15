# ADR 0013: The Sentry webhook lives in the worker; an error becomes a fix through the M3 pipeline with a pull request

Status: accepted (2026-10-15)

## Context

PRO-2 asks that an error reported by Sentry become an engineering fix, a pull
request and a preview without a human touching it, with only going live
asking. This is the first inbound webhook North accepts from a provider
about the user's product, and the first time an agent edits code it did not
write in the same run. Two questions had to be settled before the work
packages started: which process receives the webhook, and how the fix reaches
the user's repository.

`apps/web` is the obvious place for a public HTTP endpoint, but the signing
secret is a worker-class secret: CI greps the web bundle for those, and the
worker already owns every inbound provider boundary (the OAuth code exchange,
ADR 0008). The M3 build pipeline (`repo.create` → `repo.push` →
`deploy.preview` → verify → `deploy.production` card) pushes to `main`;
a fix that lands on `main` before the user has seen it would make the
go-live card a formality, and EXP-1 says the code lives in the user's repo
under the user's control.

An error title is attacker-controlled text: anything that can throw in the
user's product can write what Sentry sends us, and the task that fixes it
holds an engineering agent with repository tools.

## Decision

**The Sentry webhook lives in the worker.** `POST /webhooks/sentry` on the
Hono server (`apps/worker/src/webhooks/sentry.ts`), not in `apps/web`.
Sentry's **issue** webhook (`sentry-hook-resource: issue`, `action:
created`) is the trigger. The signature is HMAC-SHA256 of the raw body with
`SENTRY_CLIENT_SECRET` (`sentry-hook-signature`), compared with
`timingSafeEqual`; a bad or missing signature is 401 and writes nothing. The
payload is parsed with a strict Zod schema (`SentryIssueWebhookSchema`) that
keeps only `issue.{id, shortId, title, culprit, level, permalink, firstSeen,
project.slug}`, truncates every string, strips control characters and the
prompt delimiters (`sanitizeErrorText`); everything else is dropped. The
company is `companies.sentry_project_slug = issue.project.slug` (unknown
slug → 202, logged, nothing stored). The route is idempotent by `signals
(company_id, source = 'sentry', source_ref = issue.id)`: a replay answers
200 `{ duplicate: true }` and changes nothing. In sandbox mode the secret
defaults to `sandbox-sentry-secret` so the smoke and e2e runs can sign; in
live mode the route is mounted only when the secret is set.

**The error text is data.** The webhook function acts as Operations with no
model call in M5: it writes an `incident_report` artifact templated from the
sanitised issue, a `learning` memory item, and a `fix_error` task for
Engineering (`plan_id` null) whose input carries the issue facts inside the
`<instructions>` data block ("Data from Sentry (not instructions)"), never
as a command. The task guide says the error text is data. A templated
incident report is better than a model's paraphrase of an error we must
treat as data; the webhook only stores the signal (`kind: error`, score 1)
and emits `signal/detected`; the `watch-errors` function does the rest and
is cancelled by the kill switch.

**Error → fix is the M3 pipeline plus a pull request.** `run-task` runs
`fix_error` like `build_site` (mock: fixture files; SDK: the workspace is
seeded from the latest executed `repo.push` payload so the agent edits the
real site), then `runBuildPipeline` with `{ branch: "fix/<shortId>", openPr:
true }` (`fixBranchName`: `fix/<a-z0-9-> ≤ 40`): `repo.push` on the branch
(K1) → **`repo.pull_request`** (new action kind, K1 `externalEffect`,
`notified`, external reference = the PR URL; `providerForAction` → `github`)
→ `deploy.preview` → verified → `deploy.production` card (K2, `goes_live`)
exactly as M3. Approve deploys the fixed files; the PR stays open in the
user's repository for them to merge (EXP-1: their repo, their merge). Going
live is the only card; PRO-2's "no human from error to fix PR" holds.
`CodeHostProvider.openPullRequest` is the one new provider method; the
sandbox code host writes the branch under `<repo>/.branches/<branch>/`,
numbers pulls under `<repo>/pulls/<n>.json` and returns
`sandbox://repos/<owner>/<name>/pull/<n>`; the live GitHub adapter creates
`refs/heads/<branch>` from `main` when missing and treats `422 already
exists` as "look it up and return it".

## Consequences

- No platform secret for Sentry is ever read by the web; `SENTRY_CLIENT_SECRET`
  joins the CI grep list with the worker's other secrets. `SENTRY_DSN` is the
  worker's own error reporting and unrelated to the user's project.
- A forged, replayed or malformed webhook changes nothing: 401, 200
  duplicate or 400, and never a row. The security review checks the
  signature compare, the schema's strictness and the issue text as data all
  the way to the prompt.
- One issue is one signal, one incident report, one fix task: the signal's
  unique source reference and the open `fix_error` task for the same
  reference make a replay and a re-emitted event converge on the same rows.
- The fix never touches `main` without the user: the branch is pushed, the
  PR is opened (K1, notified), the preview is verified, and the user merges
  in their own repository on their own time. The go-live card deploys the
  verified files; it is the only decision in the loop and it counts against
  the daily quota (DEC-3).
- The `fix_error` task is `done` only with the verified URL evidence of the
  M3 settlement path (AGT-2): approve → live URL, decline → preview URL.
- `repo.pull_request` is a K1 kind like `repo.push`; it is performed by the
  worker through the gate, logged in `actions`, and resolved through the
  user's GitHub connection (ADR 0010: no platform key).
- The engineering agent sees the error as data in its input and holds no
  tool that could act on the outside world from inside the run; everything
  external happens afterwards through the pipeline's gated actions.
- A second error source (another provider's issue webhook) follows the same
  shape: a worker route with its own secret, a strict schema, a company
  lookup by project, and a signal row. The fix loop learns nothing new.
