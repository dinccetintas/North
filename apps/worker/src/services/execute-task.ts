import { randomUUID } from "node:crypto";
import { ActionSpecSchema, AgentOutputSchema, OutputFilesSchema, PlanOutputSchema, outputJsonSchema, type ActionSpec, type AgentOutput, type DispatchBlockReason, type OutputFile } from "@north/core";
import { sandboxMinutesOf, workspaceFiles } from "@north/agents";
import { writeTree } from "@north/integrations";
import { retryInstructions } from "./escalate";
import {
  createArtifact,
  getTask,
  headActionsForTask,
  importLeads,
  listActionsByKind,
  listPendingCardsForTask,
  markTaskFailed,
  markTaskRunning,
  recordAgentRun,
  saveTaskResult,
  writeMemoryItems,
  type DbClient,
  type LeadInput,
  type TaskRecord,
} from "@north/db";
import type { AgentRunResult } from "@north/agents";
import type { WorkerDeps } from "../deps";
import { clipText } from "./clip";
import { companyContext } from "./company-context";
import { deferredActionsFor } from "./actions";
import { chargeRun, releaseRun, reserveRun, type RunReservation } from "./credits";
import { dispatchAllowed } from "./entitlements";

export interface ExecuteTaskResult {
  readonly status: "ran" | "failed" | "blocked";
  readonly taskId: string;
  readonly artifactIds: readonly string[];
  readonly costUsd: number;
  readonly summary: string;
  /** Actions the agent requested; the Inngest function gates and settles them one by one. */
  readonly pendingActions: readonly ActionSpec[];
  /** Files the run left in the workspace (engineering); the build pipeline pushes and deploys them. */
  readonly files: readonly OutputFile[];
  /** Attempt number this run was (1 or 2, AGT-3). */
  readonly attempt: number;
  readonly error?: string;
  /** BIL-1 / BIL-2: why dispatch refused (`blocked`); the task stays queued. */
  readonly reason?: DispatchBlockReason;
}

const noActions = (status: ExecuteTaskResult["status"], taskId: string, extra: Partial<ExecuteTaskResult> = {}): ExecuteTaskResult =>
  Object.freeze({ status, taskId, artifactIds: [], costUsd: 0, summary: "", pendingActions: [], files: [], attempt: 0, ...extra });

/** The most characters of instructions a run is given (the task input is untrusted and unbounded; the memory digest has its own cap). */
export const INSTRUCTIONS_MAX_CHARS = 8000;
/** Ends instructions that were cut, in the style of the digest's `…[memory digest truncated]`. */
export const INSTRUCTIONS_TRUNCATION_MARKER = "\n…[instructions truncated]";

const warnOnStderr = (message: string): void => console.warn(`[execute-task] ${message}`);

/**
 * A run's instructions, `head` (retry note, company-context header and the
 * `Task: <title>` line) then the task's `input`, at most
 * `INSTRUCTIONS_MAX_CHARS` long. The input is cut first (ending in the marker)
 * so the header and the Task line always survive; only a head that alone
 * leaves no room is cut itself, the input dropped, and `warn` told once (with
 * sizes, never the text). Cuts never split a surrogate pair.
 */
export function capInstructions(head: string, input: string, warn: (message: string) => void = warnOnStderr): string {
  const whole = `${head}\n${input}`.trim();
  if (whole.length <= INSTRUCTIONS_MAX_CHARS) return whole;
  const lead = head.trim();
  const room = INSTRUCTIONS_MAX_CHARS - lead.length - 1;
  if (room > INSTRUCTIONS_TRUNCATION_MARKER.length) return `${lead}\n${clipText(input.trim(), room, INSTRUCTIONS_TRUNCATION_MARKER)}`;
  warn(`the instructions header alone is ${lead.length} characters, over the ${INSTRUCTIONS_MAX_CHARS} cap: it was cut and the task input left out`);
  return clipText(lead, INSTRUCTIONS_MAX_CHARS, INSTRUCTIONS_TRUNCATION_MARKER);
}

/** Task types whose run ends in the build pipeline (push, preview, go-live card). */
const PIPELINE_TASKS: ReadonlySet<string> = new Set(["build_site", "fix_error"]);

/** The site as last pushed (PRO-2): the files of the newest executed or notified `repo.push` of the company, or none. */
async function latestPushedFiles(db: DbClient, companyId: string): Promise<readonly OutputFile[]> {
  const pushes = await listActionsByKind(db, companyId, "repo.push", 365);
  const head = pushes.find((a) => a.status === "executed" || a.status === "notified");
  const files = OutputFilesSchema.safeParse(head?.payload.files);
  return files.success ? files.data : [];
}

/** A fix edits the real site: before the run the workspace is seeded from the latest push when it is empty (the SDK runtime edits files in place). */
async function seedWorkspace(deps: WorkerDeps, task: TaskRecord, workspaceDir: string): Promise<void> {
  if (task.taskType !== "fix_error") return;
  if ((await workspaceFiles(workspaceDir)).length > 0) return;
  const files = await latestPushedFiles(deps.db, task.companyId);
  if (files.length > 0) await writeTree(workspaceDir, files);
}

/** Mock runs return files in the output; SDK runs leave them in the workspace. Either way the pipeline gets one list. */
async function collectFiles(task: TaskRecord, workspaceDir: string, output: AgentOutput | null): Promise<readonly OutputFile[]> {
  if (!PIPELINE_TASKS.has(task.taskType)) return [];
  if (output?.files && output.files.length > 0) {
    await writeTree(workspaceDir, output.files);
    return output.files;
  }
  return workspaceFiles(workspaceDir);
}

/**
 * Runs one task through the agent runtime and persists what it produced
 * (artifacts, memory, the agent run). Requested actions are returned, not
 * executed: the durable function gates each one (ADR 0001). A task that is
 * waiting on deferred decisions is not re-run; its stored actions are returned.
 * Dispatch asks first (ADR 0014): under the kill switch, an ended
 * subscription or an empty credit balance nothing runs, the outcome is
 * `blocked` with the reason and the task stays queued. The run's credit is
 * reserved before the task starts (M6 review L9: concurrent dispatches at a
 * low balance cannot start more runs than it covers; a refusal is `blocked`
 * with `credits_exhausted`), the run is traced (OBS-1) and recorded under the
 * reserved id with its usage (BIL-2); a run that never started is released.
 */
export async function executeTask(deps: WorkerDeps, taskId: string): Promise<ExecuteTaskResult> {
  const { db } = deps;
  const task = await getTask(db, taskId);
  if (!task) throw new Error(`task ${taskId} not found`);
  if (task.status === "done") return noActions("ran", taskId, { costUsd: task.costUsd, artifactIds: task.result.artifactIds });
  const allowed = await dispatchAllowed(deps, task.companyId);
  if (!allowed.ok) return noActions("blocked", taskId, { error: allowed.reason === "kill_switch" ? "kill switch active" : `dispatch blocked: ${allowed.reason}`, reason: allowed.reason });
  if (task.status === "waiting_decision") return resumeParkedTask(deps, task);
  if (task.status === "running") return noActions("blocked", taskId, { error: "already running" });

  const agentRunId = randomUUID();
  const reservation = await reserveRun(deps, task.companyId, agentRunId);
  if (!reservation.ok) return noActions("blocked", taskId, { error: "dispatch blocked: credits_exhausted", reason: "credits_exhausted" });
  const charge: RunCharge = { agentRunId, reservation };
  const running = await releasedOnThrow(deps, charge, () => markTaskRunning(db, taskId));
  const workspaceDir = `${deps.env.WORKSPACE_ROOT}/${task.id}`;
  const result = await runAgent(deps, task, running, workspaceDir, charge);
  if (result.status !== "succeeded") {
    const error = result.status === "failed" ? result.error : "the runtime cannot pause mid-run before M3";
    await markTaskFailed(db, taskId, error);
    return noActions("failed", taskId, { costUsd: result.usage.costUsd, error, attempt: running.attempts });
  }

  const persisted = await persistOutput(db, running, result.output);
  await saveTaskResult(db, taskId, { artifactIds: [...persisted.artifactIds], costUsd: result.usage.costUsd, summary: persisted.summary });
  const pendingActions = result.actions.map((a) => ActionSpecSchema.parse({ ...a, companyId: task.companyId, agentRole: task.role }));
  const files = await collectFiles(task, workspaceDir, persisted.output);
  return Object.freeze({
    status: "ran",
    taskId,
    artifactIds: persisted.artifactIds,
    costUsd: result.usage.costUsd,
    summary: persisted.summary,
    pendingActions,
    files,
    attempt: running.attempts,
  });
}

/** The run's id and its credit, reserved at dispatch (L9). */
interface RunCharge {
  readonly agentRunId: string;
  readonly reservation: RunReservation;
}

/** A reserved run that throws before it is recorded never ran: its credit is released, the error stays the step's. */
async function releasedOnThrow<T>(deps: WorkerDeps, charge: RunCharge, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (cause) {
    await releaseRun(deps, charge.agentRunId, charge.reservation);
    throw cause;
  }
}

/** One traced agent run for the running task (OBS-1), recorded under its reserved id with its usage before it returns (BIL-2); released when it throws before that. */
async function runAgent(deps: WorkerDeps, task: TaskRecord, running: TaskRecord, workspaceDir: string, charge: RunCharge): Promise<AgentRunResult> {
  const { result, traceId } = await releasedOnThrow(deps, charge, async () => {
    const context = await companyContext(deps.db, task.companyId, task.taskType);
    await seedWorkspace(deps, task, workspaceDir);
    const retryNote = running.attempts > 1 ? `${retryInstructions(running.attempts, task.lastError)}\n\n` : "";
    const instructions = capInstructions(`${retryNote}${context.header}\n\nTask: ${task.title}`, task.input, (message) => warnOnStderr(`${task.id}: ${message}`));
    const started = deps.tracer.startRun({ companyId: task.companyId, taskId: task.id, role: task.role, taskType: task.taskType, instructions });
    const ran = await deps.runtime.run({
      companyId: task.companyId,
      taskId: task.id,
      role: task.role,
      taskType: task.taskType,
      instructions,
      memoryDigest: context.digest,
      workspaceDir,
      outputSchema: outputJsonSchema(task.taskType),
      vars: context.vars,
      ...(started ? { traceId: started } : {}),
    });
    return { result: ran, traceId: started };
  });
  deps.tracer.endRun(traceId, { model: result.usage.model, costUsd: result.usage.costUsd, inputTokens: result.usage.inputTokens, outputTokens: result.usage.outputTokens, status: result.status });
  await recordRun(deps, running, result, result.traceId ?? traceId, charge);
  return result;
}

const PIPELINE_KINDS: ReadonlySet<string> = new Set(["repo.create", "repo.push", "deploy.preview"]);

/**
 * A parked task comes back for one of three reasons: quota-deferred actions
 * to re-gate (DEC-3), an open card (nothing to do; a duplicate dispatch must
 * not finish or fail it), or a connect card answered "connected" (ONB-3). The
 * build pipeline resumes from the files still in the workspace, and only when
 * the worker's own action log shows the pipeline had started (an owner can
 * edit a task row, never the actions). A lost workspace fails the attempt so
 * AGT-3 rebuilds instead of leaving the task parked forever.
 */
async function resumeParkedTask(deps: WorkerDeps, task: TaskRecord): Promise<ExecuteTaskResult> {
  const { db } = deps;
  const carried = { costUsd: task.result.costUsd, artifactIds: task.result.artifactIds, summary: task.result.summary, attempt: task.attempts };
  const deferred = await deferredActionsFor(db, task);
  const openCards = await listPendingCardsForTask(db, task.id);
  if (openCards.length > 0) return noActions("blocked", task.id, { error: "waiting on an open decision card" });
  const heads = await headActionsForTask(db, task.id);
  const pipelineStarted = PIPELINE_TASKS.has(task.taskType) && heads.some((a) => PIPELINE_KINDS.has(a.kind));
  if (!pipelineStarted) {
    if (deferred.length > 0) return noActions("ran", task.id, { ...carried, pendingActions: deferred });
    return noActions("blocked", task.id, { error: "nothing to resume" });
  }
  const files = await workspaceFiles(`${deps.env.WORKSPACE_ROOT}/${task.id}`);
  if (files.length === 0) {
    const error = "workspace lost: the built files are gone, a new attempt rebuilds them";
    await markTaskFailed(db, task.id, error);
    return noActions("failed", task.id, { ...carried, error });
  }
  await markTaskRunning(db, task.id);
  return noActions("ran", task.id, { ...carried, files });
}

/** The `agent_runs` row (with its trace) under the reserved id and, in the same call, its usage (BIL-2). */
async function recordRun(deps: WorkerDeps, task: TaskRecord, result: AgentRunResult, traceId: string | null, charge: RunCharge): Promise<void> {
  const agentRunId = await recordAgentRun(deps.db, {
    id: charge.agentRunId,
    companyId: task.companyId,
    taskId: task.id,
    role: task.role,
    model: result.usage.model,
    runtime: result.sessionId?.startsWith("mock") ? "mock" : "claude-agent-sdk",
    sessionId: result.sessionId,
    inputTokens: result.usage.inputTokens,
    outputTokens: result.usage.outputTokens,
    costUsd: result.usage.costUsd,
    durationMs: result.usage.durationMs,
    status: result.status,
    ...(result.status === "failed" ? { error: result.error } : {}),
    traceId,
  });
  await chargeRun(deps, task.companyId, agentRunId, { usage: result.usage, sandboxMinutes: sandboxMinutesOf(result) }, charge.reservation);
}

interface Persisted {
  readonly summary: string;
  readonly artifactIds: readonly string[];
  readonly output: AgentOutput | null;
}

/** Validates the structured output and writes artifacts and memory; the plan itself is persisted by plan-week. */
async function persistOutput(db: DbClient, task: TaskRecord, raw: unknown): Promise<Persisted> {
  if (task.taskType === "plan_week") {
    const plan = PlanOutputSchema.parse(raw);
    return { summary: plan.summary, artifactIds: [], output: null };
  }
  const output: AgentOutput = AgentOutputSchema.parse(raw);
  const artifactIds: string[] = [];
  for (const draft of output.artifacts) {
    const artifact = await createArtifact(db, { companyId: task.companyId, kind: draft.kind, title: draft.title, markdown: draft.markdown, createdByRole: task.role });
    artifactIds.push(artifact.id);
  }
  if (output.memory.length > 0) await writeMemoryItems(db, task.companyId, output.memory, task.role);
  if (output.leads && output.leads.length > 0) await persistLeads(db, task, output.leads);
  return { summary: output.summary, artifactIds, output };
}

/** `lead_research` output (sales): prospects land in `leads` as `research` rows; an email already known is skipped, never overwritten. Nothing is contacted here. */
async function persistLeads(db: DbClient, task: TaskRecord, leads: NonNullable<AgentOutput["leads"]>): Promise<void> {
  const rows: LeadInput[] = leads.map((l) => ({ name: l.name, email: l.email, company: l.company, why: l.why }));
  const result = await importLeads(db, task.companyId, rows, "research");
  console.log(`[execute-task] ${task.id}: ${result.imported} lead(s) imported, ${result.skipped} skipped`);
}
