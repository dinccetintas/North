import {
  AgentOutputSchema,
  PlanOutputSchema,
  gate,
  outputJsonSchema,
  type ActionSpec,
  type AgentOutput,
  type GateDecision,
} from "@north/core";
import {
  createArtifact,
  getKillSwitch,
  getTask,
  latestMetric,
  listBudgets,
  markTaskDone,
  markTaskFailed,
  markTaskRunning,
  recordAction,
  recordAgentRun,
  recordLedgerEntry,
  recordMetric,
  writeMemoryItems,
  type DbClient,
  type TaskRecord,
} from "@north/db";
import type { AgentRunResult } from "@north/agents";
import type { WorkerDeps } from "../deps";
import { companyContext } from "./company-context";

export interface ExecuteTaskResult {
  readonly status: "done" | "failed" | "blocked";
  readonly taskId: string;
  readonly artifactIds: readonly string[];
  readonly costUsd: number;
  readonly error?: string;
}

/**
 * Runs one task through the agent runtime and persists everything it produced.
 * K0 actions are recorded as executed; anything above K0 is recorded as blocked in
 * M1 (the decision layer lands in M2). "Done" requires an artifact as evidence.
 * While the kill switch is active the task stays queued and nothing runs.
 */
export async function executeTask(deps: WorkerDeps, taskId: string): Promise<ExecuteTaskResult> {
  const { db, runtime } = deps;
  const task = await getTask(db, taskId);
  if (!task) throw new Error(`task ${taskId} not found`);
  if (task.status === "done") return { status: "done", taskId, artifactIds: [], costUsd: task.costUsd };
  if (await getKillSwitch(db, task.companyId)) {
    return { status: "blocked", taskId, artifactIds: [], costUsd: 0, error: "kill switch active" };
  }

  const running = await markTaskRunning(db, taskId);
  const context = await companyContext(db, task.companyId);
  const result = await runtime.run({
    companyId: task.companyId,
    taskId: task.id,
    role: task.role,
    taskType: task.taskType,
    instructions: `${context.header}\n\nTask: ${task.title}\n${task.input}`.trim(),
    memoryDigest: context.digest,
    workspaceDir: `${deps.env.WORKSPACE_ROOT}/${task.id}`,
    outputSchema: outputJsonSchema(task.taskType),
    vars: context.vars,
  });

  await recordRun(db, running, result);
  if (result.status !== "succeeded") {
    const error = result.status === "failed" ? result.error : "waiting_decision is not supported before M2";
    await markTaskFailed(db, taskId, error);
    return { status: "failed", taskId, artifactIds: [], costUsd: result.usage.costUsd, error };
  }

  const persisted = await persistOutput(db, running, result.output);
  await gateActions(db, running, result.actions);

  if (persisted.artifactIds.length === 0 && task.taskType !== "plan_week") {
    const error = "agent produced no artifact, so there is no evidence of completion (AGT-2)";
    await markTaskFailed(db, taskId, error);
    return { status: "failed", taskId, artifactIds: [], costUsd: result.usage.costUsd, error };
  }

  const evidenceRef = persisted.artifactIds[0] ?? `plan:${task.id}`;
  await markTaskDone(db, taskId, {
    evidence: { kind: "artifact_id", ref: evidenceRef, verified: true, sandbox: runtime.name === "mock" },
    costUsd: result.usage.costUsd,
    outputSummary: persisted.summary,
  });
  await recordOutcome(db, running, persisted.artifactIds.length, result.usage.costUsd);
  return { status: "done", taskId, artifactIds: persisted.artifactIds, costUsd: result.usage.costUsd };
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
}

/** Validates the structured output and writes artifacts and memory; the plan itself is persisted by plan-week. */
async function persistOutput(db: DbClient, task: TaskRecord, raw: unknown): Promise<Persisted> {
  if (task.taskType === "plan_week") {
    const plan = PlanOutputSchema.parse(raw);
    return { summary: plan.summary, artifactIds: [] };
  }
  const output: AgentOutput = AgentOutputSchema.parse(raw);
  const artifactIds: string[] = [];
  for (const draft of output.artifacts) {
    const artifact = await createArtifact(db, { companyId: task.companyId, kind: draft.kind, title: draft.title, markdown: draft.markdown, createdByRole: task.role });
    artifactIds.push(artifact.id);
  }
  if (output.memory.length > 0) await writeMemoryItems(db, task.companyId, output.memory, task.role);
  return { summary: output.summary, artifactIds };
}

/** Every requested action passes the authority gate; M1 executes nothing external. */
async function gateActions(db: DbClient, task: TaskRecord, actions: readonly ActionSpec[]): Promise<void> {
  if (actions.length === 0) return;
  const [budgets, killSwitchActive] = await Promise.all([listBudgets(db, task.companyId), getKillSwitch(db, task.companyId)]);
  const dueAt = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
  for (const action of actions) {
    const decision: GateDecision = gate({ ...action, companyId: task.companyId }, { killSwitchActive, budgets, autoRules: [], cardDueAt: dueAt });
    await recordAction(db, {
      companyId: task.companyId,
      taskId: task.id,
      agentRole: task.role,
      kind: action.kind,
      tier: decision.tier,
      description: action.description,
      payload: { ...(action.payload ?? {}), gate: decision.kind, reasons: [...decision.reasons] },
      status: decision.kind === "run" && decision.tier === "K0" ? "executed" : "blocked",
      sandbox: true,
    });
  }
}

/** OUT-1 for K0 work: the `artifacts` metric moves by the number produced. */
async function recordOutcome(db: DbClient, task: TaskRecord, produced: number, costUsd: number): Promise<void> {
  const before = (await latestMetric(db, task.companyId, "artifacts"))?.value ?? 0;
  const after = before + produced;
  await recordMetric(db, { companyId: task.companyId, metricKey: "artifacts", value: after, source: "worker" });
  await recordLedgerEntry(db, {
    companyId: task.companyId,
    taskId: task.id,
    metricKey: task.metricKey ?? "artifacts",
    before,
    after,
    costUsd,
    channel: task.role,
    note: `${task.taskType}: ${produced} artifact(s)`,
  });
}
