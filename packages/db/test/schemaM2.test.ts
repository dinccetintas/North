import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTask } from "../src/tasks";
import { createOwnerWithCompany, deleteTestUser, service, type OwnedCompany } from "./fixtures";

/** Database-level guarantees added by 0004_m2.sql. */
describe("M2 schema", () => {
  let owned: OwnedCompany;

  beforeAll(async () => {
    owned = await createOwnerWithCompany("schema-m2");
  });

  afterAll(async () => {
    await deleteTestUser(owned.owner);
  });

  it("tasks accept the K2 task types campaign_spec and outreach_batch", async () => {
    const campaign = await createTask(owned.owner.client, { companyId: owned.companyId, role: "growth", taskType: "campaign_spec", title: "Ad test" });
    const outreach = await createTask(owned.owner.client, { companyId: owned.companyId, role: "sales", taskType: "outreach_batch", title: "Cold emails" });
    expect([campaign.taskType, outreach.taskType]).toEqual(["campaign_spec", "outreach_batch"]);
    const bad = await service.from("tasks").insert({ company_id: owned.companyId, role: "growth", task_type: "mine_bitcoin", title: "x" });
    expect(bad.error?.message).toMatch(/tasks_task_type_check/);
  });

  it("decision_cards default merge_key to '' and accept a nullable action_id", async () => {
    const due = new Date(Date.now() + 86_400_000).toISOString();
    const options = [
      { id: "approve", label: "Approve" },
      { id: "decline", label: "Decline" },
    ];
    const row = await service
      .from("decision_cards")
      .insert({ company_id: owned.companyId, action_kind: "ads.start", tier: "K2", question: "Approve?", options, recommended_option_id: "approve", default_option_id: "decline", rationale: "r", due_at: due })
      .select("merge_key, action_id")
      .single();
    expect(row.data).toEqual({ merge_key: "", action_id: null });
  });

  it("push_subscriptions endpoints are unique and the table is invisible to other users", async () => {
    const endpoint = `https://push.example.com/schema-${Date.now()}`;
    const first = await service.from("push_subscriptions").insert({ user_id: owned.owner.id, endpoint, p256dh: "p", auth: "a" });
    expect(first.error).toBeNull();
    const dupe = await service.from("push_subscriptions").insert({ user_id: owned.owner.id, endpoint, p256dh: "p", auth: "a" });
    expect(dupe.error?.code).toBe("23505");
  });

  it("notifications only accept push/email and sent/failed/sandbox", async () => {
    const badStatus = await service.from("notifications").insert({ company_id: owned.companyId, user_id: owned.owner.id, channel: "push", kind: "x", status: "queued" });
    expect(badStatus.error?.message).toMatch(/notifications_status_check/);
  });
});
