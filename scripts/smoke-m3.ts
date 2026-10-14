/**
 * M3 smoke loop: an engineering task builds the landing page → repo, push and
 * preview run through the gate (K1) → the preview answers 200 → a go-live card
 * opens (K2) → approve publishes to production and the task finishes with the
 * live URL as evidence; decline keeps the preview; a task that fails once is
 * retried with a different approach; one that fails twice is escalated; a
 * design task delivers screen designs. Finally: "done without evidence" is
 * impossible through the repository.
 *
 * Usage: pnpm smoke:m3   (requires the stack and `pnpm dev`)
 */
import { Inngest } from "inngest";
import { createClient } from "@supabase/supabase-js";
import { EVENT, MAX_ATTEMPTS } from "@north/core";
import {
  answerCard,
  createCompany,
  createGoal,
  createTask,
  getTask,
  headActionsForTask,
  listArtifacts,
  listMemoryItems,
  listPendingCards,
  markTaskDone,
  setOnboardingStep,
  upsertBudgets,
  type Database,
} from "@north/db";
import { localSupabaseEnv } from "../packages/db/test/env";

const INNGEST_BASE_URL = process.env.INNGEST_BASE_URL ?? "http://localhost:8288";
const TIMEOUT_MS = Number(process.env.SMOKE_TIMEOUT_MS ?? 120_000);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`smoke M3: ${message}`);
}

async function until<T>(label: string, probe: () => Promise<T | null | undefined | false>, timeoutMs = TIMEOUT_MS): Promise<T> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const value = await probe();
    if (value) return value;
    await sleep(1500);
  }
  throw new Error(`smoke M3: timed out waiting for ${label}`);
}

async function main() {
  const env = localSupabaseEnv();
  const db = createClient<Database>(env.url, env.serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const inngest = new Inngest({ id: "north-smoke-m3", isDev: true, baseUrl: INNGEST_BASE_URL });

  const user = await db.auth.admin.createUser({ email: `smoke-m3-${Date.now()}@north.test`, password: `pw-${Date.now()}-Aa1!`, email_confirm: true });
  assert(user.data.user, `createUser failed: ${user.error?.message}`);
  const ownerId = user.data.user.id;
  const company = await createCompany(db, { ownerId, name: `Build Co ${Date.now().toString(36)}`, thesis: "Bookkeeping for solo consultants that closes the month in one click." });
  await createGoal(db, company.id, { metricKey: "signups", targetValue: 50, dueDate: "2026-12-31" });
  await upsertBudgets(db, company.id, [{ category: "ads", totalLimitUsd: 300, dailyLimitUsd: 20 }]);
  await setOnboardingStep(db, company.id, "done");
  const dispatch = (taskId: string) => inngest.send({ name: EVENT.taskDispatch, data: { companyId: company.id, taskId } });

  // 1) Design: screen designs as an artifact (K0).
  const design = await createTask(db, { companyId: company.id, role: "design", taskType: "screen_designs", title: "Screen designs v0", metricKey: "artifacts", expectedDelta: 1 });
  await dispatch(design.id);

  // 2) Build → preview → go-live card → approve → live.
  const build = await createTask(db, { companyId: company.id, role: "engineering", taskType: "build_site", title: "Landing page v0", metricKey: "signups", expectedDelta: 10 });
  await dispatch(build.id);
  const card = await until("go-live card", async () => (await listPendingCards(db, company.id)).find((c) => c.actionKind === "deploy.production"));
  assert(card.tier === "K2" && card.rationale.includes("preview:"), `unexpected card ${card.tier} ${card.rationale}`);
  const beforeApprove = await headActionsForTask(db, build.id);
  const preview = beforeApprove.find((a) => a.kind === "deploy.preview");
  assert(preview?.status === "notified" && preview.externalRef?.startsWith("http"), `preview should be notified with a URL, got ${JSON.stringify(preview)}`);
  assert(beforeApprove.find((a) => a.kind === "repo.push")?.status === "notified", "push should be notified");
  const previewPage = await fetch(preview.externalRef!);
  assert(previewPage.status === 200 && (await previewPage.text()).includes(company.name), "the preview must serve the landing page with the company name");

  await answerCard(db, card.id, { optionId: "approve", answeredBy: "user" });
  await inngest.send({ name: EVENT.decisionAnswered, data: { companyId: company.id, cardId: card.id, optionId: "approve", answeredBy: "user" } });
  const live = await until("task done after go-live", async () => {
    const t = await getTask(db, build.id);
    return t?.status === "done" ? t : null;
  });
  assert(live.evidence?.kind === "url" && live.evidence.verified && live.evidence.ref.includes("/live-"), `expected live URL evidence, got ${JSON.stringify(live.evidence)}`);
  const livePage = await fetch(live.evidence.ref);
  assert(livePage.status === 200, `live URL should answer 200, got ${livePage.status}`);
  const production = (await headActionsForTask(db, build.id)).find((a) => a.kind === "deploy.production");
  assert(production?.status === "executed", `production action should be executed, got ${production?.status}`);

  // 3) Decline path keeps the preview.
  const build2 = await createTask(db, { companyId: company.id, role: "engineering", taskType: "build_site", title: "Landing page v0 (decline)", metricKey: "signups", expectedDelta: 1 });
  await dispatch(build2.id);
  const card2 = await until("second go-live card", async () => (await listPendingCards(db, company.id)).find((c) => c.taskId === build2.id));
  await answerCard(db, card2.id, { optionId: "decline", answeredBy: "user" });
  await inngest.send({ name: EVENT.decisionAnswered, data: { companyId: company.id, cardId: card2.id, optionId: "decline", answeredBy: "user" } });
  const declined = await until("task done after decline", async () => {
    const t = await getTask(db, build2.id);
    return t?.status === "done" ? t : null;
  });
  assert(declined.evidence?.kind === "url" && !declined.evidence.ref.includes("/live-"), "declined task keeps the preview URL as evidence");

  // 4) AGT-3: fail once → second attempt succeeds; fail always → failed after two attempts + escalation learning.
  const once = await createTask(db, { companyId: company.id, role: "engineering", taskType: "build_site", title: "Flaky build", input: "[[fail-once]]", metricKey: "signups", expectedDelta: 1 });
  await dispatch(once.id);
  const recovered = await until("fail-once task recovers on attempt 2", async () => {
    const t = await getTask(db, once.id);
    return t && t.attempts === 2 && (t.status === "waiting_decision" || t.status === "done") ? t : null;
  });
  assert(recovered.attempts === MAX_ATTEMPTS, "second attempt should have run");

  const always = await createTask(db, { companyId: company.id, role: "engineering", taskType: "build_site", title: "Broken build", input: "[[fail-always]]", metricKey: "signups", expectedDelta: 1 });
  await dispatch(always.id);
  const escalated = await until("fail-always task ends failed after two attempts", async () => {
    const t = await getTask(db, always.id);
    return t && t.status === "failed" && t.attempts === MAX_ATTEMPTS ? t : null;
  });
  assert(escalated.lastError?.includes("Build failed"), "the last error is kept on the task");
  const learning = await until("escalation learning in memory", async () => (await listMemoryItems(db, company.id, 50)).find((m) => m.title.startsWith("Escalated:")));
  assert(learning, "escalation writes a learning");

  // 5) Design artifact landed; AGT-2 through the repository.
  const designDone = await until("design task done", async () => ((await getTask(db, design.id))?.status === "done" ? true : null));
  assert(designDone && (await listArtifacts(db, company.id)).some((a) => a.kind === "screen_designs"), "screen designs artifact exists");
  const openTask = await createTask(db, { companyId: company.id, role: "research", taskType: "market_report", title: "No evidence" });
  let refused = false;
  try {
    await markTaskDone(db, openTask.id, { evidence: { kind: "url", ref: "http://example.test", verified: false }, costUsd: 0, outputSummary: "x" });
  } catch {
    refused = true;
  }
  assert(refused, "a task cannot be done with unverified evidence");

  console.log(
    `smoke M3 OK: repo ${beforeApprove.find((a) => a.kind === "repo.create")?.externalRef}, preview ${preview.externalRef} (200), live ${live.evidence.ref} (200), decline kept preview, fail-once recovered on attempt 2, fail-always escalated with a learning, screen designs delivered, unverified done refused`,
  );
  await db.auth.admin.deleteUser(ownerId);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
