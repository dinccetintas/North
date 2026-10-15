# ADR 0009: Ledger numbers are scoped samples with provenance; spend is applied by one database function

Status: accepted (2026-10-15)

## Context

OUT-1 asks the outcome ledger to say what each task or action changed, in
which metric, at what cost; OUT-2 asks for daily-fresh sources. Until M3 the
`metrics` table held one series per key, `ledger_entries` were written by the
worker with no link to the campaign or batch that produced them, and
`budgets.spent_today_usd` / `spent_total_usd` were plain columns any
service-role code path could add to. Three things broke under M4's hourly
collector:

- A campaign's clicks and a batch's replies had to feed the goal bar without
  being counted twice: once as "the company's sign-ups" and once as "the
  sign-ups Meta attributes to campaign X".
- Inngest retries steps. A retried attribution step must not insert a second
  entry or apply the same spend twice; BUD-1 promises the caps are enforced
  "in code and in the database", and the database side was missing.
- The M2 gate compared a $50 five-day campaign against the $20 daily cap
  (one number against two caps).

## Decision

**Samples carry a scope and provenance.** `metrics` gains `scope`
(`company` | `channel`, default `company`), `provenance jsonb`,
`provenance_key text` and `window_end timestamptz` (`packages/core/src/metrics.ts`:
`METRIC_SCOPES`, `ProvenanceSchema`, `provenanceKey`). Company-scope rows are
the company's own series and the only rows `latestMetric`, the goal bar and
the brief read; a company metric has exactly one source per mode (sandbox
analytics in sandbox, PostHog/Stripe live). Channel-scope rows are cumulative
per source and carry `Provenance`, a union discriminated on `channel`:
`meta_ads` / `google_ads` with `campaignId`, `cold_email` with `batchId` and
`messageIds`; every branch has `windowEnd`, `sandbox` and the provider's `raw`
figures (kept for the audit, never read for decisions). `provenanceKey` is
`<channel>:<campaignId>` or `cold_email:<batchId>`. `organic` has no
provenance: it only ever appears as a company-scope source. A unique partial
index on `(company_id, metric_key, provenance_key, window_end)` for channel
rows makes a replayed window a no-op.

**A campaign is a table row, not a payload.** `campaigns` is a mutable summary
per executed `ads.start` action (`action_id` unique; status in
`CAMPAIGN_STATUSES` = `active`, `paused_cap`, `paused_kill`, `paused_user`,
`ended`; `paused_day`, spent and delivery totals, `last_collected_at`,
`sandbox`). The audit stays in `actions` (every start, pause and resume is a
row) and the numbers stay in `metrics` and `ledger_entries`; the table exists
because the collector, the cap logic, the kill switch and the ledger page need
one stable key with a status. Owners read it; only the worker writes it.

**A ledger entry is one attribution window.** `ledger_entries` gains
`provenance`, `campaign_id` and `action_id`. `before` / `after` are the
source's cumulative attributed metric at the previous and current window,
`cost_usd` is the spend of the window, `channel` is one of `CHANNELS`
(`meta_ads`, `google_ads`, `cold_email`, `organic`). `windowDelta(previous,
current)` in `packages/core/src/ledger/attribution.ts` computes the three from
two cumulative samples and clamps the cost at zero: a provider revising its
spend downwards costs nothing more. The append-only trigger stays.

**Spend is applied by one security-definer function.**
`apply_budget_spend(company, category, amount, day)` (service role only) rolls
the day when `day` is new (resetting `spent_today_usd` and `daily_extra_usd`),
adds the amount, refuses negatives and returns `cap_daily`, `cap_total`,
`spent_today`, `spent_total`, `daily_limit_effective` and `applied` (false
when the call's day is already over for the row: a late spend counts against
the total only and a late cap raise is not applied, migration 0009). Owners may update
only `total_limit_usd` and `daily_limit_usd` (column grants); the `spent_*`
columns and `daily_extra_usd` / `daily_extra_date` are written by nothing but
this function and `raise_daily_cap(company, category, amount, day)`.
`record_attribution(payload jsonb)` inserts the channel samples, the ledger
entry and applies the spend in one transaction, returning `{ duplicate,
entry_id, cap_daily, cap_total }`. The trigger `campaigns_within_budget`
refuses to set a row `active` when its `daily_budget_usd` exceeds today's
effective daily headroom (errcode `check_violation`, message `budget_cap`).
This is BUD-1 "in the database".

**The gate is BUD-1 "in code", with two caps.** `spendProfile(spec)` →
`{ perDayUsd, totalUsd }` (per-day from `payload.dailyBudgetUsd` for ads
kinds, the whole amount otherwise); `wouldExceedBudget(budget, profile)`
checks each against its own headroom. `BudgetState.dailyExtraUsd` carries
today's raise; `effectiveDailyLimit = dailyLimitUsd + dailyExtraUsd`.
`capExceeded(budget)` → `{ daily, total }` uses `>=`: a cap counts as reached
once the spend equals it, because nothing more may be spent under it.

**A reached cap pauses first and asks second.** When `record_attribution`
reports `cap_daily` or `cap_total`, the worker gates and performs `ads.pause`
(K1, `notified`) and then opens one K2 card through the gate with the kind
`budget.cap.raise` (`spendsMoney`; `amountUsd` = the raise, so a raise over
$500 is K3 by the existing rule). `capCardSpec` in
`packages/core/src/decisions/cap-card.ts` is pure: the raise is the campaign's
daily budget for a daily cap and its remaining total for a total cap; the
card's recommendation and default are `decline`. Approve → `raise_daily_cap`
for today only (a total cap raises `total_limit_usd`) → `ads.resume` (K1)
through the gate. One cap card per campaign per day; a daily-cap pause resumes
by itself at the day roll (the original card approved that daily budget), a
total-cap pause never resumes without a card.

## Consequences

- `metrics`, `ledger_entries` and `campaigns` are owner select-only; no web
  code path writes a number. Owners still edit the two cap columns in
  `budgets`.
- `latestMetric` filters `scope = company`; any new reader of the goal value
  must do the same, or a channel sample would become "the" value.
- Collector steps may retry freely: the unique index and
  `record_attribution`'s `duplicate` flag make a replay harmless.
- Adding a channel means a `CHANNELS` entry, a `ProvenanceSchema` branch, a
  `provenanceKey` case and, for an ads channel, the `campaigns.provider`
  check. Nothing else learns about it.
- `spent_*` cannot drift from the app side; a correction is a migration, not
  an update.
- A campaign's totals follow the provider's cumulative figures; the ledger
  shows a window with zero cost when the provider revises spend down.
- The cap card counts against the daily quota (DEC-3). While the quota is
  spent the campaign stays paused and the next hourly collection retries the
  card; the safe state is always "not spending".
