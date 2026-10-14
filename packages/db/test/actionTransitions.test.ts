import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { listRecentActions, recordAction, recordActionTransition } from "../src/actions";
import { openCard } from "../src/decisions";
import { DbError } from "../src/errors";
import { createTask } from "../src/tasks";
import { createCompanyFor, createOwnerWithCompany, createTestUser, deleteTestUser, sampleCardDraft, service, type OwnedCompany, type TestUser } from "./fixtures";

describe("action state chains (audit NFR: actions stay append-only)", () => {
  let owned: OwnedCompany;
  let stranger: TestUser;

  beforeAll(async () => {
    owned = await createOwnerWithCompany("transitions");
    stranger = await createTestUser("transitions-stranger");
  });

  afterAll(async () => {
    await deleteTestUser(owned.owner);
    await deleteTestUser(stranger);
  });

  it("recordActionTransition appends a row superseding the original; listRecentActions shows only the latest state", async () => {
    const companyId = await createCompanyFor(owned.owner, "chain");
    const task = await createTask(service, { companyId, role: "growth", taskType: "campaign_spec", title: "Ad test" });
    const card = await openCard(service, { ...sampleCardDraft(companyId), taskId: task.id });
    const pending = await recordAction(owned.owner.client, { companyId, taskId: task.id, agentRole: "growth", kind: "ads.start", tier: "K2", description: "Start ads", status: "pending", decisionCardId: card.id, payload: { amountUsd: 10 } });
    const executed = await recordActionTransition(owned.owner.client, { actionId: pending, status: "executed", externalRef: "sandbox:campaign-1", note: "approved by user" });

    const recent = await listRecentActions(owned.owner.client, companyId);
    expect(recent.map((a) => a.id)).toEqual([executed]);
    expect(recent[0]).toMatchObject({
      supersedes: pending,
      status: "executed",
      externalRef: "sandbox:campaign-1",
      kind: "ads.start",
      tier: "K2",
      agentRole: "growth",
      taskId: task.id,
      description: "Start ads",
      decisionCardId: card.id,
      autoRuleId: null,
      sandbox: true,
      payload: { supersedes: pending, note: "approved by user" },
    });
    const all = await service.from("actions").select("id, supersedes").eq("company_id", companyId);
    expect(all.data).toHaveLength(2);
    expect(all.data?.find((r) => r.id === pending)?.supersedes).toBeNull();
  });

  it("a chain grows one row at a time; superseding the same row twice is refused in code and in the database", async () => {
    const companyId = await createCompanyFor(owned.owner, "linear");
    const first = await recordAction(service, { companyId, taskId: null, agentRole: "engineering", kind: "deploy.preview", tier: "K1", description: "Deploy preview", status: "notified" });
    const second = await recordActionTransition(service, { actionId: first, status: "executed", externalRef: "sandbox:deploy-1" });
    const third = await recordActionTransition(service, { actionId: second, status: "failed", note: "build failed" });
    await expect(recordActionTransition(service, { actionId: first, status: "declined" })).rejects.toBeInstanceOf(DbError);
    const direct = await service.from("actions").insert({ company_id: companyId, agent_role: "engineering", kind: "deploy.preview", tier: "K1", description: "Deploy preview", status: "declined", supersedes: second });
    expect(direct.error?.code).toBe("23505");

    const recent = await listRecentActions(service, companyId);
    expect(recent.map((a) => a.id)).toEqual([third]);
    expect(recent[0]).toMatchObject({ supersedes: second, status: "failed", externalRef: "sandbox:deploy-1", payload: { supersedes: second, note: "build failed" } });
  });

  it("unsuperseded actions keep appearing next to chain heads, newest first, with supersedes null", async () => {
    const companyId = await createCompanyFor(owned.owner, "mixed");
    const lone = await recordAction(service, { companyId, taskId: null, agentRole: "research", kind: "research", tier: "K0", description: "Searched", status: "executed" });
    const pending = await recordAction(service, { companyId, taskId: null, agentRole: "sales", kind: "email.send.first_contact", tier: "K2", description: "Email", status: "blocked" });
    const declined = await recordActionTransition(service, { actionId: pending, status: "declined" });
    const recent = await listRecentActions(service, companyId);
    expect(recent.map((a) => a.id)).toEqual([declined, lone]);
    expect(recent[1]?.supersedes).toBeNull();
  });

  it("unknown, invisible or malformed transitions throw and write nothing", async () => {
    const pending = await recordAction(service, { companyId: owned.companyId, taskId: null, agentRole: "research", kind: "research", tier: "K0", description: "x", status: "executed" });
    await expect(recordActionTransition(stranger.client, { actionId: pending, status: "failed" })).rejects.toBeInstanceOf(DbError);
    await expect(recordActionTransition(service, { actionId: "00000000-0000-0000-0000-000000000000", status: "failed" })).rejects.toBeInstanceOf(DbError);
    await expect(recordActionTransition(service, { actionId: pending, status: "done" as never })).rejects.toThrow();
    const rows = await service.from("actions").select("id").eq("company_id", owned.companyId);
    expect(rows.data).toHaveLength(1);
  });
});
