import { ActionSpecSchema, AgentOutputSchema, PlanOutputSchema, outputJsonSchema, type ActionSpec, type AgentOutput, type OutputFile } from "@north/core";
import { workspaceFiles } from "@north/agents";
import { writeTree } from "@north/integrations";
import { retryInstructions } from "./escalate";
import {
  createArtifact,
  getKillSwitch,
  getTask,
  headActionsForTask,
  importLeads,
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
import { companyContext } from "./company-context";
import { deferredActionsFor } from "./actions";

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
}

const noActions = (status: ExecuteTaskResult["status"], taskId: string, extra: Partial<ExecuteTaskResult> = {}): ExecuteTaskResult =>
  Object.freeze({ status, taskId, artifactIds: [], costUsd: 0, summary: "", pendingActions: [], files: [], attempt: 0, ...extra });

/** Mock runs return files in the output; SDK runs leave them in the workspace. Either way the pipeline gets one list. */
async function collectFiles(task: TaskRecord, workspaceDir: string, output: AgentOutput | null): Promise<readonly OutputFile[]> {
  if (task.taskType !== "build_site") return [];
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
 * While the kill switch is active nothing runs and the task stays queued.
 */
export async function executeTask(deps: WorkerDeps, taskId: string): Promise<ExecuteTaskResult> {
  const { db, runtime } = deps;
  const task = await getTask(db, taskId);
  if (!task) throw new Error(`task ${taskId} not found`);
  if (task.status === "done") return noActions("ran", taskId, { costUsd: task.costUsd, artifactIds: task.result.artifactIds });
  if (await getKillSwitch(db, task.companyId)) return noActions("blocked", taskId, { error: "kill switch active" });
  if (task.status === "waiting_decision") return resumeParkedTask(deps, task);
  if (task.status === "running") return noActions("blocked", taskId, { error: "already running" });

  const running = await markTaskRunning(db, taskId);
  const context = await companyContext(db, task.companyId, task.taskType);
  const workspaceDir = `${deps.env.WORKSPACE_ROOT}/${task.id}`;
  const retryNote = running.attempts > 1 ? `${retryInstructions(running.attempts, task.lastError)}\n\n` : "";
  const result = await runtime.run({
    companyId: task.companyId,
    taskId: task.id,
    role: task.role,
    taskType: task.taskType,
    instructions: `${retryNote}${context.header}\n\nTask: ${task.title}\n${task.input}`.trim(),
    memoryDigest: context.digest,
    workspaceDir,
    outputSchema: outputJsonSchema(task.taskType),
    vars: context.vars,
  });

  await recordRun(db, running, result);
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
  const pipelineStarted = task.taskType === "build_site" && heads.some((a) => PIPELINE_KINDS.has(a.kind));
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

async function recordRun(db: DbClient, task: TaskRecord, result: AgentRunResult): Promise<void> {
  await recordAgentRun(db, {
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
  });
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
