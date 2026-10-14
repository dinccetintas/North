# ADR 0004: Claude Agent SDK behind an `AgentRuntime` interface with a mock

Status: accepted (2026-10-14)

## Context

Agents need tools, structured results, cost accounting and a sandbox. Tests and
the smoke loop must run without API keys and deterministically. The spec allows
Claude Agent SDK, Managed Agents or an isolated sandbox.

## Decision

`packages/agents` defines `AgentRuntime.run(input) → result`. The production
adapter wraps `query()` from `@anthropic-ai/claude-agent-sdk` with: per-task
`cwd`, `settingSources: []`, role-scoped `allowedTools`, an in-process MCP server
exposing North tools (all gated), `PreToolUse` audit/deny hook, `outputFormat`
JSON schema, `maxBudgetUsd`/`maxTurns`, and model routing from
`packages/core/src/models.ts`. `MockRuntime` replays fixtures. A Managed Agents
adapter can be added later without touching callers.

## Consequences

- Agent execution requires a long-running Node process (`apps/worker`), not a
  serverless function.
- Every tool call is observable and gated; agents never hold raw credentials.
- Fixture maintenance is part of adding a task type.
