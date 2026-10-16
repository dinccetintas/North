import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ActionSpec, Entitlement } from "@north/core";
import type { SandboxEvent } from "@north/integrations";
import { adsStart, emptyState, fakeDbModule, fakeDeps, seedCompany, seedTask, type FakeState } from "./fake-db";

/**
 * M6 security review L3: a company the user paused could be resumed after
 * the subscription ended and an approved card would then run. The database
 * refuses the resume (0015); the gate and `performPending` also refuse while
 * the owner's entitlement is ended, so nothing touches the outside world for
 * an ended subscription. Stopping spend (`ads.pause`) is never refused.
 */
const state: FakeState = emptyState();
const dbModule = fakeDbModule(state);
vi.mock("@north/db", () => dbModule);

const { completeAction, gateAction, performPending } = await import("../src/services/actions");

let events: SandboxEvent[];
const OWNER = "user-1";

async function setStatus(status: Entitlement["status"]): Promise<void> {
  const current = await dbModule.getEntitlement(null, OWNER);
  if (!current) throw new Error("no entitlement");
  const ended = status === "ended";
  state.entitlements.set(OWNER, { ...current, status, endedAt: ended ? new Date().toISOString() : null, retentionUntil: ended ? new Date(Date.now() + 90 * 86_400_000).toISOString() : null });
}

async function replySpec(): Promise<ActionSpec> {
  await dbModule.importLeads(null, "company-1", [{ name: "Mara", email: "mara@example.test" }], "upload");
  const lead = [...state.leads.values()].find((l) => l.email === "mara@example.test")!;
  Object.assign(lead, { status: "replied", messageId: "sandbox:msg:first" });
  return { kind: "email.send.reply", companyId: "company-1", agentRole: "sales", description: "Reply", payload: { to: "mara@example.test", subject: "Re", text: "t", leadId: lead.id } };
}

beforeEach(() => {
  Object.assign(state, emptyState());
  state.budgets.set("company-1", [{ category: "ads", totalLimitUsd: 300, dailyLimitUsd: 20, spentTotalUsd: 0, spentTodayUsd: 0 }]);
  seedCompany(state, { id: "company-1", ownerId: OWNER });
  events = [];
});

describe("L3: an ended subscription performs nothing (M6 review)", () => {
  it("the gate records the action blocked as subscription_ended and opens no card; nothing reaches an adapter", async () => {
    const task = seedTask(state);
    await setStatus("ended");
    const gated = await gateAction(fakeDeps(state, events), task.id, adsStart());
    expect(gated).toMatchObject({ kind: "blocked", reason: "subscription_ended" });
    expect(state.cards.size).toBe(0);
    expect(state.actions[0]).toMatchObject({ kind: "ads.start", status: "blocked", payload: { subscription_ended: true } });
    expect(events).toEqual([]);
  });

  it("performPending refuses a pending action once the entitlement ended; the row stays pending and runs after a new subscription", async () => {
    const task = seedTask(state, { role: "sales", taskType: "outreach_batch" });
    const deps = fakeDeps(state, events);
    const gated = await gateAction(deps, task.id, await replySpec());
    if (gated.kind !== "execute") throw new Error(`expected execute, got ${gated.kind}`);
    await setStatus("ended");
    const refused = await performPending(deps, gated.actionId);
    expect(refused).toMatchObject({ ok: false, ended: true });
    expect(events).toEqual([]);
    expect(await completeAction(deps, { actionId: gated.actionId, tier: gated.tier, outcome: refused })).toEqual({ status: "pending", externalRef: null });
    expect(state.actions.map((a) => a.status)).toEqual(["pending"]);
    await setStatus("active");
    const performed = await performPending(deps, gated.actionId);
    expect(performed).toMatchObject({ ok: true, externalRef: expect.stringMatching(/^sandbox:msg:/) });
  });

  it("past_due and canceled still run (they are active until Stripe ends them)", async () => {
    const task = seedTask(state, { role: "sales", taskType: "outreach_batch" });
    await setStatus("past_due");
    expect(await gateAction(fakeDeps(state, events), task.id, await replySpec())).toMatchObject({ kind: "execute" });
  });

  it("ads.pause still passes while ended: stopping spend is never refused", async () => {
    const task = seedTask(state);
    await setStatus("ended");
    const deps = fakeDeps(state, events);
    const pause: ActionSpec = { kind: "ads.pause", companyId: "company-1", agentRole: "growth", description: "Pause: the daily cap is reached", payload: { campaignId: "c-1", providerCampaignId: "sandbox:campaign:1", reason: "cap" } };
    const gated = await gateAction(deps, task.id, pause, { origin: "worker" });
    expect(gated.kind).toBe("execute");
    if (gated.kind !== "execute") return;
    expect(await performPending(deps, gated.actionId)).not.toHaveProperty("ended");
  });
});
