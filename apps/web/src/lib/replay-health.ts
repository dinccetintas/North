/**
 * TST-2: proof that a replay run replayed. `pnpm e2e:replay` only marks the
 * Playwright process (`NORTH_CASSETTE_MODE=replay`); the worker is a separate
 * process that must have been started with the replay variables, and a mock
 * worker passes every spec. `e2e/global-setup.ts` therefore reads the worker's
 * `/health` and fails the run unless it reports the SDK runtime and a
 * replaying gateway. The reading is here, pure, so it is tested alone.
 */
import { z } from "zod";

/** The command that starts the whole stack with a replaying worker (no model key needed). */
export const START_REPLAY_STACK = "NORTH_CASSETTE_MODE=replay AGENT_RUNTIME=claude-agent-sdk NORTH_ENV=staging NORTH_MODEL_PROFILE=smoke pnpm dev";

const HealthSchema = z.object({ app: z.literal("north-worker"), runtime: z.string(), gateway: z.string() });

const isWorkerLine = (body: unknown): boolean => body !== null && typeof body === "object" && !Array.isArray(body) && (body as Record<string, unknown>).app === "north-worker";

/**
 * Why the worker whose `/health` body this is does not replay cassettes, or
 * null when it does (`runtime` `claude-agent-sdk` and `gateway` `replay`).
 * Every problem is named with what it found, and the fix is the command that
 * starts the stack.
 */
export function replayHealthProblem(body: unknown): string | null {
  if (!isWorkerLine(body)) return "the body is not the worker's health line (no app \"north-worker\"): is E2E_WORKER_URL the worker?";
  const parsed = HealthSchema.safeParse(body);
  if (!parsed.success) return "the worker's health line has no runtime or gateway: the worker is older than this check, run it from this commit";
  const { runtime, gateway } = parsed.data;
  const problems = [...(runtime === "claude-agent-sdk" ? [] : [`its runtime is "${runtime}", not claude-agent-sdk`]), ...(gateway === "replay" ? [] : [`its gateway is "${gateway}", not replay`])];
  return problems.length === 0 ? null : `the worker is not replaying cassettes (${problems.join("; ")}): start the stack with ${START_REPLAY_STACK}`;
}

/** How long to wait for a worker that is still starting. */
export interface WaitOptions {
  readonly attempts?: number;
  readonly delayMs?: number;
  /** Where the health line is read from, for the message. */
  readonly label?: string;
  readonly sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Reads the worker's health line (`read` returns the parsed body) until it
 * answers, then throws {@link replayHealthProblem}'s message unless the worker
 * replays. A worker that answers with the wrong setup fails at once (waiting
 * does not change its start-up variables); one that does not answer is retried
 * `attempts` times, `delayMs` apart, then fails naming the last error.
 */
export async function assertWorkerReplays(read: () => Promise<unknown>, options: WaitOptions = {}): Promise<void> {
  const { attempts = 10, delayMs = 2000, label = "the worker's /health", sleep = defaultSleep } = options;
  let last = "no answer";
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    let body: unknown;
    try {
      body = await read();
    } catch (error) {
      last = error instanceof Error ? error.message : String(error);
      if (attempt < attempts) await sleep(delayMs);
      continue;
    }
    const problem = replayHealthProblem(body);
    if (problem === null) return;
    throw new Error(problem);
  }
  throw new Error(`the worker does not answer at ${label} (${last}, ${attempts} tries): start the stack with ${START_REPLAY_STACK}`);
}
