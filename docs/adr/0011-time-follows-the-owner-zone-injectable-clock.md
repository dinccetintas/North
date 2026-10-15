# ADR 0011: Time follows the owner's zone; the worker has one injectable clock

Status: accepted (2026-10-15)

## Context

DEC-3 promises at most three decision cards per day. Until M4 "day" meant
the UTC date: `assign_decision_card_seq` took `current_date`, the web counted
"today" from the UTC slice of `created_at`, and the trigger's advisory lock
keyed on `(company, day)` with that date. The M2 review (L2) flagged it: an
owner in Istanbul who answers three cards after 03:00 local has spent a
"day" that ends at 03:00 the next morning, and an owner in Los Angeles sees
the quota reset at 17:00. BRF-1 makes it worse: the morning brief must arrive
at 07:00 in the user's time zone, and the plan's Monday rewrite (PLN-2) fires
on the owner's Monday, so M5 needs "what time is it for this owner" in three
places, all agreeing.

Two shapes were considered for the quota day. A nightly rollover cron that
stamps "today" on the company would make the day a card lands on depend on
when the cron last ran, and would need one run per time zone the owners live
in. Computing the day from a timestamp at insert time needs no cron and no
state.

M5 also has to be provable in sandbox: the acceptance run drives the company
through seven days, and Inngest crons fire on the wall clock. The worker
already read `new Date()` in a dozen places (`todayIsoDate`, `cardDueAt`,
overdue defaults, `weekStartOf`, the collector's `now`), each its own source
of truth.

## Decision

**The quota day is the owner's local day, computed in the trigger.**
`decision_cards` gains `opened_at timestamptz not null default now()`; the
worker sets it from its clock through `OpenCardInputSchema.openedAt`.
`assign_decision_card_seq` is replaced: it selects `daily_decision_quota` and
`timezone` in the same `users` join it already makes for the quota, computes
`new.day := (new.opened_at at time zone u.timezone)::date` inside an
exception block that falls back to `(new.opened_at at time zone 'UTC')::date`
for a zone Postgres does not know, and only then takes the advisory lock on
`(company, day)` and runs the unchanged check `seq ≤ quota` per
`(company_id, day)`. The database stays the enforcement point: the owner
cannot insert cards, the day is computed server-side from a timestamp and is
never trusted as a date, and a card opened with an `opened_at` in the past
lands on its own day. A `users` trigger (`users_timezone_valid`) refuses to
store a zone Postgres cannot evaluate, so the settings form fails loudly
instead of silently resetting the owner to UTC.

Core gets `localDay(timezone, now) → YYYY-MM-DD`, `localHour`, `isoWeek(day)
→ YYYY-Www` and `weekStartLocal(timezone, now)` in `packages/core/src/time.ts`
(Intl-based, pure), so the web and the worker count "today" the same way.
`cardsOpenedToday(db, companyId, day)` now requires the day; the type checker
finds every caller.

**Budgets stay on the UTC day in M5.** `apply_budget_spend`,
`campaigns_within_budget`, the cap cards and `daily_extra_date` all key on
`current_date` as ADR 0009 left them. Moving the spend day to the owner's zone
touches the budget function, the campaign trigger and the collector's day
roll, each with M4 tests of its own; it is a separate change, scheduled as an
M6 follow-up. Until then a cap card and a decision card may disagree about
which day it is by up to one local day, which affects nothing but the day a
raise is recorded against.

**The worker has one clock.** `WorkerDeps.clock: () => Date`. Every
time-dependent decision (the brief hour, the scan window, a card's
`opened_at` and `dueAt`, overdue defaults, the plan week, the metric day)
reads it; no worker module calls `new Date()` for a decision. In production
it is the wall clock. In sandbox mode on a loopback host the smoke harness
may set it through `POST /sandbox/clock { now }` next to the M4 simulation
routes, under the same mounting rule: the route is 404 in live mode or off
loopback. `NORTH_CLOCK_START` seeds the dev worker's clock, sandbox only.

**Cron bodies are shared with events.** `daily-brief`, `scan-signals` and
`plan-week-cron` are hourly crons whose bodies are the same functions the
events `brief/tick`, `signal/scan` and `plan/requested` run, so the harness
can run "this hour" now instead of waiting for it. Both paths are idempotent
(one brief per company and local day, one signal per source reference, one
plan per week). Days are not event-driven: a day is simply what the clock
says, and the crons ask the clock whether it is 07:00 or Monday 06:00 for
each owner.

## Consequences

- Cards per owner-local day never exceed the quota, in code (`localDay` +
  `cardsOpenedToday(day)`) and in the database (the trigger). An owner who
  changes zone changes which cards count as "today"; the already-stored
  `day` of past cards does not move.
- The worker-supplied `opened_at` is an input the trigger derives the day
  from, not a day the trigger trusts: a client cannot pick its quota day
  without also picking a timestamp that lands on it, and only the worker's
  service role can insert at all.
- Any new time-dependent worker code must read `deps.clock()`; a `new Date()`
  in a worker service is a review finding. Tests pass a fixed clock and the
  smoke harness advances it through seven days without waiting.
- The clock route is a sandbox-only, loopback-only surface; the security
  review checks its mounting with the other simulation routes.
- Budgets and decision cards use different day definitions until the M6
  follow-up; the brief's spend section reports the UTC day the budget
  function uses and says so.
- Adding a time-zoned schedule (a per-user brief hour, M6) is a settings
  field and a `localHour` comparison, not a new cron.
