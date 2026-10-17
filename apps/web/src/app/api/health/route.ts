import { NextResponse } from "next/server";
import { llmModeOf } from "@north/agents/llm/client";

/**
 * STG-1, TST-5: whether this web process could call the model itself. The web
 * must never do that around the worker's gateway (budget, cassettes, fence), so
 * `scripts/production-check.ts` requires "mock" in production and in staging.
 * Decided by `llmModeOf` in `@north/agents`, the same predicate `selectLlm`
 * uses, so this file reads no model credential and cannot leak one.
 */

/** `GET /api/health` (OPS-1, STG-1): the web is up, and whether this process could call the model. Nothing secret, nothing about users. */
export function GET() {
  return NextResponse.json({ ok: true, app: "north-web", time: new Date().toISOString(), llm: llmModeOf(process.env) });
}
