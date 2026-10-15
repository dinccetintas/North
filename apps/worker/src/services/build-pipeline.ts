import { fixBranchName, type ActionSpec, type ConnectionProvider, type OutputFile } from "@north/core";
import { issueFactsFromInput } from "@north/agents";
import { getTask, type TaskRecord } from "@north/db";
import type { WorkerDeps } from "../deps";
import { completeAction, gateAction, performPending, type GatedAction } from "./actions";
import { openConnectCard } from "./connect-card";
import type { StepRunner } from "./steps";
import { verifyUrl } from "./verifier";

export type { StepRunner } from "./steps";

export interface PipelineOutcome {
  readonly status: "live_card_opened" | "preview_only" | "failed" | "connect_card_opened" | "connect_deferred";
  readonly repoUrl: string | null;
  readonly previewUrl: string | null;
  /** The pull request page when the pipeline opened one (PRO-2); null otherwise. */
  readonly prUrl: string | null;
  readonly cardId: string | null;
  readonly error: string | null;
}

/** PRO-2: a fix pushes to its own branch and opens a pull request; a build pushes to `main` and opens none. */
export interface PipelineOptions {
  readonly branch?: string;
  readonly openPr?: boolean;
}

const MAIN = "main";

const siteSlug = (name: string): string =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "site";

/** A `fix_error` task's options come from its issue (`fix/<shortId>`, PR open); anything else pushes to main. The caller's options win. */
export function pipelineOptionsFor(task: Pick<TaskRecord, "taskType" | "input">, given: PipelineOptions): Required<PipelineOptions> {
  if (task.taskType !== "fix_error") return { branch: given.branch ?? MAIN, openPr: given.openPr ?? false };
  const { shortId } = issueFactsFromInput(task.input);
  return { branch: given.branch ?? fixBranchName(shortId), openPr: given.openPr ?? true };
}

/** Runs one gated external step to completion: gate → perform → record, each memoised by the step runner. */
interface StepResult {
  readonly gated: GatedAction;
  readonly externalRef: string | null;
  readonly error: string | null;
  readonly connectionRequired: string | null;
  readonly meta: Readonly<Record<string, string>>;
}

async function externalStep(deps: WorkerDeps, step: StepRunner, id: string, taskId: string, spec: ActionSpec): Promise<StepResult> {
  const gated = await step.run(`${id}-gate`, () => gateAction(deps, taskId, spec));
  if (gated.kind !== "execute") return { gated, externalRef: gated.kind === "executed" ? gated.externalRef : null, error: gated.kind === "blocked" ? gated.reason : null, connectionRequired: null, meta: {} };
  const outcome = await step.run(`${id}-perform`, () => performPending(deps, gated.actionId));
  await step.run(`${id}-record`, () => completeAction(deps, { actionId: gated.actionId, tier: gated.tier, outcome }));
  if (!outcome.ok) return { gated, externalRef: null, error: outcome.error, connectionRequired: outcome.connectionRequired ?? null, meta: {} };
  return { gated, externalRef: outcome.externalRef, error: null, connectionRequired: null, meta: outcome.meta ?? {} };
}

interface Pipeline {
  readonly deps: WorkerDeps;
  readonly step: StepRunner;
  readonly task: TaskRecord;
  readonly name: string;
  readonly files: readonly OutputFile[];
  readonly options: Required<PipelineOptions>;
  readonly base: { readonly companyId: string; readonly agentRole: string };
}

const outcome = (partial: Partial<PipelineOutcome> & Pick<PipelineOutcome, "status">): PipelineOutcome => ({ repoUrl: null, previewUrl: null, prUrl: null, cardId: null, error: null, ...partial });

/** ONB-3: a missing connection becomes a card (or a quota-deferred step); the task resumes here once the CEO connects the account. */
async function connect(p: Pipeline, id: string, provider: string, spec: ActionSpec): Promise<PipelineOutcome> {
  const opened = await p.step.run(`${id}-connect-card`, () => openConnectCard(p.deps, p.task.id, provider as ConnectionProvider, spec));
  if ("deferred" in opened) return outcome({ status: "connect_deferred" });
  return outcome({ status: "connect_card_opened", cardId: opened.cardId });
}

interface Pushed {
  readonly repoUrl: string;
  readonly fullName: string;
  readonly prUrl: string | null;
}

/** repo (K1) → push (K1, on the branch) → pull request (K1, PRO-2) when the options say so. */
async function pushPhase(p: Pipeline): Promise<Pushed | PipelineOutcome> {
  const { branch, openPr } = p.options;
  const repoSpec: ActionSpec = { ...p.base, kind: "repo.create", description: `Create the repository ${p.name} in the CEO's GitHub`, payload: { name: p.name } };
  const repo = await externalStep(p.deps, p.step, "repo", p.task.id, repoSpec);
  if (repo.connectionRequired) return connect(p, "repo", repo.connectionRequired, repoSpec);
  if (!repo.externalRef) return outcome({ status: "failed", error: repo.error ?? "repository step did not complete" });
  const fullName = repo.meta.fullName;
  if (!fullName) return outcome({ status: "failed", repoUrl: repo.externalRef, error: "repository step returned no full name" });

  const message = branch === MAIN ? `Landing page v${p.task.attempts}` : `${p.task.title.slice(0, 120)} (${branch})`;
  const pushSpec: ActionSpec = { ...p.base, kind: "repo.push", description: `Push ${p.files.length} file(s) to ${fullName} (${branch})`, payload: { fullName, branch, message, files: [...p.files] } };
  const push = await externalStep(p.deps, p.step, "push", p.task.id, pushSpec);
  if (push.connectionRequired) return connect(p, "push", push.connectionRequired, pushSpec);
  if (!push.externalRef) return outcome({ status: "failed", repoUrl: repo.externalRef, error: push.error ?? "push did not complete" });
  if (!openPr) return { repoUrl: repo.externalRef, fullName, prUrl: null };

  const prSpec: ActionSpec = { ...p.base, kind: "repo.pull_request", description: `Open a pull request ${branch} → ${MAIN} in ${fullName}`, payload: { fullName, head: branch, base: MAIN, title: p.task.title.slice(0, 200), body: `${p.task.title}\n\nOpened by North's Engineering agent. Review and merge in your repository; going live is a separate decision card.` } };
  const pr = await externalStep(p.deps, p.step, "pr", p.task.id, prSpec);
  if (pr.connectionRequired) return connect(p, "pr", pr.connectionRequired, prSpec);
  if (!pr.externalRef) return outcome({ status: "failed", repoUrl: repo.externalRef, error: pr.error ?? "pull request did not complete" });
  return { repoUrl: repo.externalRef, fullName, prUrl: pr.externalRef };
}

/** preview (K1, verified with a real GET) → go-live card (K2). */
async function deployPhase(p: Pipeline, pushed: Pushed): Promise<PipelineOutcome> {
  const previewSpec: ActionSpec = { ...p.base, kind: "deploy.preview", description: `Deploy a preview of ${p.name}`, payload: { name: p.name, files: [...p.files] } };
  const preview = await externalStep(p.deps, p.step, "preview", p.task.id, previewSpec);
  if (preview.connectionRequired) return connect(p, "preview", preview.connectionRequired, previewSpec);
  if (!preview.externalRef) return outcome({ status: "failed", repoUrl: pushed.repoUrl, prUrl: pushed.prUrl, error: preview.error ?? "preview deploy did not complete" });
  const check = await p.step.run("verify-preview", () => verifyUrl(preview.externalRef as string, p.deps.verifier));
  if (!check.verified) return outcome({ status: "failed", repoUrl: pushed.repoUrl, previewUrl: preview.externalRef, prUrl: pushed.prUrl, error: `preview ${preview.externalRef} is not reachable (${check.detail})` });

  const payload = { name: p.name, url: preview.externalRef, files: [...p.files], ...(pushed.prUrl ? { prUrl: pushed.prUrl, branch: p.options.branch } : {}) };
  const live = await p.step.run("golive-gate", () => gateAction(p.deps, p.task.id, { ...p.base, kind: "deploy.production", description: `Publish ${p.name} to production (preview verified at ${preview.externalRef})`, payload }));
  const common = { repoUrl: pushed.repoUrl, previewUrl: preview.externalRef, prUrl: pushed.prUrl };
  if (live.kind === "card") return outcome({ status: "live_card_opened", ...common, cardId: live.cardId });
  if (live.kind === "execute") {
    const performed = await p.step.run("golive-perform", () => performPending(p.deps, live.actionId));
    await p.step.run("golive-record", () => completeAction(p.deps, { actionId: live.actionId, tier: live.tier, outcome: performed }));
  }
  return outcome({ status: "preview_only", ...common, error: live.kind === "blocked" ? live.reason : null });
}

/**
 * The engineering pipeline after a `build_site` or `fix_error` run
 * (docs/plans/M3.md, M5.md): repo (K1) → push (K1) → [pull request (K1)] →
 * preview (K1, verified with a real GET) → go-live card (K2). Every external
 * step goes through `gateAction`, so the authority engine, the kill switch
 * and the audit log see each one. The task finishes through settlement once
 * the card is answered (or with the preview as evidence when the CEO declines).
 */
export async function runBuildPipeline(deps: WorkerDeps, step: StepRunner, taskId: string, files: readonly OutputFile[], given: PipelineOptions = {}): Promise<PipelineOutcome> {
  const task = await getTask(deps.db, taskId);
  if (!task) throw new Error(`task ${taskId} not found`);
  const company = await deps.db.from("companies").select("name, slug").eq("id", task.companyId).single();
  const name = siteSlug(`${company.data?.slug ?? company.data?.name ?? "site"}-site`);
  const p: Pipeline = { deps, step, task, name, files, options: pipelineOptionsFor(task, given), base: { companyId: task.companyId, agentRole: task.role } };
  const pushed = await pushPhase(p);
  if ("status" in pushed) return pushed;
  return deployPhase(p, pushed);
}
