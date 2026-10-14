# ADR 0001: One authority engine gates every external action

Status: accepted (2026-10-14)

## Context

Polsia's most damaging failures are unapproved outreach, money spent without a
confirmation gate, and tasks claimed done without proof. The spec (DEC-1, K0-K3,
budget protections) requires that no external effect occurs without a tier
decision, and that agents cannot lower a tier.

## Decision

A single pure module `packages/core/src/authority/` classifies and gates every
`ActionSpec`. All integration adapters are reachable by agents only through MCP
tools whose handlers call `gate()` first. The database enforces the same rule:
`actions.tier` is NOT NULL and K2/K3 rows require a `decision_card_id`. An Agent
SDK `PreToolUse` hook denies any tool outside the role's list as a second layer.

## Consequences

- Adding a new integration means adding an adapter and a tool; the gate is
  inherited, not re-implemented.
- Tests can prove DEC-1 by attempting every K2/K3 action without a card and
  asserting both the code and the database reject it.
- Slight latency per action (one pure function call, one insert); acceptable.
