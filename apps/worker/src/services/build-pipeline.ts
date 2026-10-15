import type { ActionSpec, ConnectionProvider, OutputFile } from "@north/core";
import { getTask } from "@north/db";
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
  readonly cardId: string | null;
  readonly error: string | null;
}

const siteSlug = (name: string): string =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "site";

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

/**
 * The engineering pipeline after a `build_site` run (docs/plans/M3.md): repo
 * (K1) → push (K1) → preview (K1, verified with a real GET) → go-live card
 * (K2). Every external step goes through `gateAction`, so the authority
 * engine, the kill switch and the audit log see each one. The task finishes
 * through settlement once the card is answered (or with the preview as
 * evidence when the CEO declines).
 */
export async function runBuildPipeline(deps: WorkerDeps, step: StepRunner, taskId: string, files: readonly OutputFile[]): Promise<PipelineOutcome> {
  const task = await getTask(deps.db, taskId);
  if (!task) throw new Error(`task ${taskId} not found`);
  const company = await deps.db.from("companies").select("name, slug").eq("id", task.companyId).single();
  const name = siteSlug(`${company.data?.slug ?? company.data?.name ?? "site"}-site`);
  const base = { companyId: task.companyId, agentRole: task.role };
  const fail = (error: string, repoUrl: string | null = null, previewUrl: string | null = null): PipelineOutcome => ({ status: "failed", repoUrl, previewUrl, cardId: null, error });

  /** ONB-3: a missing connection becomes a card (or a quota-deferred step); the task resumes here once the CEO connects the account. */
  const connect = async (id: string, provider: string, spec: ActionSpec): Promise<PipelineOutcome> => {
    const opened = await step.run(`${id}-connect-card`, () => openConnectCard(deps, taskId, provider as ConnectionProvider, spec));
    if ("deferred" in opened) return { status: "connect_deferred", repoUrl: null, previewUrl: null, cardId: null, error: null };
    return { status: "connect_card_opened", repoUrl: null, previewUrl: null, cardId: opened.cardId, error: null };
  };

  const repoSpec: ActionSpec = { ...base, kind: "repo.create", description: `Create the repository ${name} in the CEO's GitHub`, payload: { name } };
  const repo = await externalStep(deps, step, "repo", taskId, repoSpec);
  if (repo.connectionRequired) return connect("repo", repo.connectionRequired, repoSpec);
  if (!repo.externalRef) return fail(repo.error ?? "repository step did not complete");
  const fullName = repo.meta.fullName;
  if (!fullName) return fail("repository step returned no full name", repo.externalRef);

  const pushSpec: ActionSpec = { ...base, kind: "repo.push", description: `Push ${files.length} file(s) to ${fullName}`, payload: { fullName, message: `Landing page v${task.attempts}`, files: [...files] } };
  const push = await externalStep(deps, step, "push", taskId, pushSpec);
  if (push.connectionRequired) return connect("push", push.connectionRequired, pushSpec);
  if (!push.externalRef) return fail(push.error ?? "push did not complete", repo.externalRef);

  const previewSpec: ActionSpec = { ...base, kind: "deploy.preview", description: `Deploy a preview of ${name}`, payload: { name, files: [...files] } };
  const preview = await externalStep(deps, step, "preview", taskId, previewSpec);
  if (preview.connectionRequired) return connect("preview", preview.connectionRequired, previewSpec);
  if (!preview.externalRef) return fail(preview.error ?? "preview deploy did not complete", repo.externalRef);
  const check = await step.run("verify-preview", () => verifyUrl(preview.externalRef as string, deps.verifier));
  if (!check.verified) return fail(`preview ${preview.externalRef} is not reachable (${check.detail})`, repo.externalRef, preview.externalRef);

  const live = await step.run("golive-gate", () =>
    gateAction(deps, taskId, { ...base, kind: "deploy.production", description: `Publish ${name} to production (preview verified at ${preview.externalRef})`, payload: { name, url: preview.externalRef, files: [...files] } }),
  );
  if (live.kind === "card") return { status: "live_card_opened", repoUrl: repo.externalRef, previewUrl: preview.externalRef, cardId: live.cardId, error: null };
  if (live.kind === "execute") {
    const outcome = await step.run("golive-perform", () => performPending(deps, live.actionId));
    await step.run("golive-record", () => completeAction(deps, { actionId: live.actionId, tier: live.tier, outcome }));
  }
  return { status: "preview_only", repoUrl: repo.externalRef, previewUrl: preview.externalRef, cardId: null, error: live.kind === "blocked" ? live.reason : null };
}
