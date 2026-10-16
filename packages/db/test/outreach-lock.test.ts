import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { recordActionTransition } from "../src/actions";
import { openCard, QuotaExceededError } from "../src/decisions";
import { DbError } from "../src/errors";
import { importLeads } from "../src/leads";
import { countLeadsFreeForOutreach, heldOutreachRecipients, openFirstContactCard, type FirstContactOpen } from "../src/outreach";
import { createTask } from "../src/tasks";
import { updateProfile } from "../src/users";
import { createCompanyFor, createOwnerWithCompany, createTestUser, deleteTestUser, grantPlan, sampleCardDraft, service, type OwnedCompany, type TestUser } from "./fixtures";

/**
 * 0017_outreach_batch_lock.sql (SLS-K2 / DEC-3): opening a first contact's
 * card is one transaction under the company's outreach lock: the recipients
 * are checked against every pending first contact, then the card and its
 * pending action are written together. Concurrent opens over the same people
 * open one card; the rest are refused `held` and spend no decision.
 */

const emails = (names: readonly string[]) => names.map((n) => `${n}@example.test`);
const firstContactCard = (companyId: string, taskId: string) => ({
  ...sampleCardDraft(companyId, { actionKind: "email.send.first_contact", mergeKey: "email.send.first_contact:none", question: "Send 2 first-contact emails?", costUsd: 0 }),
  taskId,
});
const firstContact = (companyId: string, taskId: string, recipients: readonly string[], batchId = `batch-${taskId}`) => ({
  companyId,
  taskId,
  agentRole: "sales",
  kind: "email.send.first_contact" as const,
  tier: "K2" as const,
  description: `Email ${recipients[0]}`,
  payload: { batchId, recipients, to: recipients[0], subject: "s", text: "t" },
});

async function open(companyId: string, recipients: readonly string[]): Promise<FirstContactOpen> {
  const task = await createTask(service, { companyId, role: "sales", taskType: "outreach_batch", title: "Outreach batch" });
  return openFirstContactCard(service, { card: firstContactCard(companyId, task.id), action: firstContact(companyId, task.id, recipients) });
}

async function cardsAndPending(companyId: string) {
  const cards = await service.from("decision_cards").select("id").eq("company_id", companyId);
  const pending = await service.from("actions").select("id, decision_card_id").eq("company_id", companyId).eq("kind", "email.send.first_contact").eq("status", "pending");
  return { cards: cards.data ?? [], pending: pending.data ?? [] };
}

describe("0017: a first contact's card opens atomically under the company's outreach lock", () => {
  let owned: OwnedCompany;
  let stranger: TestUser;

  beforeAll(async () => {
    owned = await createOwnerWithCompany("outreach-lock");
    // 4 companies for one owner: over the Solo trial's and Pro's limits (M6); the quota at its maximum so only the lock can refuse.
    await grantPlan(owned.owner.id, "scale");
    await updateProfile(service, owned.owner.id, { dailyDecisionQuota: 5 });
    stranger = await createTestUser("outreach-lock-stranger");
  });

  afterAll(async () => {
    await deleteTestUser(owned.owner);
    await deleteTestUser(stranger);
  });

  it("ten concurrent opens over the same recipients open exactly one card and one pending row; the other nine are refused held", async () => {
    const { companyId } = owned;
    await importLeads(service, companyId, emails(["a", "b"]).map((email) => ({ name: email, email })), "upload");
    const results = await Promise.all(Array.from({ length: 10 }, () => open(companyId, emails(["a", "b"]))));

    const opened = results.filter((r): r is Extract<FirstContactOpen, { kind: "opened" }> => r.kind === "opened");
    expect(opened).toHaveLength(1);
    expect(results.filter((r) => r.kind === "held").map((r) => (r.kind === "held" ? r.email : ""))).toEqual(Array(9).fill("a@example.test"));
    const { cards, pending } = await cardsAndPending(companyId);
    expect(cards.map((c) => c.id)).toEqual([opened[0]!.card.id]);
    expect(pending).toEqual([{ id: opened[0]!.actionId, decision_card_id: opened[0]!.card.id }]);
    expect(opened[0]!.card).toMatchObject({ companyId, actionKind: "email.send.first_contact", tier: "K2", seq: 1 });
    expect(Object.isFrozen(opened[0])).toBe(true);
    expect([...(await heldOutreachRecipients(service, companyId))].sort()).toEqual(emails(["a", "b"]));
    expect(await countLeadsFreeForOutreach(service, companyId)).toBe(0);

    // Settled, the recipients are free again; an overlapping batch now opens its own card.
    await recordActionTransition(service, { actionId: opened[0]!.actionId, status: "declined" });
    expect(await countLeadsFreeForOutreach(service, companyId)).toBe(2);
    expect((await open(companyId, emails(["b", "c"]))).kind).toBe("opened");
    expect((await open(companyId, emails(["c"]))).kind).toBe("held");
  });

  it("holds compare lowercased addresses, and a single send without batchId holds its recipient", async () => {
    const companyId = await createCompanyFor(owned.owner, "outreach-lock-case");
    const task = await createTask(service, { companyId, role: "sales", taskType: "outreach_batch", title: "Single send" });
    const single = { ...firstContact(companyId, task.id, ["Mara@Example.test"]), payload: { to: "Mara@Example.test", subject: "s", text: "t" } };
    expect((await openFirstContactCard(service, { card: firstContactCard(companyId, task.id), action: single })).kind).toBe("opened");
    expect([...(await heldOutreachRecipients(service, companyId))]).toEqual(["mara@example.test"]);
    expect(await open(companyId, ["mara@example.test", "dev@example.test"])).toEqual({ kind: "held", email: "mara@example.test" });
  });

  it("a spent quota writes neither the card nor the action (one transaction) and surfaces QuotaExceededError", async () => {
    const companyId = await createCompanyFor(owned.owner, "outreach-lock-quota");
    await updateProfile(service, owned.owner.id, { dailyDecisionQuota: 1 });
    try {
      await openCard(service, { ...sampleCardDraft(companyId), taskId: null });
      await expect(open(companyId, emails(["q"]))).rejects.toBeInstanceOf(QuotaExceededError);
      const { cards, pending } = await cardsAndPending(companyId);
      expect(cards).toHaveLength(1);
      expect(pending).toEqual([]);
    } finally {
      await updateProfile(service, owned.owner.id, { dailyDecisionQuota: 5 });
    }
  });

  it("only the service role opens; the input must be one company's first contact; owners read their own holds, strangers none", async () => {
    const { companyId } = owned;
    const task = await createTask(service, { companyId, role: "sales", taskType: "outreach_batch", title: "Refused" });
    await expect(openFirstContactCard(owned.owner.client, { card: firstContactCard(companyId, task.id), action: firstContact(companyId, task.id, emails(["z"])) })).rejects.toBeInstanceOf(DbError);
    const other = await createCompanyFor(owned.owner, "outreach-lock-other");
    await expect(openFirstContactCard(service, { card: firstContactCard(companyId, task.id), action: firstContact(other, task.id, emails(["z"])) })).rejects.toThrow();
    await expect(openFirstContactCard(service, { card: firstContactCard(companyId, task.id), action: { ...firstContact(companyId, task.id, emails(["z"])), kind: "email.send.reply" as never } })).rejects.toThrow();
    expect((await heldOutreachRecipients(owned.owner.client, companyId)).size).toBeGreaterThan(0);
    expect((await heldOutreachRecipients(stranger.client, companyId)).size).toBe(0);
    expect((await cardsAndPending(companyId)).pending.every((p) => p.decision_card_id !== null)).toBe(true);
  });
});
