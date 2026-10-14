import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { listRecentActions, recordAction } from "../src/actions";
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

  it("another owner cannot read the company's actions", async () => {
    await expect(recordAction(stranger.client, { companyId: owned.companyId, taskId: null, agentRole: "research", kind: "research", tier: "K0", description: "x", status: "executed" })).rejects.toThrow();
    expect(await listRecentActions(stranger.client, owned.companyId)).toEqual([]);
    expect((await listRecentActions(owned.owner.client, owned.companyId)).length).toBeGreaterThan(0);
  });
});
