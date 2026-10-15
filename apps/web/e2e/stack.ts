import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

/**
 * Test-only access to the local stack: Supabase REST with the service role key
 * (to seed rows the UI cannot create) and the Inngest dev server (to dispatch).
 * Mirrors `packages/db/test/env.ts`; never used by the app itself.
 */

const INNGEST_DEV_URL = process.env.E2E_INNGEST_URL ?? "http://localhost:8288";
/** The worker's loopback server: sandbox simulation routes (M4) live there, sandbox mode only. */
const WORKER_URL = process.env.E2E_WORKER_URL ?? "http://localhost:3101";
/** Playwright runs from apps/web and transforms specs to CommonJS, so no import.meta here. */
const DB_PACKAGE_DIR = resolve(process.cwd(), "../../packages/db");

interface ServiceEnv {
  readonly url: string;
  readonly serviceRoleKey: string;
}

let cached: ServiceEnv | null = null;

function parseStatusEnv(output: string): Record<string, string> {
  return Object.fromEntries(
    output
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.includes("="))
      .map((line) => {
        const [key, ...rest] = line.split("=");
        return [key, rest.join("=").replace(/^"|"$/g, "")];
      }),
  );
}

export function serviceEnv(): ServiceEnv {
  if (cached) return cached;
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (url && key) {
    cached = { url, serviceRoleKey: key };
    return cached;
  }
  const vars = parseStatusEnv(execFileSync("npx", ["supabase", "status", "-o", "env"], { cwd: DB_PACKAGE_DIR, encoding: "utf8" }));
  const fromStatus = { url: vars.API_URL, serviceRoleKey: vars.SERVICE_ROLE_KEY ?? vars.SECRET_KEY };
  if (!fromStatus.url || !fromStatus.serviceRoleKey) {
    throw new Error(`Could not read local Supabase keys: ${Object.keys(vars).join(", ")}`);
  }
  cached = fromStatus;
  return cached;
}

async function rest<T>(path: string, init: RequestInit): Promise<T> {
  const env = serviceEnv();
  const response = await fetch(`${env.url}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: env.serviceRoleKey,
      Authorization: `Bearer ${env.serviceRoleKey}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
      ...(init.headers ?? {}),
    },
  });
  if (!response.ok) throw new Error(`Supabase REST ${init.method ?? "GET"} ${path} → ${response.status}: ${await response.text()}`);
  return (await response.json()) as T;
}

export async function companyIdBySlug(slug: string): Promise<string> {
  const rows = await rest<{ id: string }[]>(`companies?slug=eq.${encodeURIComponent(slug)}&select=id`, { method: "GET" });
  const id = rows[0]?.id;
  if (!id) throw new Error(`No company with slug ${slug}`);
  return id;
}

export interface SeededTask {
  readonly id: string;
}

/** Inserts a queued K2 task the mock runtime answers with one `ads.start` action (fixture `growth:campaign_spec`). */
export async function insertCampaignSpecTask(companyId: string, title = "Test campaign"): Promise<SeededTask> {
  const rows = await rest<{ id: string }[]>("tasks", {
    method: "POST",
    body: JSON.stringify({ company_id: companyId, role: "growth", task_type: "campaign_spec", title, metric_key: "signups", expected_delta: 10 }),
  });
  const id = rows[0]?.id;
  if (!id) throw new Error("Task insert returned no id");
  return { id };
}

/** Inserts a queued engineering task the mock runtime answers with the landing page files (fixture `engineering:build_site`, M3). */
export async function insertBuildSiteTask(companyId: string, title = "Landing page v0"): Promise<SeededTask> {
  const rows = await rest<{ id: string }[]>("tasks", {
    method: "POST",
    body: JSON.stringify({ company_id: companyId, role: "engineering", task_type: "build_site", title, metric_key: "signups", expected_delta: 10 }),
  });
  const id = rows[0]?.id;
  if (!id) throw new Error("Task insert returned no id");
  return { id };
}

/** Inserts a queued sales task the mock runtime answers with one `email.send.first_contact` per lead, all on one batch (fixture `sales:outreach_batch`, M4). */
export async function insertOutreachBatchTask(companyId: string, title = "Outreach batch 1"): Promise<SeededTask> {
  const rows = await rest<{ id: string }[]>("tasks", {
    method: "POST",
    body: JSON.stringify({ company_id: companyId, role: "sales", task_type: "outreach_batch", title, metric_key: "email_replies", expected_delta: 2 }),
  });
  const id = rows[0]?.id;
  if (!id) throw new Error("Task insert returned no id");
  return { id };
}

/** Sends one event to the Inngest dev server. */
export async function sendInngestEvent(name: string, data: Record<string, unknown>): Promise<void> {
  const response = await fetch(`${INNGEST_DEV_URL}/e/dev`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, data }),
  });
  if (!response.ok) throw new Error(`Inngest send ${name} → ${response.status}: ${await response.text()}`);
}

/** Sets one category's caps (BUD-1) the way the budget step would; spent amounts are untouched. */
export async function setBudget(companyId: string, category: "ads" | "tools" | "domain" | "other", caps: { readonly daily: number; readonly total: number }): Promise<void> {
  await rest<unknown[]>(`budgets?company_id=eq.${encodeURIComponent(companyId)}&category=eq.${category}`, {
    method: "PATCH",
    body: JSON.stringify({ daily_limit_usd: caps.daily, total_limit_usd: caps.total }),
  });
}

export interface LeadRow {
  readonly name: string;
  readonly email: string;
  readonly company?: string;
  readonly why?: string;
}

/** Seeds leads as an owner upload would (source `upload`, status `new`). */
export async function insertLeads(companyId: string, rows: readonly LeadRow[]): Promise<void> {
  await rest<unknown[]>("leads", {
    method: "POST",
    body: JSON.stringify(rows.map((r) => ({ company_id: companyId, name: r.name, email: r.email, company_name: r.company ?? "", why: r.why ?? "", source: "upload", status: "new" }))),
  });
}

export interface SeededCampaign {
  readonly id: string;
  readonly providerCampaignId: string;
  readonly name: string;
  readonly status: string;
}

/** The company's campaign rows (the worker registers one per executed `ads.start`), newest first. */
export async function campaignsFor(companyId: string): Promise<readonly SeededCampaign[]> {
  const rows = await rest<{ id: string; provider_campaign_id: string; name: string; status: string }[]>(
    `campaigns?company_id=eq.${encodeURIComponent(companyId)}&select=id,provider_campaign_id,name,status&order=created_at.desc`,
    { method: "GET" },
  );
  return rows.map((r) => ({ id: r.id, providerCampaignId: r.provider_campaign_id, name: r.name, status: r.status }));
}

/** External refs (message ids) of every executed first-contact send of the company, oldest first. */
export async function sentMessageIds(companyId: string): Promise<readonly string[]> {
  const rows = await rest<{ external_ref: string | null }[]>(
    `actions?company_id=eq.${encodeURIComponent(companyId)}&kind=eq.email.send.first_contact&status=eq.executed&select=external_ref&order=created_at.asc`,
    { method: "GET" },
  );
  return rows.flatMap((r) => (r.external_ref ? [r.external_ref] : []));
}

async function workerPost(path: string, body: Record<string, unknown>): Promise<void> {
  const response = await fetch(`${WORKER_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`Worker POST ${path} → ${response.status}: ${await response.text()}`);
}

export interface AdDeliveryInput {
  readonly spendUsd: number;
  readonly impressions: number;
  readonly clicks: number;
  readonly conversions: number;
}

/** Simulates one delivery window of a sandbox campaign (the worker's sandbox route; 404 in live mode). */
export function simulateAdSpend(providerCampaignId: string, delivery: AdDeliveryInput): Promise<void> {
  return workerPost(`/sandbox/ads/${encodeURIComponent(providerCampaignId)}/deliver`, { ...delivery });
}

/** Simulates a reply to a sandbox message (`sandbox:msg:<uuid>`). */
export function simulateReply(messageId: string): Promise<void> {
  return workerPost(`/sandbox/mail/${encodeURIComponent(messageId)}/reply`, {});
}

/** Runs the company's metric collection now (OUT-2), as the hourly cron would. */
export function collectMetrics(companyId: string): Promise<void> {
  return sendInngestEvent("metric/collect", { companyId, reason: "manual" });
}
