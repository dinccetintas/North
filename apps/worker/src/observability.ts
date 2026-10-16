import { randomUUID } from "node:crypto";
import * as Sentry from "@sentry/node";
import { Langfuse } from "langfuse";
import type { ToolCallTrace } from "@north/agents";
import { langfuseConfigured, type WorkerEnv } from "./env";

/**
 * OBS-1: the worker reports its own errors to Sentry when `SENTRY_DSN` is
 * set, and traces agent runs to Langfuse when `LANGFUSE_PUBLIC_KEY`,
 * `LANGFUSE_SECRET_KEY` and `LANGFUSE_HOST` are set (M6, D6-10). Without them
 * nothing is initialised, so a sandbox worker never phones out.
 */
export function initObservability(env: Pick<WorkerEnv, "SENTRY_DSN" | "NODE_ENV" | "INTEGRATIONS_MODE">): boolean {
  if (!env.SENTRY_DSN) return false;
  Sentry.init({ dsn: env.SENTRY_DSN, environment: `${env.NODE_ENV}-${env.INTEGRATIONS_MODE}`, sendDefaultPii: false, tracesSampleRate: 0 });
  return true;
}

/** A warning the founder's Sentry sees (a no-op there without `SENTRY_DSN`) and the log always shows. */
export function reportWarning(message: string, extra: Readonly<Record<string, unknown>> = {}): void {
  console.warn(message);
  Sentry.captureMessage(message, { level: "warning", extra: { ...extra } });
}

export interface RunTraceStart {
  readonly companyId: string;
  readonly taskId: string;
  readonly role: string;
  readonly taskType?: string;
  /** The prompt; sent only with `LANGFUSE_REDACT=0`. */
  readonly instructions?: string;
}

export interface RunTraceEnd {
  readonly model: string;
  readonly costUsd: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly status: string;
}

/** One trace per agent run (`agent_runs.trace_id`), a span per PreToolUse decision, the run's cost on its generation. Never throws. */
export interface Tracer {
  readonly enabled: boolean;
  /** The new trace id, or null when tracing is off. */
  startRun(run: RunTraceStart): string | null;
  /** The SDK runtime's `onToolCall` hook; a call without a trace is ignored. */
  toolCall(call: ToolCallTrace): void;
  endRun(traceId: string | null, end: RunTraceEnd): void;
  flush(): Promise<void>;
}

/** The slice of the Langfuse client the tracer writes through; tests pass a recording fake. */
export interface TraceTransport {
  trace(body: Record<string, unknown>): unknown;
  span(body: Record<string, unknown>): unknown;
  generation(body: Record<string, unknown>): unknown;
  flushAsync(): Promise<void>;
  shutdownAsync(): Promise<void>;
}

export const NO_TRACER: Tracer = Object.freeze({
  enabled: false,
  startRun: () => null,
  toolCall: () => undefined,
  endRun: () => undefined,
  flush: async () => undefined,
});

const PROMPT_MAX_CHARS = 20_000;
const TOOL_INPUT_MAX_CHARS = 4_000;
const REDACTED = Object.freeze({ redacted: true });

const capped = (value: unknown, max: number): string => {
  let json: string;
  try {
    json = typeof value === "string" ? value : (JSON.stringify(value ?? null) ?? "null");
  } catch {
    json = "[unserializable]";
  }
  return json.slice(0, max);
};

/** Observability must never break a run: every transport call is fenced. */
const fenced = (what: string, fn: () => unknown): void => {
  try {
    fn();
  } catch (cause) {
    console.warn(`[langfuse] ${what} dropped: ${cause instanceof Error ? cause.message : String(cause)}`);
  }
};

function langfuseTransport(env: TracerEnv): TraceTransport {
  const client = new Langfuse({ publicKey: env.LANGFUSE_PUBLIC_KEY ?? "", secretKey: env.LANGFUSE_SECRET_KEY ?? "", baseUrl: env.LANGFUSE_HOST ?? "", environment: `${env.NODE_ENV}-${env.INTEGRATIONS_MODE}` });
  return {
    trace: (body) => client.trace(body),
    span: (body) => client.span(body as Parameters<Langfuse["span"]>[0]),
    generation: (body) => client.generation(body as Parameters<Langfuse["generation"]>[0]),
    flushAsync: () => client.flushAsync(),
    shutdownAsync: () => client.shutdownAsync(),
  };
}

export type TracerEnv = Pick<WorkerEnv, "LANGFUSE_PUBLIC_KEY" | "LANGFUSE_SECRET_KEY" | "LANGFUSE_HOST" | "LANGFUSE_REDACT" | "NODE_ENV" | "INTEGRATIONS_MODE">;

/**
 * D6-10: the Langfuse tracer when the three keys are set (the transport is
 * the Langfuse client unless a test injects one), else `NO_TRACER`. With
 * `LANGFUSE_REDACT` other than `0` no prompt text and no tool input leave the
 * worker: the trace carries ids, the role, the task type, the decision per
 * tool and the run's cost and tokens.
 */
export function createTracer(env: TracerEnv, transport?: TraceTransport): Tracer {
  if (!langfuseConfigured(env)) return NO_TRACER;
  const sink = transport ?? langfuseTransport(env);
  const redact = env.LANGFUSE_REDACT !== "0";
  return Object.freeze({
    enabled: true,
    startRun: (run: RunTraceStart) => {
      const id = randomUUID();
      const input = redact || run.instructions === undefined ? REDACTED : capped(run.instructions, PROMPT_MAX_CHARS);
      fenced("trace", () => sink.trace({ id, name: `agent-run:${run.role}`, input, metadata: { companyId: run.companyId, taskId: run.taskId, role: run.role, taskType: run.taskType ?? null }, tags: [run.role] }));
      return id;
    },
    toolCall: (call: ToolCallTrace) => {
      if (!call.traceId) return;
      const traceId = call.traceId;
      const input = redact ? REDACTED : capped(call.input, TOOL_INPUT_MAX_CHARS);
      fenced("span", () => sink.span({ traceId, name: `tool:${call.toolName}`, input, metadata: { decision: call.decision, reason: call.reason, toolUseId: call.toolUseId, taskId: call.taskId } }));
    },
    endRun: (traceId: string | null, end: RunTraceEnd) => {
      if (!traceId) return;
      fenced("generation", () => sink.generation({ traceId, name: "run", model: end.model, usage: { input: end.inputTokens, output: end.outputTokens, unit: "TOKENS", totalCost: end.costUsd }, metadata: { status: end.status } }));
      fenced("trace", () => sink.trace({ id: traceId, output: { status: end.status, costUsd: end.costUsd } }));
    },
    flush: async () => {
      try {
        await sink.flushAsync();
      } catch (cause) {
        console.warn(`[langfuse] flush failed: ${cause instanceof Error ? cause.message : String(cause)}`);
      }
    },
  });
}
