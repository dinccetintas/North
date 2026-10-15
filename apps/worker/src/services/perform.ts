import { isHttpUrl, type ActionSpec } from "@north/core";
import { getBudget, getLead, raiseDailyCap, raiseTotalCap, siteUrls, type CampaignRecord, type LeadRecord } from "@north/db";
import { parseGmailRef, RepoFileSchema, type InReplyTo, type ProviderAuth } from "@north/integrations";
import { z } from "zod";
import type { WorkerDeps } from "../deps";
import { activationRefusal, BudgetCapReachedError } from "./budget-check";
import { resolveCampaigns } from "./campaign-lookup";
import { todayIsoDate } from "./dates";
import { providerAuthFor } from "./provider-auth";

/** What the action row knows that the spec does not: the card that approved it (null for K1 and auto-rule runs). */
export interface PerformContext {
  readonly decisionCardId: string | null;
}

const NO_CARD: PerformContext = Object.freeze({ decisionCardId: null });

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

/** The worker's own resume reasons: a daily-cap pause ends at the day roll or when the CEO raised today's cap (both approved by a card). */
const WORKER_RESUME_REASONS: ReadonlySet<unknown> = new Set(["day_roll", "cap_raised"]);

/**
 * M4 review H1: without a card only the worker's own resume may run, and only
 * on a row paused for a cap; a paused_kill row comes back through the resume
 * card alone. Returns the refusal, or null.
 */
function resumeRefusal(rows: readonly CampaignRecord[], payload: Payload, ctx: PerformContext): string | null {
  if (ctx.decisionCardId) return null;
  if (!WORKER_RESUME_REASONS.has(payload.reason)) return `resume refused: reason ${JSON.stringify(payload.reason ?? null)} is not the worker's own and no card approved it`;
  const other = rows.find((r) => r.status !== "paused_cap");
  return other ? `resume refused: campaign ${other.id} is ${other.status}, not paused_cap` : null;
}

/** `ads.pause` / `ads.resume` for one or many campaigns of the company; a resume is checked against the caps first, like a start. */
async function toggleCampaigns(deps: WorkerDeps, action: ActionSpec, payload: Payload, ctx: PerformContext): Promise<PerformResult> {
  const rows = await resolveCampaigns(deps, action.companyId, payload);
  const resume = action.kind === "ads.resume";
  if (resume) {
    const refused = resumeRefusal(rows, payload, ctx);
    if (refused) throw new Error(refused);
    const budget = await getBudget(deps.db, action.companyId, "ads");
    for (const row of rows) {
      const refusal = activationRefusal(budget, row.dailyBudgetUsd);
      if (refusal) throw new BudgetCapReachedError(refusal);
    }
  }
  const auth = await providerAuthFor(deps, action.companyId, action.kind);
  const ads = deps.integrations.ads(auth);
  for (const row of rows) {
    if (resume) await ads.resumeCampaign(action.companyId, row.providerCampaignId);
    else await ads.pauseCampaign(action.companyId, row.providerCampaignId);
  }
  return { externalRef: `${resume ? "resumed" : "paused"}:${rows.map((r) => r.providerCampaignId).join(",")}`, sandbox: deps.integrations.mode === "sandbox" };
}

/** The lead a send names (`payload.leadId`), of this company, in the required status, whose email is the recipient (M4 review H2/H3). */
async function leadFor(deps: WorkerDeps, action: ActionSpec, payload: Payload, status: LeadRecord["status"]): Promise<LeadRecord> {
  const leadId = str(payload, "leadId");
  const lead = UUID.test(leadId) ? await getLead(deps.db, action.companyId, leadId) : null;
  if (!lead) throw new Error(`${action.kind} refused: payload.leadId must name a lead of this company`);
  if (lead.status !== status) throw new Error(`${action.kind} refused: lead ${lead.id} is ${lead.status}, not ${status}`);
  if (lead.email !== str(payload, "to").trim().toLowerCase()) throw new Error(`${action.kind} refused: the recipient is not the lead's email`);
  return lead;
}

/** The thread a reply must stay in: the lead's sent message (`gmail:<id>:<thread>` parsed; a sandbox ref is its own thread). */
function threadOf(lead: LeadRecord): InReplyTo {
  if (!lead.messageId) throw new Error(`email.send.reply refused: lead ${lead.id} has no sent message to reply to`);
  const ref = parseGmailRef(lead.messageId);
  return ref ?? { messageId: lead.messageId, threadId: lead.messageId };
}

/**
 * Every email leaves through the user's own mailbox (ADR 0010). A first
 * contact goes to a `new` lead of the company (H3); a reply goes to a
 * `replied` lead, inside the thread it replied in (H2). Anything else is refused.
 */
async function sendMail(deps: WorkerDeps, action: ActionSpec, payload: Payload): Promise<PerformResult> {
  const first = action.kind === "email.send.first_contact";
  const lead = await leadFor(deps, action, payload, first ? "new" : "replied");
  const inReplyTo = first ? {} : { inReplyTo: threadOf(lead) };
  const auth = await providerAuthFor(deps, action.companyId, action.kind);
  const sent = await deps.integrations.outreach(auth).send({
    companyId: action.companyId,
    to: lead.email,
    subject: str(payload, "subject", action.description),
    text: str(payload, "text"),
    kind: first ? "first_contact" : "reply",
    ...inReplyTo,
  });
  return { externalRef: sent.messageId, sandbox: sent.sandbox };
}

/** BUD-3: the approved raise lands on North's own budget row; today's cap for a daily cap, the total limit for a total cap. A raise whose day is over (M4 review M1) fails here, so no resume follows. */
async function raiseCap(deps: WorkerDeps, action: ActionSpec, payload: Payload): Promise<PerformResult> {
  const category = action.category ?? "ads";
  const amountUsd = action.amountUsd ?? 0;
  const day = str(payload, "day", todayIsoDate());
  if (payload.cap === "total") await raiseTotalCap(deps.db, { companyId: action.companyId, category, amountUsd });
  else {
    const result = await raiseDailyCap(deps.db, { companyId: action.companyId, category, amountUsd, day });
    if (!result.applied) throw new Error(`cap day is over: the raise was for ${day}, the ${category} budget is already on a later day`);
  }
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
 * own connection (`providerAuthFor`). Throws for provider failures, for a
 * cap reached since the card was approved and for a target the company does
 * not own; the caller records any of them as failed.
 */
export async function performAction(deps: WorkerDeps, action: ActionSpec, ctx: PerformContext = NO_CARD): Promise<PerformResult> {
  const payload = (action.payload ?? {}) as Payload;
  switch (action.kind) {
    case "ads.start":
      return startCampaign(deps, action, payload);
    case "ads.pause":
    case "ads.resume":
      return toggleCampaigns(deps, action, payload, ctx);
    case "email.send.first_contact":
    case "email.send.reply":
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
