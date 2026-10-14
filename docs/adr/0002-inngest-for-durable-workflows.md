# ADR 0002: Inngest for durable workflows and decision waits

Status: accepted (2026-10-14)

## Context

Agent tasks run for minutes, may pause for a human decision for up to days, must
survive deploys, and must be cancellable within seconds (kill switch). Daily
briefs, signal scans and metric collection are scheduled. The reference product
used Celery + Redis + Beat.

## Decision

Use Inngest v4. `step.run` for retried steps, `step.waitForEvent` for decision
cards (matched on `cardId`, timeout = card due time, `null` → safe default),
`cancelOn: company/killswitch` for the kill switch, `cron()` triggers for briefs
and scans. Light functions are served from `apps/web`; agent functions from
`apps/worker`. Local development uses the Inngest Dev Server (`INNGEST_DEV=1`).

## Consequences

- No queue infrastructure to run; full run history in the Dev Server/Cloud UI.
- Function code must be deterministic between steps (all I/O inside `step.run`).
- Inngest Cloud is a vendor dependency; the event names are ours and small, so a
  migration to another durable engine would touch only `apps/*/inngest/`.
