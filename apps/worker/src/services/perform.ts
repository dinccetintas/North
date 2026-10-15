import { isHttpUrl, type ActionSpec } from "@north/core";
import { getBudget, getCampaign, raiseDailyCap, raiseTotalCap, siteUrls } from "@north/db";
import { RepoFileSchema, type ProviderAuth } from "@north/integrations";
import { z } from "zod";
import type { WorkerDeps } from "../deps";
import { activationRefusal, BudgetCapReachedError } from "./budget-check";
import { todayIsoDate } from "./dates";
import { providerAuthFor } from "./provider-auth";

export interface PerformResult {
  readonly externalRef: string;
  readonly sandbox: boolean;
  /** Provider facts later steps need (the repository's `fullName`, the campaign's landing URL), kept out of the reference itself. */
  readonly meta?: Readonly<Record<string, string>>;
}

type Payload = Record<string, unknown>;
const str = (payload: Payload, key: string, fallback = ""): string => (typeof payload[key] === "string" ? (payload[key] as string) : fallback);
const FilesSchema = z.array(RepoFileSchema).min(1);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The landing page the ad points at: the payload's URL, else the company's live site, else its latest preview (ADR 0010: the worker fills it in). */
async function landingUrlFor(deps: WorkerDeps, companyId: string, payload: Payload): Promise<string | undefined> {
  const given = str(payload, "landingUrl");
  if (isHttpUrl(given)) return given;
  const site = await siteUrls(deps.db, companyId);
  return site.live ?? site.preview ?? undefined;
}

/** `ads.start`: the daily budget never exceeds the gated amount (M2 review H2) and today's cap is checked again right before the provider is called (BUD-1). */
async function startCampaign(deps: WorkerDeps, action: ActionSpec, payload: Payload): Promise<PerformResult> {
  const requested = typeof payload.dailyBudgetUsd === "number" ? payload.dailyBudgetUsd : (action.amountUsd ?? 0);
  const dailyBudgetUsd = Math.min(requested, action.amountUsd ?? requested);
  const refusal = activationRefusal(await getBudget(deps.db, action.companyId, action.category ?? "ads"), dailyBudgetUsd);
  if (refusal) throw new BudgetCapReachedError(refusal);
  const auth = await providerAuthFor(deps, action.companyId, action.kind);
  const landingUrl = await landingUrlFor(deps, action.companyId, payload);
  const targeting = payload.targeting;
  const started = await deps.integrations.ads(auth).startCampaign({
    companyId: action.companyId,
    name: str(payload, "name", action.description),
    dailyBudgetUsd,
    audience: str(payload, "audience"),
    creativeMarkdown: str(payload, "creativeMarkdown"),
    ...(targeting && typeof targeting === "object" ? { targeting: targeting as { countries: string[]; ageMin: number; ageMax: number } } : {}),
    ...(landingUrl ? { landingUrl } : {}),
    ...(str(payload, "pageId") ? { pageId: str(payload, "pageId") } : {}),
  });
  return { externalRef: started.campaignId, sandbox: started.sandbox, meta: { landingUrl: landingUrl ?? "" } };
}

interface CampaignTarget {
  readonly providerCampaignId: string;
  readonly dailyBudgetUsd: number | null;
}

/** A payload names campaigns by their `campaigns` row id (worker-made actions) or by the provider id (agent-made actions). */
async function campaignTargets(deps: WorkerDeps, payload: Payload): Promise<readonly CampaignTarget[]> {
  const ids = Array.isArray(payload.campaignIds) ? payload.campaignIds.filter((id): id is string => typeof id === "string") : [str(payload, "campaignId")];
  const targets: CampaignTarget[] = [];
  for (const id of ids) {
    if (!id) continue;
    if (!UUID.test(id)) {
      targets.push({ providerCampaignId: id, dailyBudgetUsd: null });
      continue;
    }
    const campaign = await getCampaign(deps.db, id);
    if (!campaign) throw new Error(`campaign ${id} not found`);
    targets.push({ providerCampaignId: campaign.providerCampaignId, dailyBudgetUsd: campaign.dailyBudgetUsd });
  }
  if (targets.length === 0) throw new Error("no campaign id in the payload");
  return targets;
}

/** `ads.pause` / `ads.resume` for one or many campaigns; a resume is checked against the caps first, like a start. */
async function toggleCampaigns(deps: WorkerDeps, action: ActionSpec, payload: Payload): Promise<PerformResult> {
  const targets = await campaignTargets(deps, payload);
  const resume = action.kind === "ads.resume";
  if (resume) {
    const budget = await getBudget(deps.db, action.companyId, "ads");
    for (const t of targets) {
      const refusal = t.dailyBudgetUsd === null ? null : activationRefusal(budget, t.dailyBudgetUsd);
      if (refusal) throw new BudgetCapReachedError(refusal);
    }
  }
  const auth = await providerAuthFor(deps, action.companyId, action.kind);
  const ads = deps.integrations.ads(auth);
  for (const t of targets) {
    if (resume) await ads.resumeCampaign(action.companyId, t.providerCampaignId);
    else await ads.pauseCampaign(action.companyId, t.providerCampaignId);
  }
  return { externalRef: `${resume ? "resumed" : "paused"}:${targets.map((t) => t.providerCampaignId).join(",")}`, sandbox: deps.integrations.mode === "sandbox" };
}

/** Every email leaves through the user's own mailbox (ADR 0010); the platform mail provider only carries decision notifications. */
async function sendMail(deps: WorkerDeps, action: ActionSpec, payload: Payload): Promise<PerformResult> {
  const auth = await providerAuthFor(deps, action.companyId, action.kind);
  const sent = await deps.integrations.outreach(auth).send({
    companyId: action.companyId,
    to: str(payload, "to"),
    subject: str(payload, "subject", action.description),
    text: str(payload, "text"),
    kind: action.kind === "email.send.first_contact" ? "first_contact" : "reply",
  });
  return { externalRef: sent.messageId, sandbox: sent.sandbox };
}

/** BUD-3: the approved raise lands on North's own budget row; today's cap for a daily cap, the total limit for a total cap. */
async function raiseCap(deps: WorkerDeps, action: ActionSpec, payload: Payload): Promise<PerformResult> {
  const category = action.category ?? "ads";
  const amountUsd = action.amountUsd ?? 0;
  const day = str(payload, "day", todayIsoDate());
  if (payload.cap === "total") await raiseTotalCap(deps.db, { companyId: action.companyId, category, amountUsd });
  else await raiseDailyCap(deps.db, { companyId: action.companyId, category, amountUsd, day });
  return { externalRef: `cap:${category}:${day}:+${amountUsd}`, sandbox: deps.integrations.mode === "sandbox" };
}

async function codeAndDeploy(deps: WorkerDeps, action: ActionSpec, payload: Payload, auth: ProviderAuth | null): Promise<PerformResult> {
  const { integrations } = deps;
  switch (action.kind) {
    case "repo.create": {
      const repo = await integrations.code(auth).ensureRepo({ companyId: action.companyId, name: str(payload, "name") });
      return { externalRef: repo.url, sandbox: repo.sandbox, meta: { fullName: repo.fullName } };
    }
    case "repo.push": {
      const pushed = await integrations.code(auth).pushTree({ companyId: action.companyId, fullName: str(payload, "fullName"), message: str(payload, "message", action.description), files: FilesSchema.parse(payload.files) });
      return { externalRef: pushed.url, sandbox: pushed.sandbox };
    }
    default: {
      const deployment = await integrations.deploy(auth).create({ companyId: action.companyId, name: str(payload, "name"), target: action.kind === "deploy.production" ? "production" : "preview", files: FilesSchema.parse(payload.files) });
      return { externalRef: deployment.url, sandbox: deployment.sandbox };
    }
  }
}

/**
 * Executes an action through the integrations adapters, each on the user's
 * own connection (`providerAuthFor`). Throws for provider failures and for a
 * cap reached since the card was approved; the caller records either.
 */
export async function performAction(deps: WorkerDeps, action: ActionSpec): Promise<PerformResult> {
  const payload = (action.payload ?? {}) as Payload;
  switch (action.kind) {
    case "ads.start":
      return startCampaign(deps, action, payload);
    case "ads.pause":
    case "ads.resume":
      return toggleCampaigns(deps, action, payload);
    case "email.send.first_contact":
    case "email.send.reply":
    case "support.reply.template":
    case "support.reply.custom":
      return sendMail(deps, action, payload);
    case "budget.cap.raise":
      return raiseCap(deps, action, payload);
    case "repo.create":
    case "repo.push":
    case "deploy.preview":
    case "deploy.production":
      return codeAndDeploy(deps, action, payload, await providerAuthFor(deps, action.companyId, action.kind));
    default:
      throw new Error(`No adapter for action kind ${action.kind}`);
  }
}
