import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { openCard } from "../src/decisions";
import { DbError } from "../src/errors";
import { listNotifications, recordNotification } from "../src/notifications";
import { createOwnerWithCompany, createTestUser, deleteTestUser, sampleCardDraft, service, type OwnedCompany, type TestUser } from "./fixtures";

describe("notifications repository (decision/opened delivery log)", () => {
  let owned: OwnedCompany;
  let stranger: TestUser;

  beforeAll(async () => {
    owned = await createOwnerWithCompany("notifications");
    stranger = await createTestUser("notifications-stranger");
  });

  afterAll(async () => {
    await deleteTestUser(owned.owner);
    await deleteTestUser(stranger);
  });

  it("recordNotification (service role) writes the row; listNotifications returns newest first", async () => {
    const card = await openCard(service, { ...sampleCardDraft(owned.companyId), taskId: null });
    const push = await recordNotification(service, { companyId: owned.companyId, userId: owned.owner.id, channel: "push", kind: "decision_opened", cardId: card.id, payload: { title: "Decision needed" }, status: "sandbox" });
    const email = await recordNotification(service, { companyId: owned.companyId, userId: owned.owner.id, channel: "email", kind: "decision_opened", cardId: card.id, status: "failed" });
    const rows = await listNotifications(owned.owner.client, owned.companyId);
    expect(rows.map((n) => n.id)).toEqual([email, push]);
    expect(rows[1]).toEqual({
      id: push,
      companyId: owned.companyId,
      userId: owned.owner.id,
      channel: "push",
      kind: "decision_opened",
      cardId: card.id,
      payload: { title: "Decision needed" },
      status: "sandbox",
      createdAt: expect.any(String),
    });
    expect(rows[0]).toMatchObject({ channel: "email", status: "failed", cardId: card.id, payload: {} });
    expect(Object.isFrozen(rows)).toBe(true);
    expect(Object.isFrozen(rows[0])).toBe(true);
    expect(await listNotifications(owned.owner.client, owned.companyId, 1)).toHaveLength(1);
  });

  it("a notification without a card is allowed (kill switch, brief)", async () => {
    const id = await recordNotification(service, { companyId: owned.companyId, userId: owned.owner.id, channel: "email", kind: "kill_switch", status: "sent" });
    expect((await listNotifications(service, owned.companyId)).find((n) => n.id === id)?.cardId).toBeNull();
  });

  it("owners read only; inserts from an owner client are rejected and strangers see nothing", async () => {
    await expect(recordNotification(owned.owner.client, { companyId: owned.companyId, userId: owned.owner.id, channel: "push", kind: "x", status: "sent" })).rejects.toBeInstanceOf(DbError);
    expect(await listNotifications(stranger.client, owned.companyId)).toEqual([]);
  });

  it("rejects unknown channels and statuses, in Zod and in the database", async () => {
    await expect(recordNotification(service, { companyId: owned.companyId, userId: owned.owner.id, channel: "sms" as never, kind: "x", status: "sent" })).rejects.toThrow();
    await expect(recordNotification(service, { companyId: owned.companyId, userId: owned.owner.id, channel: "push", kind: "x", status: "queued" as never })).rejects.toThrow();
    const direct = await service.from("notifications").insert({ company_id: owned.companyId, user_id: owned.owner.id, channel: "sms", kind: "x", status: "sent" });
    expect(direct.error?.message).toMatch(/notifications_channel_check/);
  });
});
