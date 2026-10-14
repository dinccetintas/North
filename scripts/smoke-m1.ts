/**
 * M1 smoke loop against the local stack (Supabase + Inngest Dev Server + worker
 * in mock runtime). Creates a user and company, completes onboarding data, sends
 * `company/onboarded`, waits for the research/strategy tasks and the first plan,
 * then asserts the M1 acceptance criteria.
 *
 * Usage: pnpm smoke:m1   (requires `pnpm db:start`, `pnpm dev` or the three servers)
 */
import { Inngest } from "inngest";
import { createClient } from "@supabase/supabase-js";
import { EVENT, TASK_OWNER, type MetricKey } from "@north/core";
import {
  createCompany,
  createGoal,
  latestPlan,
  listArtifacts,
  listLedgerEntries,
  listTasks,
  setOnboardingStep,
  upsertBudgets,
  type Database,
} from "@north/db";
import { localSupabaseEnv } from "../packages/db/test/env";

const INNGEST_BASE_URL = process.env.INNGEST_BASE_URL ?? "http://localhost:8288";
const TIMEOUT_MS = Number(process.env.SMOKE_TIMEOUT_MS ?? 240_000);

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`smoke M1: ${message}`);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const env = localSupabaseEnv();
  const db = createClient<Database>(env.url, env.serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const inngest = new Inngest({ id: "north-smoke", isDev: true, baseUrl: INNGEST_BASE_URL });

  const email = `smoke-m1-${Date.now()}@north.test`;
  const user = await db.auth.admin.createUser({ email, password: `pw-${Date.now()}-Aa1!`, email_confirm: true });
  assert(user.data.user, `createUser failed: ${user.error?.message}`);
  const ownerId = user.data.user.id;

  const company = await createCompany(db, {
    ownerId,
    name: `Cold Hive ${Date.now().toString(36)}`,
    thesis: "Done-for-you cold email for B2B marketing agencies that have no outbound arm, sold as a monthly retainer.",
    targetCustomer: "B2B marketing agencies with 5-20 staff",
    whyNow: "Agencies lost paid-social margins and need a second revenue line.",
  });
  await createGoal(db, company.id, { metricKey: "paying_customers" satisfies MetricKey, targetValue: 10, dueDate: "2026-12-31" });
  await upsertBudgets(db, company.id, [
    { category: "ads", totalLimitUsd: 300, dailyLimitUsd: 20 },
    { category: "tools", totalLimitUsd: 100, dailyLimitUsd: 10 },
  ]);
  await setOnboardingStep(db, company.id, "done");

  console.log(`company ${company.slug} (${company.id}) → sending ${EVENT.companyOnboarded}`);
  await inngest.send({ name: EVENT.companyOnboarded, data: { companyId: company.id } });

  const started = Date.now();
  let plan = await latestPlan(db, company.id);
  while (!plan && Date.now() - started < TIMEOUT_MS) {
    await sleep(3000);
    plan = await latestPlan(db, company.id);
  }
  assert(plan, `no plan after ${TIMEOUT_MS / 1000}s; check the Inngest Dev Server at ${INNGEST_BASE_URL}`);

  // Wait for the plan's own tasks to settle too.
  const settled = async () => (await listTasks(db, company.id)).every((t) => t.status === "done" || t.status === "failed");
  while (!(await settled()) && Date.now() - started < TIMEOUT_MS) await sleep(3000);

  const tasks = await listTasks(db, company.id);
  const artifacts = await listArtifacts(db, company.id);
  const ledger = await listLedgerEntries(db, company.id);
  const actions = await db.from("actions").select("tier").eq("company_id", company.id);
  const runs = await db.from("agent_runs").select("id").eq("company_id", company.id);

  const onboarding = tasks.filter((t) => t.planId === null && t.taskType !== "plan_week");
  assert(onboarding.length === 6, `expected 6 onboarding tasks, got ${onboarding.length}`);
  for (const t of onboarding) {
    assert(t.status === "done", `task ${t.taskType} is ${t.status}: ${t.lastError ?? ""}`);
    assert(t.evidence?.kind === "artifact_id", `task ${t.taskType} has no artifact evidence`);
    assert(t.role === TASK_OWNER[t.taskType], `task ${t.taskType} owned by ${t.role}`);
  }
  assert(artifacts.length >= 6, `expected ≥6 artifacts, got ${artifacts.length}`);
  for (const t of plan.tasks) {
    assert(t.role && t.metricKey && t.expectedDelta !== null, `plan task "${t.title}" lacks role/metric/delta`);
  }
  assert(ledger.length >= 6, `expected ≥6 ledger entries, got ${ledger.length}`);
  assert((runs.data?.length ?? 0) >= 7, `expected ≥7 agent runs, got ${runs.data?.length}`);
  assert((actions.data ?? []).every((a) => a.tier === "K0"), "an action above K0 was recorded in M1");

  console.log(
    `smoke M1 OK in ${Math.round((Date.now() - started) / 1000)}s: ${onboarding.length} onboarding tasks done, ${artifacts.length} artifacts, plan "${plan.summary.slice(0, 60)}…" with ${plan.tasks.length} tasks, ${ledger.length} ledger entries, ${runs.data?.length} agent runs`,
  );
  await db.auth.admin.deleteUser(ownerId);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
