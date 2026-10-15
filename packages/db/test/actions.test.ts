import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { listActionsByKind, listRecentActions, pendingActionForCard, pendingActionsForCard, recordAction, recordActionTransition, siteUrls } from "../src/actions";
import { openCard } from "../src/decisions";
import { DbError } from "../src/errors";
import { createOwnerWithCompany, createTestUser, deleteTestUser, service, type OwnedCompany, type TestUser } from "./fixtures";

describe("actions repository (DEC-1, audit log)", () => {
  let owned: OwnedCompany;
  let stranger: TestUser;

  beforeAll(async () => {
    owned = await createOwnerWithCompany("actions");
    stranger = await createTestUser("actions-stranger");
  });

  afterAll(async () => {
    await deleteTestUser(owned.owner);
    await deleteTestUser(stranger);
  });

  it("recordAction writes a K0 action with payload and listRecentActions returns it newest first", async () => {
    const first = await recordAction(service, { companyId: owned.companyId, taskId: null, agentRole: "research", kind: "research", tier: "K0", description: "Searched the web", payload: { query: "clinic queue" }, status: "executed" });
    const second = await recordAction(service, { companyId: owned.companyId, taskId: null, agentRole: "research", kind: "memory.write", tier: "K0", description: "Wrote memory", status: "executed", sandbox: false });
    const recent = await listRecentActions(owned.owner.client, owned.companyId);
    expect(recent.map((a) => a.id)).toEqual([second, first]);
    expect(recent[1]).toMatchObject({ kind: "research", tier: "K0", payload: { query: "clinic queue" }, status: "executed", sandbox: true, externalRef: null, decisionCardId: null });
    expect(recent[0]?.sandbox).toBe(false);
  });

  it("DEC-1: a K2 action without a card or auto rule is rejected unless blocked", async () => {
    await expect(recordAction(service, { companyId: owned.companyId, taskId: null, agentRole: "growth", kind: "ads.start", tier: "K2", description: "Start ads", status: "executed" })).rejects.toBeInstanceOf(DbError);
    const blocked = await recordAction(service, { companyId: owned.companyId, taskId: null, agentRole: "growth", kind: "ads.start", tier: "K2", description: "Start ads", status: "blocked" });
    expect(typeof blocked).toBe("string");
  });

  it("audit NFR: owners read their log but cannot write to it; only the worker records actions", async () => {
    await expect(recordAction(owned.owner.client, { companyId: owned.companyId, taskId: null, agentRole: "research", kind: "research", tier: "K0", description: "forged", status: "executed" })).rejects.toBeInstanceOf(DbError);
    const direct = await owned.owner.client.from("actions").insert({ company_id: owned.companyId, agent_role: "research", kind: "research", tier: "K0", description: "forged", status: "executed" });
    expect(direct.error?.code).toBe("42501");
    expect((await listRecentActions(owned.owner.client, owned.companyId)).some((a) => a.description === "forged")).toBe(false);
  });

  it("listRecentActions honours the time window", async () => {
    const [newest] = await listRecentActions(service, owned.companyId);
    const old = new Date(Date.now() - 48 * 3_600_000).toISOString();
    await service.from("actions").insert({ company_id: owned.companyId, agent_role: "research", kind: "research", tier: "K0", description: "old", status: "executed", created_at: old });
    const lastDay = await listRecentActions(service, owned.companyId, 24);
    expect(lastDay.some((a) => a.description === "old")).toBe(false);
    expect(lastDay[0]?.id).toBe(newest!.id);
    const threeDays = await listRecentActions(service, owned.companyId, 72);
    expect(threeDays.some((a) => a.description === "old")).toBe(true);
  });

  it("siteUrls returns the newest live and preview URLs from chain heads only (M3 Website line)", async () => {
    expect(await siteUrls(owned.owner.client, owned.companyId)).toEqual({ live: null, preview: null });
    const preview = await recordAction(service, { companyId: owned.companyId, taskId: null, agentRole: "engineering", kind: "deploy.preview", tier: "K1", description: "preview", status: "pending" });
    await recordActionTransition(service, { actionId: preview, status: "notified", externalRef: "http://127.0.0.1:3101/sandbox/sites/abc/" });
    expect(await siteUrls(owned.owner.client, owned.companyId)).toEqual({ live: null, preview: "http://127.0.0.1:3101/sandbox/sites/abc/" });
    const card = await openCard(service, { companyId: owned.companyId, taskId: null, question: "Go live?", options: [{ id: "approve", label: "Approve" }, { id: "decline", label: "Decline" }], recommendedOptionId: "approve", rationale: "verified", expectedImpact: null, costUsd: 0, dueAt: new Date(Date.now() + 3_600_000).toISOString(), defaultOptionId: "decline", tier: "K2", actionKind: "deploy.production", mergeKey: "golive:test" });
    const live = await recordAction(service, { companyId: owned.companyId, taskId: null, agentRole: "engineering", kind: "deploy.production", tier: "K2", description: "go live", status: "pending", decisionCardId: card.id });
    expect((await siteUrls(service, owned.companyId)).live).toBeNull();
    await recordActionTransition(service, { actionId: live, status: "executed", externalRef: "http://127.0.0.1:3101/sandbox/sites/live-x/" });
    expect(await siteUrls(owned.owner.client, owned.companyId)).toEqual({ live: "http://127.0.0.1:3101/sandbox/sites/live-x/", preview: "http://127.0.0.1:3101/sandbox/sites/abc/" });
  });

  it("DEC-1: pendingActionsForCard returns every pending head of a batch card, oldest first; settled rows drop out", async () => {
    const card = await openCard(service, { companyId: owned.companyId, taskId: null, question: "Send 2 first-contact emails?", options: [{ id: "approve", label: "Approve" }, { id: "decline", label: "Decline" }], recommendedOptionId: "approve", rationale: "batch", expectedImpact: null, costUsd: 0, dueAt: new Date(Date.now() + 3_600_000).toISOString(), defaultOptionId: "decline", tier: "K2", actionKind: "email.send.first_contact", mergeKey: "batch:b1" });
    const first = await recordAction(service, { companyId: owned.companyId, taskId: null, agentRole: "sales", kind: "email.send.first_contact", tier: "K2", description: "to a", payload: { batchId: "b1", to: "a@example.test" }, status: "pending", decisionCardId: card.id });
    const second = await recordAction(service, { companyId: owned.companyId, taskId: null, agentRole: "sales", kind: "email.send.first_contact", tier: "K2", description: "to b", payload: { batchId: "b1", to: "b@example.test" }, status: "pending", decisionCardId: card.id });
    expect((await pendingActionsForCard(owned.owner.client, card.id)).map((a) => a.id)).toEqual([first, second]);
    expect((await pendingActionForCard(service, card.id))?.id).toBe(first);
    await recordActionTransition(service, { actionId: first, status: "executed", externalRef: "sandbox:msg:a" });
    expect((await pendingActionsForCard(service, card.id)).map((a) => a.id)).toEqual([second]);
    expect((await pendingActionForCard(service, card.id))?.id).toBe(second);
    await recordActionTransition(service, { actionId: second, status: "declined" });
    expect(await pendingActionsForCard(service, card.id)).toEqual([]);
    expect(await pendingActionForCard(service, card.id)).toBeNull();
  });

  it("listActionsByKind returns chain heads of one kind inside the window, newest first", async () => {
    const sent = await listActionsByKind(owned.owner.client, owned.companyId, "email.send.first_contact", 30);
    expect(sent.map((a) => [a.description, a.status])).toEqual([
      ["to b", "declined"],
      ["to a", "executed"],
    ]);
    expect(sent.every((a) => a.kind === "email.send.first_contact")).toBe(true);
    await service.from("actions").insert({ company_id: owned.companyId, agent_role: "sales", kind: "email.send.first_contact", tier: "K1", description: "ancient", status: "executed", created_at: new Date(Date.now() - 45 * 86_400_000).toISOString() });
    expect((await listActionsByKind(service, owned.companyId, "email.send.first_contact", 30)).some((a) => a.description === "ancient")).toBe(false);
    expect((await listActionsByKind(service, owned.companyId, "email.send.first_contact", 60)).some((a) => a.description === "ancient")).toBe(true);
    expect(await listActionsByKind(stranger.client, owned.companyId, "email.send.first_contact", 30)).toEqual([]);
    await expect(listActionsByKind(service, owned.companyId, "email.send.first_contact", 0)).rejects.toThrow();
  });

  it("another owner cannot read the company's actions", async () => {
    await expect(recordAction(stranger.client, { companyId: owned.companyId, taskId: null, agentRole: "research", kind: "research", tier: "K0", description: "x", status: "executed" })).rejects.toThrow();
    expect(await listRecentActions(stranger.client, owned.companyId)).toEqual([]);
    expect((await listRecentActions(owned.owner.client, owned.companyId)).length).toBeGreaterThan(0);
  });
});
