import { NextResponse } from "next/server";

/**
 * STG-1, TST-5: whether this web process could call the model itself. The web
 * must never do that around the worker's gateway (budget, cassettes, fence), so
 * `scripts/production-check.ts` requires "mock" in production and in staging.
 * Computed here from the two settings that would arm it, never the key.
 */
function llmMode(): "mock" | "live" {
  return process.env.AGENT_RUNTIME === "claude-agent-sdk" && Boolean(process.env.ANTHROPIC_API_KEY) ? "live" : "mock";
}

/** `GET /api/health` (OPS-1, STG-1): the web is up, and whether this process could call the model. Nothing secret, nothing about users. */
export function GET() {
  return NextResponse.json({ ok: true, app: "north-web", time: new Date().toISOString(), llm: llmMode() });
}
