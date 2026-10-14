/**
 * Smoke loop. M0 scope: the domain rules and role configuration hold together
 * without any infrastructure. Later milestones extend this into the full
 * onboarding → plan → card → action → ledger run against the local stack.
 */
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { gate, ActionSpecSchema, planCards, transition } from "@north/core";
import { loadRoles } from "@north/agents";

const here = dirname(fileURLToPath(import.meta.url));

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`smoke: ${message}`);
}

async function main() {
  const roles = await loadRoles(resolve(here, "../agents"));
  assert(roles.size === 8, `expected 8 roles, got ${roles.size}`);

  const ctx = { killSwitchActive: false, budgets: [{ category: "ads" as const, totalLimitUsd: 100, dailyLimitUsd: 10, spentTotalUsd: 0, spentTodayUsd: 0 }], autoRules: [], cardDueAt: new Date(Date.now() + 86_400_000).toISOString() };
  const k0 = gate(ActionSpecSchema.parse({ kind: "research", companyId: "c", agentRole: "research", description: "market report" }), ctx);
  assert(k0.kind === "run", "K0 research must run directly");
  const k2 = gate(ActionSpecSchema.parse({ kind: "ads.start", companyId: "c", agentRole: "growth", description: "test campaign", amountUsd: 5, category: "ads" }), ctx);
  assert(k2.kind === "card", "K2 ads.start must open a card");
  const blocked = gate(ActionSpecSchema.parse({ kind: "research", companyId: "c", agentRole: "research", description: "x" }), { ...ctx, killSwitchActive: true });
  assert(blocked.kind === "block", "kill switch must block everything");

  const plan = planCards(k2.kind === "card" ? [k2.card, k2.card, k2.card, { ...k2.card, mergeKey: "other" }] : [], { quota: 3, openedToday: 0 });
  assert(plan.open.length <= 3, "quota exceeded");

  const done = transition(transition({ status: "queued", attempts: 0, evidence: null }, { type: "start" }), { type: "complete", evidence: { kind: "artifact_id", ref: "a1", verified: true, sandbox: true } });
  assert(done.status === "done", "task should be done with verified evidence");

  console.log("smoke M0: roles=8, gate K0/K2/kill-switch, quota, evidence-only done: OK");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
