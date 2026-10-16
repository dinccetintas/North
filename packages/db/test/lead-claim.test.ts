import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createAutoRule } from "../src/autoRules";
import { DbError } from "../src/errors";
import { claimLeadForContact, getLead, importLeads, markLeads, releaseLeadContact } from "../src/leads";
import { openFirstContactCard, recordAutoFirstContact } from "../src/outreach";
import { createTask } from "../src/tasks";
import { updateProfile } from "../src/users";
import { createCompanyFor, createOwnerWithCompany, deleteTestUser, grantPlan, raw, sampleCardDraft, service, type OwnedCompany } from "./fixtures";

/**
 * SLS-K2: a lead receives at most one first contact. 0018: right before the
 * provider call the worker claims the lead with one conditional write that
 * only one first-contact action can win (`new` → `contacted`, the action in
 * `contact_action_id`); the same action may claim again (a retried step) until
 * its message is recorded; a failed send releases the claim, conditionally.
 * 0017: an auto-approved first contact is recorded under the company's
 * outreach lock and refused when its recipient is held, like a card's.
 */

describe("0018: the perform-time claim of a lead", () => {
  let owned: OwnedCompany;

  beforeAll(async () => {
    owned = await createOwnerWithCompany("lead-claim");
    // 2 companies for one owner: over the Solo trial's limit (M6); the quota at its maximum for the card opens below.
    await grantPlan(owned.owner.id, "pro");
    await updateProfile(service, owned.owner.id, { dailyDecisionQuota: 5 });
  });

  afterAll(async () => {
    await deleteTestUser(owned.owner);
  });

  async function lead(email: string, companyId = owned.companyId) {
    await importLeads(service, companyId, [{ name: email, email }], "upload");
    const { data } = await service.from("leads").select("id").eq("company_id", companyId).eq("email", email).single();
    return data!.id;
  }

  it("ten concurrent claims by ten actions: exactly one wins; the lead is contacted and names its action", async () => {
    const id = await lead("race@example.test");
    const actions = Array.from({ length: 10 }, () => randomUUID());
    const won = await Promise.all(actions.map((a) => claimLeadForContact(service, owned.companyId, id, a)));
    const winners = won.filter((l) => l !== null);
    expect(winners).toHaveLength(1);
    const winner = actions[won.findIndex((l) => l !== null)]!;
    expect(winners[0]).toMatchObject({ id, status: "contacted", contactActionId: winner, messageId: null });
    expect(Object.isFrozen(winners[0])).toBe(true);
    expect(await getLead(service, owned.companyId, id)).toMatchObject({ status: "contacted", contactActionId: winner });
  });

  it("the winning action may claim again (a retried step) until its message is recorded; no other action ever can", async () => {
    const id = await lead("retry@example.test");
    const [mine, other] = [randomUUID(), randomUUID()];
    expect(await claimLeadForContact(service, owned.companyId, id, mine)).not.toBeNull();
    expect(await claimLeadForContact(service, owned.companyId, id, mine)).not.toBeNull();
    expect(await claimLeadForContact(service, owned.companyId, id, other)).toBeNull();
    expect(await markLeads(service, owned.companyId, [id], "contacted", { messageId: "sandbox:msg:retry" })).toBe(1);
    expect(await claimLeadForContact(service, owned.companyId, id, mine)).toBeNull();
  });

  it("a release frees only the claiming action's unsent claim: the lead is new again, with no claim left", async () => {
    const id = await lead("release@example.test");
    const [mine, other] = [randomUUID(), randomUUID()];
    await claimLeadForContact(service, owned.companyId, id, mine);
    expect(await releaseLeadContact(service, owned.companyId, id, other)).toBe(false);
    expect(await releaseLeadContact(service, owned.companyId, id, mine)).toBe(true);
    expect(await getLead(service, owned.companyId, id)).toMatchObject({ status: "new", contactActionId: null, messageId: null });
    expect(await releaseLeadContact(service, owned.companyId, id, mine)).toBe(false);
    // Sent (message recorded): never released.
    await claimLeadForContact(service, owned.companyId, id, other);
    await markLeads(service, owned.companyId, [id], "contacted", { messageId: "sandbox:msg:sent" });
    expect(await releaseLeadContact(service, owned.companyId, id, other)).toBe(false);
    expect((await getLead(service, owned.companyId, id))?.status).toBe("contacted");
  });

  it("is company-scoped and validated; owners cannot claim; a new lead can never carry a claim (check constraint)", async () => {
    const id = await lead("scoped@example.test");
    const foreign = await createCompanyFor(owned.owner, "lead-claim-foreign");
    expect(await claimLeadForContact(service, foreign, id, randomUUID())).toBeNull();
    await expect(claimLeadForContact(service, owned.companyId, id, "not-a-uuid")).rejects.toThrow();
    await expect(claimLeadForContact(owned.owner.client, owned.companyId, id, randomUUID())).rejects.toBeInstanceOf(DbError);
    expect((await getLead(service, owned.companyId, id))?.status).toBe("new");
    const direct = await raw.from("leads").update({ contact_action_id: randomUUID() }).eq("id", id);
    expect(direct.error?.code).toBe("23514");
  });

  it("0017: an auto-approved first contact is recorded under the outreach lock; a held recipient is refused; 6 concurrent card opens and auto records over one lead: one winner", async () => {
    const companyId = owned.companyId;
    const rule = await createAutoRule(service, { companyId, kind: "email.send.first_contact" });
    await lead("auto@example.test");
    const send = (taskId: string, autoRuleId?: string) => ({ companyId, taskId, agentRole: "sales", kind: "email.send.first_contact" as const, tier: "K2" as const, description: "Email auto", payload: { to: "auto@example.test", subject: "s", text: "t" }, ...(autoRuleId ? { autoRuleId } : {}) });
    const tasks = await Promise.all(Array.from({ length: 6 }, () => createTask(service, { companyId, role: "sales", taskType: "outreach_batch", title: "Race" })));
    const card = (taskId: string) => ({ ...sampleCardDraft(companyId, { actionKind: "email.send.first_contact", mergeKey: "email.send.first_contact:none", question: "Send 1 first-contact email?", costUsd: 0 }), taskId });
    const results = await Promise.all(tasks.map((t, i) => (i % 2 === 0 ? recordAutoFirstContact(service, send(t.id, rule.id)) : openFirstContactCard(service, { card: card(t.id), action: send(t.id) }))));
    expect(results.filter((r) => r.kind !== "held")).toHaveLength(1);
    expect(results.filter((r) => r.kind === "held").every((r) => r.kind === "held" && r.email === "auto@example.test")).toBe(true);
    const { data: pending } = await service.from("actions").select("id, auto_rule_id, decision_card_id").eq("company_id", companyId).eq("status", "pending").eq("payload->>to", "auto@example.test");
    expect(pending).toHaveLength(1);
    await expect(recordAutoFirstContact(service, send(tasks[0]!.id))).rejects.toThrow();
    await expect(recordAutoFirstContact(owned.owner.client, send(tasks[0]!.id, rule.id))).rejects.toBeInstanceOf(DbError);
  });
});
