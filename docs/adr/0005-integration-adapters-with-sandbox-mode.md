# ADR 0005: Every integration is an adapter with a sandbox implementation

Status: accepted (2026-10-14)

## Context

Ads, email and deploys spend money or reach real people. The founder enters live
keys only at launch. The whole loop must be testable end to end before that.

## Decision

`packages/integrations/<provider>/` exports one interface (e.g. `AdsProvider`,
`MailProvider`, `DeployProvider`, `RepoProvider`, `PaymentsProvider`,
`AnalyticsProvider`) with `live` and `sandbox` implementations selected by
`INTEGRATIONS_MODE` (default `sandbox`). Sandbox implementations persist the
intended effect to `actions.payload` and return realistic evidence (fake message
IDs, preview URLs) so verifiers and the ledger exercise the same code paths.

## Consequences

- The smoke loop and E2E suites run with zero external credentials.
- Live adapters are added incrementally (Vercel/GitHub in M3, Meta/Google/Gmail
  in M4) with recorded-fixture tests.
- Evidence verification must distinguish sandbox evidence (marked) from live.
