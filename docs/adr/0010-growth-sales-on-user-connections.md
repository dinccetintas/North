# ADR 0010: Growth and sales run on the user's connections, never on platform keys

Status: accepted (2026-10-15)

## Context

The M2 Meta adapter read `META_ACCESS_TOKEN` and `META_AD_ACCOUNT_ID` from the
worker's environment: one platform account would have spent on behalf of every
company. That contradicts BUD-2 (money moves only from the user's own accounts;
the platform never custodies funds) and ONB-3, which lists Meta Ads and Gmail
among the user's connections. Sending first-contact email from the platform's
Resend domain has the same shape of problem: North would be the sender of
record, replies would land in North's mailbox, and the user's own domain
reputation would be neither used nor earned. M3 already built the mechanism
this needs: encrypted per-user tokens (ADR 0008), `providerAuthFor`, and the
connect card raised by `ConnectionRequiredError`.

## Decision

`Integrations.ads`, `outreach`, `analytics` and `payments` are factories
`(auth: ProviderAuth | null) => Provider`, like `code` and `deploy` in M3.
The live Meta and Gmail adapters refuse to run without `auth`. The worker
resolves the connection from the action kind with `providerForAction`
(`packages/core/src/connections.ts`): `ads.start`, `ads.budget.change`,
`ads.pause`, `ads.resume` → `meta_ads`; `email.send.first_contact`,
`email.send.reply` → `gmail`; `budget.cap.raise` → none (it changes North's
own row, not the provider). In live mode a missing or unreadable connection
raises `ConnectionRequiredError`, which opens the connect card (ONB-3); the
task parks until the user connects or skips.

The platform keeps only what identifies North's OAuth apps: `META_APP_ID` /
`META_APP_SECRET` and `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`. These name
the application, not any account; the former platform Meta keys are removed
from `.env.example`, `select.ts` and the CI secret grep. The user's ad account
id travels as the connection scope `act:<id>` and the page as `page:<id>`,
picked at OAuth exchange from the first account and page the token can see.
Tokens are stored under ADR 0008 as `ProviderTokenSchema` JSON (`accessToken`,
`refreshToken?`, `expiresAt?`); the worker refreshes a Google token when it is
within 60 s of expiry and re-stores it under the same key, and marks the row
`error` (raising `ConnectionRequiredError`) when it cannot.

The adapters act only on what North created: `pauseMany` takes North's own
campaign ids and never lists or touches other campaigns in the ad account;
Gmail replies are read per sent thread (`users.threads.get`, messages after
the send whose `From` is not the connected address), never by scanning the
inbox. External references say where they came from: `gmail:<messageId>:<threadId>`
live, `sandbox:msg:<uuid>` and `sandbox:campaign:<id>` in sandbox.

Platform Resend stays, for one purpose: decision notifications from North to
its own user. Everything addressed to the outside world goes through a
connection.

Sandbox mode is unchanged in shape: "Connect (sandbox)" records a connection
without a token (ADR 0008), the sandbox adapters persist campaigns and
messages under `SANDBOX_ROOT`, and the worker's loopback-only sandbox routes
simulate delivery and replies so the whole loop is provable with no key at
all. Google Ads, PostHog and the Stripe read ship as interface stubs that
throw `NotConfiguredError`; each live adapter is one file later.

## Consequences

- A growth or sales task cannot run live until the user connects Meta Ads or
  Gmail; the first such task opens the connect card. This is the intended
  onboarding path, not a failure.
- Revoking a connection is the user's own stop switch: North can no longer
  read insights or pause through the API. A kill-switch pause that fails for
  that reason is recorded `failed` and logged; the row keeps its status with
  `last_error`.
- The founder must register a Meta app (development mode, founder as tester,
  a Meta sandbox ad account) and a Google OAuth client per environment; until
  then the recorded request shapes in `live.meta-ads.test.ts`,
  `live.gmail.test.ts` and `provider-auth.test.ts` stand in for the live run.
- Deliverability and reply tracking belong to the user's mailbox; North holds
  no copy of a sent body (sandbox stores `to`, `subject`, `kind`, `sentAt`).
- A second ads provider (Google Ads) follows the same path: a `CONNECTION_PROVIDERS`
  entry, a `providerForAction` case, a factory taking `ProviderAuth`. No new
  platform secret is ever the answer.
