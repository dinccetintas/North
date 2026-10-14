import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Test-only access to the local stack: Supabase REST with the service role key
 * (to seed rows the UI cannot create) and the Inngest dev server (to dispatch).
 * Mirrors `packages/db/test/env.ts`; never used by the app itself.
 */

const INNGEST_DEV_URL = process.env.E2E_INNGEST_URL ?? "http://localhost:8288";
const DB_PACKAGE_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../../../packages/db");

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

/** Sends one event to the Inngest dev server. */
export async function sendInngestEvent(name: string, data: Record<string, unknown>): Promise<void> {
  const response = await fetch(`${INNGEST_DEV_URL}/e/dev`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, data }),
  });
  if (!response.ok) throw new Error(`Inngest send ${name} → ${response.status}: ${await response.text()}`);
}
