import type { TaskType } from "@north/core";
import { LEADS_VAR, type LeadVar } from "@north/agents";
import { currentThesis, listBudgets, listGoals, memoryDigest, nextUnsentLeads, siteUrls, type DbClient } from "@north/db";

export interface CompanyContext {
  /** Labeled lines every prompt and fixture can parse: Company, Thesis, Target customer, Why now. */
  readonly header: string;
  /** Memory digest from the repository (thesis + newest memory items). */
  readonly digest: string;
  /** Placeholder values for the role system prompts, plus structured hand-overs encoded as strings (`leads`, `site.url`). */
  readonly vars: Readonly<Record<string, string>>;
}

/** How many unsent leads one outreach batch receives (SLS-K2: five while the message is unproven). */
export const OUTREACH_BATCH_SIZE = 5;

/** `vars.leads` for an outreach batch: the next unsent leads as the JSON `LeadVar[]` the fixtures and the guide read. */
async function leadsVar(db: DbClient, companyId: string): Promise<string> {
  const leads = await nextUnsentLeads(db, companyId, OUTREACH_BATCH_SIZE);
  const rows: LeadVar[] = leads.map((l) => ({ id: l.id, name: l.name, email: l.email, company: l.companyName, why: l.why }));
  return JSON.stringify(rows);
}

/** `vars["site.url"]` for a campaign spec: the live site, else the latest preview, else empty (the worker fills the landing URL at start anyway). */
async function siteUrlVar(db: DbClient, companyId: string): Promise<string> {
  const site = await siteUrls(db, companyId);
  return site.live ?? site.preview ?? "";
}

/** Gathers what an agent needs to know about the company before a run; task-type specific hand-overs are added for the types that need them. */
export async function companyContext(db: DbClient, companyId: string, taskType?: TaskType): Promise<CompanyContext> {
  const [company, thesis, goals, budgets, digest] = await Promise.all([
    db.from("companies").select("name").eq("id", companyId).single(),
    currentThesis(db, companyId),
    listGoals(db, companyId),
    listBudgets(db, companyId),
    memoryDigest(db, companyId),
  ]);
  const name = company.data?.name ?? "the company";
  const goalLines = goals.filter((g) => g.status === "active").map((g) => `${g.metricKey} → ${g.targetValue} by ${g.dueDate}`);
  const budgetLines = budgets.map((b) => `${b.category}: $${b.totalLimitUsd} total, $${b.dailyLimitUsd}/day`);
  const ads = budgets.find((b) => b.category === "ads");
  const header = [
    `Company: ${name}`,
    `Thesis: ${thesis?.text ?? "(not set)"}`,
    `Target customer: ${thesis?.targetCustomer || "(not set)"}`,
    `Why now: ${thesis?.whyNow || "(not set)"}`,
  ].join("\n");
  const extra: Record<string, string> = {};
  if (taskType === "outreach_batch") extra[LEADS_VAR] = await leadsVar(db, companyId);
  if (taskType === "campaign_spec") extra["site.url"] = await siteUrlVar(db, companyId);
  return Object.freeze({
    header,
    digest,
    vars: Object.freeze({
      "company.name": name,
      thesis: thesis?.text ?? "(not set)",
      goals: goalLines.join("; ") || "(none yet)",
      budgets: budgetLines.join("; ") || "(none yet)",
      "budgets.ads": ads ? `$${ads.totalLimitUsd} total` : "(none)",
      quota: "3",
      ...extra,
    }),
  });
}
