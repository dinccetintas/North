/**
 * M2 smoke loop: a growth task requests a K2 action → a decision card opens →
 * the CEO answers (approve, then decline on a second task) → the action is
 * executed/declined through the sandbox adapter → the task finishes with
 * evidence → kill switch pauses campaigns and refuses new dispatches within 5 s.
 *
 * Usage: pnpm smoke:m2   (requires `pnpm db:start` and the three dev servers)
 */
import { Inngest } from "inngest";
import { createClient } from "@supabase/supabase-js";
import { EVENT } from "@north/core";
import {
  answerCard,
  createCompany,
  createGoal,
  createTask,
  getTask,
  listPendingCards,
  listRecentActions,
  setKillSwitch,
  setOnboardingStep,
  upsertBudgets,
  type Database,
} from "@north/db";
import { localSupabaseEnv } from "../packages/db/test/env";

const INNGEST_BASE_URL = process.env.INNGEST_BASE_URL ?? "http://localhost:8288";
const TIMEOUT_MS = Number(process.env.SMOKE_TIMEOUT_MS ?? 120_000);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`smoke M2: ${message}`);
}

async function until<T>(label: string, probe: () => Promise<T | null | undefined | false>, timeoutMs = TIMEOUT_MS): Promise<T> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const value = await probe();
    if (value) return value;
    await sleep(1500);
  }
  throw new Error(`smoke M2: timed out waiting for ${label}`);
}

async function main() {
  const env = localSupabaseEnv();
  const db = createClient<Database>(env.url, env.serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const inngest = new Inngest({ id: "north-smoke-m2", isDev: true, baseUrl: INNGEST_BASE_URL });

  const user = await db.auth.admin.createUser({ email: `smoke-m2-${Date.now()}@north.test`, password: `pw-${Date.now()}-Aa1!`, email_confirm: true });
  assert(user.data.user, `createUser failed: ${user.error?.message}`);
  const ownerId = user.data.user.id;
  const company = await createCompany(db, { ownerId, name: `Decision Co ${Date.now().toString(36)}`, thesis: "A done-for-you cold email service for B2B agencies, sold as a monthly retainer." });
  await createGoal(db, company.id, { metricKey: "signups", targetValue: 50, dueDate: "2026-12-31" });
  await upsertBudgets(db, company.id, [{ category: "ads", totalLimitUsd: 300, dailyLimitUsd: 20 }]);
  await setOnboardingStep(db, company.id, "done");

  // 1) Approve path.
  const task1 = await createTask(db, { companyId: company.id, role: "growth", taskType: "campaign_spec", title: "Test campaign", metricKey: "signups", expectedDelta: 10 });
  await inngest.send({ name: EVENT.taskDispatch, data: { companyId: company.id, taskId: task1.id } });
  const card1 = await until("decision card (approve path)", async () => (await listPendingCards(db, company.id))[0]);
  assert(card1.tier === "K2" && card1.actionKind === "ads.start", `unexpected card ${card1.tier} ${card1.actionKind}`);
  assert((await getTask(db, task1.id))?.status === "waiting_decision", "task should wait on the decision");

  const answeredAt = Date.now();
  await answerCard(db, card1.id, { optionId: "approve", answeredBy: "user" });
  await inngest.send({ name: EVENT.decisionAnswered, data: { companyId: company.id, cardId: card1.id, optionId: "approve", answeredBy: "user" } });
  const done1 = await until("task done after approval", async () => {
    const t = await getTask(db, task1.id);
    return t?.status === "done" ? t : null;
  });
  const latency = Date.now() - answeredAt;
  const actions = await listRecentActions(db, company.id, 1);
  const executed = actions.find((a) => a.kind === "ads.start" && a.status === "executed");
  assert(executed?.externalRef?.startsWith("sandbox:"), `expected an executed sandbox ads.start action, got ${JSON.stringify(actions.map((a) => [a.kind, a.status]))}`);
  assert(done1.evidence?.kind === "artifact_id", "approve path should finish with artifact evidence");

  // 2) Decline path.
  const task2 = await createTask(db, { companyId: company.id, role: "growth", taskType: "campaign_spec", title: "Second campaign", metricKey: "signups", expectedDelta: 5 });
  await inngest.send({ name: EVENT.taskDispatch, data: { companyId: company.id, taskId: task2.id } });
  const card2 = await until("decision card (decline path)", async () => (await listPendingCards(db, company.id))[0]);
  await answerCard(db, card2.id, { optionId: "decline", answeredBy: "user" });
  await inngest.send({ name: EVENT.decisionAnswered, data: { companyId: company.id, cardId: card2.id, optionId: "decline", answeredBy: "user" } });
  await until("task done after decline", async () => ((await getTask(db, task2.id))?.status === "done" ? true : null));
  const declined = (await listRecentActions(db, company.id, 1)).find((a) => a.taskId === task2.id && a.status === "declined");
  assert(declined, "decline path should record a declined action");

  // 3) Kill switch: campaigns paused, new dispatch refused, within 5 s.
  const killedAt = Date.now();
  await setKillSwitch(db, company.id, true);
  await inngest.send({ name: EVENT.companyKillSwitch, data: { companyId: company.id } });
  const task3 = await createTask(db, { companyId: company.id, role: "growth", taskType: "campaign_spec", title: "Should not run", metricKey: "signups", expectedDelta: 1 });
  await inngest.send({ name: EVENT.taskDispatch, data: { companyId: company.id, taskId: task3.id } });
  const paused = await until("kill switch pause record", async () => (await listRecentActions(db, company.id, 1)).find((a) => a.kind === "ads.pause" && a.description.startsWith("Kill switch")), 15_000);
  const killLatency = Date.now() - killedAt;
  await sleep(4000);
  assert((await getTask(db, task3.id))?.status === "queued", "a task dispatched under the kill switch must stay queued");
  assert(killLatency <= 5000, `kill switch took ${killLatency} ms (limit 5000)`);

  const cardsToday = (await db.from("decision_cards").select("seq").eq("company_id", company.id)).data?.length ?? 0;
  console.log(
    `smoke M2 OK: card→done latency ${latency} ms, executed ref ${executed.externalRef}, declined action recorded, kill switch ${killLatency} ms (${(paused.payload as { campaignIds?: string[] }).campaignIds?.length ?? 0} campaign(s) paused), cards opened today ${cardsToday}`,
  );
  await db.auth.admin.deleteUser(ownerId);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
