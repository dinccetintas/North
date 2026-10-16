import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { recordAction, recordActionTransition } from "../src/actions";
import { openCard } from "../src/decisions";
import { importLeads, listLeads } from "../src/leads";
import { heldOutreachRecipients, leadsFreeForOutreach } from "../src/outreach";
import { createTask } from "../src/tasks";
import { createCompanyFor, createOwnerWithCompany, deleteTestUser, grantPlan, sampleCardDraft, service, type OwnedCompany } from "./fixtures";
import { maxRowsServiceClient, POSTGREST_MAX_ROWS } from "./max-rows";

/**
 * SLS-K2 / DEC-3: a lead is in at most one open first-contact batch. A
 * pending `email.send.first_contact` (its card is open, or the approved send
 * is about to be performed) holds every address on its batch's recipient
 * list; `leadsFreeForOutreach` hands the next batch only the oldest `new`
 * leads nobody holds, reading past PostgREST's 1000 rows.
 */

const emails = (names: readonly string[]) => names.map((n) => `${n}@example.test`);
/** An id that sorts after every random v4 id, so the row lands behind the first page of an `order by id` read. */
const lastId = () => `ffffffff-ffff-4fff-8fff-${randomBytes(6).toString("hex")}`;

async function batchCard(companyId: string) {
  const task = await createTask(service, { companyId, role: "sales", taskType: "outreach_batch", title: "Outreach batch" });
  const card = await openCard(service, { ...sampleCardDraft(companyId, { actionKind: "email.send.first_contact", mergeKey: "email.send.first_contact:none", question: "Send 5 first-contact emails?" }), taskId: task.id });
  return { taskId: task.id, cardId: card.id };
}

describe("SLS-K2: leads held by an open first-contact batch", () => {
  let owned: OwnedCompany;

  beforeAll(async () => {
    owned = await createOwnerWithCompany("outreach-hold");
    // 2 companies for one owner: over the Solo trial's limit (M6).
    await grantPlan(owned.owner.id, "pro");
  });

  afterAll(async () => {
    await deleteTestUser(owned.owner);
  });

  it("a pending first contact holds its whole recipient list; the owner and the worker see the same free leads; a declined send frees them", async () => {
    const { companyId } = owned;
    await importLeads(owned.owner.client, companyId, emails(["a", "b", "c", "d", "e", "f", "g"]).map((email) => ({ name: email, email })), "upload");
    const { taskId, cardId } = await batchCard(companyId);
    const recipients = emails(["a", "b", "c", "d", "e"]);
    const pending = await recordAction(service, { companyId, taskId, agentRole: "sales", kind: "email.send.first_contact", tier: "K2", description: "Email a", status: "pending", decisionCardId: cardId, payload: { batchId: "batch-1", recipients, to: recipients[0], subject: "s", text: "t" } });
    // Blocked and executed first contacts hold nothing.
    await recordAction(service, { companyId, taskId, agentRole: "sales", kind: "email.send.first_contact", tier: "K2", description: "Email g", status: "blocked", payload: { batchId: "batch-0", recipients: emails(["g"]), to: "g@example.test" } });

    expect([...(await heldOutreachRecipients(service, companyId))].sort()).toEqual(recipients);
    expect((await leadsFreeForOutreach(service, companyId, 5)).map((l) => l.email)).toEqual(emails(["f", "g"]));
    expect((await leadsFreeForOutreach(owned.owner.client, companyId, 5)).map((l) => l.email)).toEqual(emails(["f", "g"]));
    expect((await leadsFreeForOutreach(service, companyId, 1)).map((l) => l.email)).toEqual(emails(["f"]));

    await recordActionTransition(service, { actionId: pending, status: "declined" });
    expect((await heldOutreachRecipients(service, companyId)).size).toBe(0);
    expect((await leadsFreeForOutreach(service, companyId, 5)).map((l) => l.email)).toEqual(recipients);
    expect(Object.isFrozen(await leadsFreeForOutreach(service, companyId, 5))).toBe(true);
  });

  it("validates its input: a non-uuid company and a batch larger than fifty are refused", async () => {
    await expect(leadsFreeForOutreach(service, "not-a-uuid", 5)).rejects.toThrow();
    await expect(leadsFreeForOutreach(service, owned.companyId, 51)).rejects.toThrow();
    await expect(heldOutreachRecipients(service, "not-a-uuid")).rejects.toThrow();
  });

  it("reads past PostgREST's 1000 rows: pending sends behind 1000 settled ones still hold, 1000 held leads are skipped, and no read exceeds the cap", async () => {
    const companyId = await createCompanyFor(owned.owner, "outreach-paging");
    for (let i = 0; i < 3; i += 1) {
      const rows = Array.from({ length: i < 2 ? 500 : 1 }, (_, j) => ({ name: `L${i}-${j}`, email: `l${i}-${String(j).padStart(3, "0")}@example.test` }));
      await importLeads(service, companyId, rows, "upload");
    }
    const ordered = [...(await listLeads(service, companyId, { status: ["new"], limit: 1000 })), ...(await listLeads(service, companyId, { status: ["new"], limit: 1000, offset: 1000 }))];
    expect(ordered).toHaveLength(1001);

    const settled = Array.from({ length: POSTGREST_MAX_ROWS }, (_, i) => ({ company_id: companyId, agent_role: "sales", kind: "email.send.first_contact", tier: "K2" as const, description: `Old email ${i}`, status: "blocked", payload: { to: `old-${i}@example.test` } }));
    expect((await service.from("actions").insert(settled)).error).toBeNull();
    const { taskId, cardId } = await batchCard(companyId);
    const held = ordered.slice(0, 1000).map((l) => l.email);
    const sends = Array.from({ length: 20 }, (_, i) => {
      const recipients = held.slice(i * 50, i * 50 + 50);
      return { id: lastId(), company_id: companyId, task_id: taskId, agent_role: "sales", kind: "email.send.first_contact", tier: "K2" as const, description: `Email ${recipients[0]}`, status: "pending", decision_card_id: cardId, payload: { batchId: `batch-${i}`, recipients, to: recipients[0] } };
    });
    expect((await service.from("actions").insert(sends)).error).toBeNull();

    const capped = maxRowsServiceClient();
    expect((await heldOutreachRecipients(capped.client, companyId)).size).toBe(1000);
    expect((await leadsFreeForOutreach(capped.client, companyId, 5)).map((l) => l.email)).toEqual([ordered[1000]!.email]);
    expect(capped.limits.every((limit) => limit <= POSTGREST_MAX_ROWS)).toBe(true);
    expect(capped.cut).toEqual([]);
  });
});
