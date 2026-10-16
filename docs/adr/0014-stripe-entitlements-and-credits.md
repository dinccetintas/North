# ADR 0014: Entitlements are projected from billing events by the worker; credits are a ledger; a subscription ends through the kill switch

Status: accepted (2026-10-15)

## Context

BIL-1 and BIL-2 make North a merchant for the first time: Solo, Pro and
Scale subscriptions sold through Stripe Billing, each with a company limit
and a monthly allowance of agent work, plus one-off credit packs. The spec
says agents stop when a subscription ends, the data is kept for 90 days and
stays exportable, and the per-user cost is visible. Until M5 `users.plan`
was a text column nobody wrote and `usage` an empty table.

Three questions had to be settled before the work packages started: which
process talks to Stripe and holds the keys; what the source of truth for "what
is this user allowed to do" is; and what "agents stop" means in a system
that already has a kill switch with a measured 5 s SLA.

The temptation is to let the web app, which renders the pricing page, create
the checkout session and read the subscription back on the success redirect.
That puts a secret key in the web bundle (CI greps for worker-class secrets
for a reason) and trusts a redirect the customer can type into the address
bar. The other temptation is a mutable `credits_remaining` integer the worker
decrements per run, which is exactly the shape non-negotiable 3 forbids for
money-like records.

Prices are the founder's to change (the spec says so), and Stripe needs
objects that exist before a checkout can be created.

## Decision

**The worker holds the Stripe keys and the web never creates a session.**
`STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` are worker secrets on the CI
grep list. The settings page inserts a `billing_sessions` row (`kind:
checkout | portal | credit_pack`, `status: requested`; the owner's insert
policy allows nothing else) and sends `billing/session_requested`; the
worker creates the Stripe session and writes `url` and `provider_ref`
(service role only); the web polls the row under RLS and redirects. This is
the ADR 0008 shape: the web forwards, the worker holds the secret. The
success redirect proves nothing and changes nothing.

**The Stripe webhook lives in the worker and is the only writer of
entitlements.** `POST /webhooks/stripe` follows ADR 0013: `stripe-signature`
verified over the raw bytes with `timingSafeEqual` and a 300 s timestamp
tolerance on the worker clock, a strict Zod union that keeps only the fields
the projection reads from six event types (seven since the amendment
below), a 256 KB body limit, idempotency
by `billing_events.event_id` (unique, append-only, no owner policies). Every
accepted event is stored before it is applied; `apply-billing-event` runs
the pure projection `applyBillingEvent(entitlement, event, now)` from core
and upserts the one `entitlements` row per user (`plan_id`, `status`
`trialing | active | past_due | canceled | ended`, `company_limit`,
`monthly_credits`, `price_usd`, period, `cancel_at`, Stripe ids,
`ended_at`, `retention_until`). Owners select; `users.plan` is a mirror kept
by a trigger. An older event never regresses a newer status. In sandbox
mode the `SandboxBilling` adapter's checkout and portal pages (loopback-only
routes on the worker) post Stripe-shaped events, signed with the sandbox
secret, to the same route, so the projection is exercised by exactly one
path everywhere.

**Entitlements are enforced where the effect happens.** Company creation is
refused by the trigger `companies_within_entitlement` (active status and
`count(status <> 'archived') < company_limit`, under an advisory lock on the
owner; it binds the service role too), with core's `canCreateCompany` giving
the web its message first. Agent dispatch asks `dispatchAllowed(deps,
companyId)` at the top of every run (`executeTask`, the scan, the weekly
plan, the fix task): kill switch, then entitlement, then credits, and a
refusal is a `blocked` outcome with its reason, never a thrown error. The
brief, metric collection and exports keep running for an `ended` user until
`retention_until`: they read.

**A new user gets a 14-day Solo trial without a card.** `trialEntitlement`
is inserted by the auth trigger and backfilled over existing users, so every
M0–M5 proof that creates one company per owner still holds. A trial that
passes its `period_end` with no subscription ends like a cancelled
subscription.

**"Agents stop when the subscription ends" is the kill switch.** When the
projection's transition is `ended` (`customer.subscription.deleted`, a
closed `past_due`, an expired trial), the worker sets `kill_switch_active =
true` with `paused_reason = subscription_ended` on every company of the
owner and emits `company/killswitch` per company. Everything M2–M4 proved
about the switch (function cancellation, campaign pauses, dispatch refusal,
5 s) applies unchanged. `company/resume` is refused while the reason is
`subscription_ended` and the entitlement is not active; a new subscription
clears the flags it set and emits `company/resume`, which opens the M4
resume card for campaigns. The user's own switch sets `paused_reason =
user` and billing never touches it. No new machinery stops agents.

**Credits are an append-only ledger.** `credit_entries` (`kind: grant_plan |
grant_pack | consume | expire | adjust`, signed `amount`, `ref` unique per
user, append-only trigger) is the only record; the balance is a sum. One
credit is one agent run, any role, any runtime, so sandbox and mock runs
prove the machinery. Plan credits are granted on `invoice.paid` with `ref =
plan:<subscription>:<periodStart>` (a replay grants nothing), the trial once
(`trial:<user>`), a pack on its payment checkout (`pack:<session>`); unused
plan credits expire at the period roll (`expire:<periodStart>`), pack credits
never. The worker writes one `consume` per `agent_runs` row (`run:<id>`) in
the step that records the run. Dispatch refuses at balance ≤ 0
(`credits_exhausted`); the trigger `credit_entries_no_overdraft` refuses a
`consume` that would take the balance below `-CREDIT_GRACE` (5) under an
advisory lock per user, so concurrent runs cannot drain past the grace.
Buying credits is the user's own click in Stripe: there is no action kind
for it and North never spends the user's money (BUD-2).

**The spec's `usage` table is a projection.** `usage_apply(user, period,
credits, cost, minutes)` is an additive upsert executable by the service
role only (the `apply_budget_spend` pattern); the worker calls it after every
run with the owner-local month. The settings page shows inference plus
sandbox cost against `price_usd` with the 40 % line (the spec's cost NFR);
`usage-tick` sends one `usage_alert` per user per period.

**Prices and credits are configuration in core.** `packages/core/src/billing/plans.ts`
holds the plans (price, company limit, monthly credits, lookup key) and the
packs; Stripe prices carry lookup keys and `scripts/stripe-setup.ts` creates
or rotates them from the file (transferring the lookup key). The worker
resolves a price by lookup key at checkout. Changing a number is an edit and
a script run; no price id lives in code or in an environment variable.

## Amendment: M6 security review (2026-10-16)

The review found that the projection trusted too much of what Stripe sends.
These rules replace the matching sentences above; migration
`0016_m6_billing_hardening.sql` and `packages/core/src/billing/*` carry them.

- **Seven event types.** `checkout.session.async_payment_succeeded` joins
  the six: it is how a pack bought with a delayed method (ACH, SEPA) is paid.
  `async_payment_failed` is answered 200 and stored nowhere.
- **A pack is granted only when it is paid.** `payment_status = paid` (or the
  async success event), a known `north_pack_id`, and `amount_total` exactly
  the pack's price in USD; no fallback to a default pack. Pack checkouts are
  card-only, without promotion codes.
- **Plan credits only for a real period.** `invoice.paid` grants plan credits
  only when `billing_reason` is `subscription_create` or
  `subscription_cycle`, the period comes from the subscription's own line
  (never a proration line), and that line's price is above 0. A renewal paid
  from the customer's balance still grants; a proration invoice grants
  nothing and never moves the period.
- **The entitlement follows one subscription.** An invoice or update for
  another subscription changes nothing; only a newer
  `customer.subscription.created` adopts a different one, and a checkout
  fills the subscription only when none is followed. A delete of the followed
  subscription ends the entitlement even when it arrives late. A trial
  adopts a checkout's subscription only once its payment settled; an
  `incomplete` subscription changes nothing.
- **Reconciliation.** `entitlements-tick` asks the provider for the followed
  subscription once `cancel_at` / `period_end` is more than 3 days past and
  ends the rows Stripe reports gone or ended. Ids from the other billing mode
  are skipped, so switching sandbox to live cannot end every user.
- **The user hint needs a session.** `client_reference_id` /
  `metadata.north_user_id` is trusted only when a `billing_sessions` row the
  worker created has that `provider_ref` and that user; otherwise the
  customer must already be known.
- **Reduced payloads.** `billing_events.payload` stores the parsed, reduced
  event (no email, address or hosted invoice URL) and `payload_sha256` the
  hash of the raw signed body. Rows no user owns are swept after 30 days by
  `billing_events_sweep_unknown` (the retention sweep), the one delete the
  append-only trigger allows besides `purge_owner`.
- **The credit is reserved at dispatch.** `credit_reserve(user, ref)` writes
  the run's `consume` before the run starts and refuses at a balance of 0
  under the per-user credits lock; the run is recorded under the reserved id,
  and a run that throws before it is recorded gets its credit back
  (`release:<id>`). Its cost always reaches `usage`. The −5 grace now covers
  only consumes written after the fact.
- **No read-then-write races.** The tick ends a trial only if the row is
  still a card-less trial, and the apply step writes only over the row it
  read. A second subscription checkout is refused while another is open
  (`billing_sessions.completed_at`, a 35-minute window that matches the live
  session expiry).

## Consequences

- No Stripe secret is ever read by the web; the only billing writes the web
  performs are a `requested` session row and an `exports` request. The
  security review checks the insert policies as it checks the webhook.
- A forged, stale, replayed or unknown event changes nothing: 401, 401, 200
  duplicate, 202 stored-unapplied. An entitlement can only move through the
  webhook, which the sandbox pages also use.
- The company limit holds in the database for the owner and for the service
  role; the credit floor holds for the worker's own concurrency. Both have
  integration tests.
- Ending a subscription is one transition and two existing events per
  company; the 5 s SLA is measured again in `pnpm smoke:m6`, and the resume
  card path is reused, not rewritten.
- A credit balance is reproducible from the ledger at any point in time, and
  the audit question "why is this user at 0" has an answer per row. An
  `adjust` entry is the only manual lever and it is a row with a note.
- Changing a price is an edit to `plans.ts`, a `stripe-setup` run and a
  deploy; existing subscriptions keep their price until Stripe moves them.
- The user's own Stripe account (OUT-2 metrics) remains a `Connection`
  under ADR 0010 and is unrelated to the platform's merchant account; the
  two never share a key.
- A second payment provider would follow the same shape: a `BillingProvider`
  adapter, its own worker webhook route, the same `billing_events` table,
  the same pure projection. The entitlement model learns nothing new.
