import { describe, expect, it } from "vitest";
import { workerEnv } from "../src/env";
import { createTracer, NO_TRACER, type TraceTransport } from "../src/observability";

/**
 * D6-10 (OBS-1): without the three Langfuse keys the tracer is a no-op; with
 * them one trace per agent run, one span per PreToolUse decision, the cost and
 * tokens on the run's generation; prompts and tool inputs are redacted unless
 * `LANGFUSE_REDACT=0`. A transport failure never reaches the run.
 */

const base = { SUPABASE_URL: "http://127.0.0.1:54321", SUPABASE_SERVICE_ROLE_KEY: "service-role-key-xyz" };
const keys = { LANGFUSE_PUBLIC_KEY: "pk-lf-fake", LANGFUSE_SECRET_KEY: "fake-secret", LANGFUSE_HOST: "https://cloud.langfuse.com" };
const PROMPT = "Task: write the landing page for Lumen. SECRET-PROMPT-TEXT";
const TOOL_INPUT = { query: "SECRET-TOOL-INPUT about pricing" };

interface Recorded {
  readonly kind: "trace" | "span" | "generation";
  readonly body: Record<string, unknown>;
}

function fakeTransport(fail = false): TraceTransport & { readonly calls: Recorded[]; flushed: number } {
  const calls: Recorded[] = [];
  const record = (kind: Recorded["kind"]) => (body: Record<string, unknown>) => {
    if (fail) throw new Error("langfuse down");
    calls.push({ kind, body });
  };
  const transport = { calls, flushed: 0, trace: record("trace"), span: record("span"), generation: record("generation"), flushAsync: async () => void (transport.flushed += 1), shutdownAsync: async () => void (transport.flushed += 1) };
  return transport;
}

const call = (traceId: string | null, toolName: string, decision: "allow" | "deny" = "allow") => ({ companyId: "company-1", taskId: "task-1", toolName, input: TOOL_INPUT, decision, toolUseId: `tu-${toolName}`, traceId, reason: decision === "deny" ? "kill switch" : null });

async function traceOneRun(env: ReturnType<typeof workerEnv>, transport: ReturnType<typeof fakeTransport>, tools = 3): Promise<string | null> {
  const tracer = createTracer(env, transport);
  const traceId = tracer.startRun({ companyId: "company-1", taskId: "task-1", role: "engineering", taskType: "build_site", instructions: PROMPT });
  for (let i = 0; i < tools; i += 1) tracer.toolCall(call(traceId, `tool_${i}`, i === tools - 1 ? "deny" : "allow"));
  tracer.endRun(traceId, { model: "claude-test", costUsd: 0.42, inputTokens: 1200, outputTokens: 300, status: "succeeded" });
  await tracer.flush();
  return traceId;
}

describe("D6-10 tracer", () => {
  it("no keys → the no-op tracer: no trace id, nothing sent", async () => {
    const transport = fakeTransport();
    const tracer = createTracer(workerEnv(base as NodeJS.ProcessEnv), transport);
    expect(tracer).toBe(NO_TRACER);
    expect(tracer.enabled).toBe(false);
    expect(await traceOneRun(workerEnv(base as NodeJS.ProcessEnv), transport)).toBeNull();
    expect(transport.calls).toEqual([]);
  });

  it("with keys: one trace, N tool spans, cost and tokens on the generation, and no prompt or tool input text when redacted (the default)", async () => {
    const transport = fakeTransport();
    const traceId = await traceOneRun(workerEnv({ ...base, ...keys } as NodeJS.ProcessEnv), transport, 4);
    expect(traceId).toMatch(/^[0-9a-f-]{36}$/);
    expect(new Set(transport.calls.filter((c) => c.kind === "trace").map((c) => c.body.id))).toEqual(new Set([traceId]));
    const spans = transport.calls.filter((c) => c.kind === "span");
    expect(spans).toHaveLength(4);
    expect(spans.every((s) => s.body.traceId === traceId)).toBe(true);
    expect(spans.map((s) => s.body.name)).toEqual(["tool:tool_0", "tool:tool_1", "tool:tool_2", "tool:tool_3"]);
    expect(spans.at(-1)?.body.metadata).toMatchObject({ decision: "deny", reason: "kill switch" });
    const generation = transport.calls.find((c) => c.kind === "generation");
    expect(generation?.body).toMatchObject({ traceId, model: "claude-test", usage: { input: 1200, output: 300, totalCost: 0.42 } });
    const sent = JSON.stringify(transport.calls);
    expect(sent).not.toContain("SECRET-PROMPT-TEXT");
    expect(sent).not.toContain("SECRET-TOOL-INPUT");
    expect(transport.flushed).toBe(1);
  });

  it("LANGFUSE_REDACT=0 sends the prompt and the tool inputs", async () => {
    const transport = fakeTransport();
    await traceOneRun(workerEnv({ ...base, ...keys, LANGFUSE_REDACT: "0" } as NodeJS.ProcessEnv), transport, 1);
    const sent = JSON.stringify(transport.calls);
    expect(sent).toContain("SECRET-PROMPT-TEXT");
    expect(sent).toContain("SECRET-TOOL-INPUT");
  });

  it("a failing transport never throws into the run; a tool call without a trace is ignored", async () => {
    const transport = fakeTransport(true);
    const tracer = createTracer(workerEnv({ ...base, ...keys } as NodeJS.ProcessEnv), transport);
    const traceId = tracer.startRun({ companyId: "company-1", taskId: "task-1", role: "research" });
    expect(traceId).toMatch(/^[0-9a-f-]{36}$/);
    expect(() => tracer.toolCall(call(traceId, "search"))).not.toThrow();
    expect(() => tracer.endRun(traceId, { model: "m", costUsd: 0, inputTokens: 0, outputTokens: 0, status: "failed" })).not.toThrow();
    const healthy = fakeTransport();
    const other = createTracer(workerEnv({ ...base, ...keys } as NodeJS.ProcessEnv), healthy);
    other.toolCall(call(null, "search"));
    other.endRun(null, { model: "m", costUsd: 0, inputTokens: 0, outputTokens: 0, status: "failed" });
    expect(healthy.calls).toEqual([]);
  });
});
