import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createCompany } from "../src/companies";
import { createTestUser, deleteTestUser, raw, type TestUser } from "./fixtures";

/**
 * Database-level guarantees behind the non-negotiables: DEC-1 (K2/K3 need a
 * card), DEC-3 (quota), AGT-2 (done needs evidence), append-only audit tables.
 */
describe("schema constraints", () => {
  let owner: TestUser;
  let companyId: string;
  const due = new Date(Date.now() + 86_400_000).toISOString();
  const options = [
    { id: "approve", label: "Approve" },
    { id: "decline", label: "Decline" },
  ];

  beforeAll(async () => {
    owner = await createTestUser("constraints");
    companyId = (await createCompany(owner.client, { ownerId: owner.id, name: "Constraints Co", thesis: "A company that exists to be tested thoroughly." })).id;
  });

  afterAll(async () => {
    await deleteTestUser(owner);
  });

  it("DEC-1: a K2 action without a card or auto rule is rejected; K0 is accepted", async () => {
    const k2 = await raw.from("actions").insert({ company_id: companyId, agent_role: "growth", kind: "ads.start", tier: "K2", description: "x", status: "executed" });
    expect(k2.error?.message).toMatch(/actions_tier_requires_authority/);
    const k0 = await raw.from("actions").insert({ company_id: companyId, agent_role: "research", kind: "research", tier: "K0", description: "x", status: "executed" });
    expect(k0.error).toBeNull();
  });

  it("DEC-1: a K3 action needs a card even if an auto rule exists", async () => {
    const rule = await raw.from("auto_rules").insert({ company_id: companyId, kind: "contract.sign" }).select("id").single();
    const k3 = await raw.from("actions").insert({ company_id: companyId, agent_role: "ops_finance", kind: "contract.sign", tier: "K3", description: "x", status: "executed", auto_rule_id: rule.data?.id });
    expect(k3.error?.message).toMatch(/actions_tier_requires_authority/);
  });

  it("DEC-3: the fourth card of the day is rejected at quota 3", async () => {
    const card = () =>
      raw
        .from("decision_cards")
        .insert({ company_id: companyId, action_kind: "ads.start", tier: "K2", question: "Approve?", options, recommended_option_id: "approve", default_option_id: "decline", rationale: "r", due_at: due })
        .select("seq")
        .single();
    const seqs: unknown[] = [];
    for (let i = 0; i < 3; i++) seqs.push((await card()).data?.seq);
    expect(seqs).toEqual([1, 2, 3]);
    const fourth = await card();
    expect(fourth.error?.message).toMatch(/daily decision quota/);
  });

  it("K3 cards cannot carry a default option", async () => {
    const k3 = await raw.from("decision_cards").insert({ company_id: companyId, action_kind: "data.delete", tier: "K3", question: "Delete?", options, recommended_option_id: "decline", default_option_id: "decline", rationale: "r", due_at: due, day: "2099-01-01" });
    expect(k3.error?.message).toMatch(/k3_has_no_default/);
  });

  it("AGT-2: a task cannot be done without evidence", async () => {
    const task = await raw.from("tasks").insert({ company_id: companyId, role: "research", title: "t", status: "done" });
    expect(task.error?.message).toMatch(/tasks_done_requires_evidence/);
    const ok = await raw.from("tasks").insert({ company_id: companyId, role: "research", title: "t", status: "done", evidence: { kind: "artifact_id", ref: "a1", verified: true } });
    expect(ok.error).toBeNull();
  });

  it("actions and ledger entries are append-only, even for the service role", async () => {
    const action = await raw.from("actions").insert({ company_id: companyId, agent_role: "research", kind: "research", tier: "K0", description: "x", status: "executed" }).select("id").single();
    const actionId = action.data?.id as string;
    const update = await raw.from("actions").update({ description: "tampered" }).eq("id", actionId);
    expect(update.error?.message).toMatch(/append-only/);
    const del = await raw.from("actions").delete().eq("id", actionId);
    expect(del.error?.message).toMatch(/append-only/);

    const entry = await raw.from("ledger_entries").insert({ company_id: companyId, metric_key: "signups", before_value: 0, after_value: 1, channel: "test" }).select("id").single();
    const ledgerDel = await raw.from("ledger_entries").delete().eq("id", entry.data?.id as string);
    expect(ledgerDel.error?.message).toMatch(/append-only/);
  });
});
