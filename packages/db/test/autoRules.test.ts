import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createAutoRule, deactivateAutoRule, listActiveAutoRules } from "../src/autoRules";
import { openCard } from "../src/decisions";
import { DbError } from "../src/errors";
import { createOwnerWithCompany, createTestUser, deleteTestUser, sampleCardDraft, service, type OwnedCompany, type TestUser } from "./fixtures";

describe("auto rules repository (DEC-3)", () => {
  let owned: OwnedCompany;
  let stranger: TestUser;

  beforeAll(async () => {
    owned = await createOwnerWithCompany("autorules");
    stranger = await createTestUser("autorules-stranger");
  });

  afterAll(async () => {
    await deleteTestUser(owned.owner);
    await deleteTestUser(stranger);
  });

  it("createAutoRule + listActiveAutoRules return the core AutoRule shape without undefined keys", async () => {
    const capped = await createAutoRule(owned.owner.client, { companyId: owned.companyId, kind: "ads.start", maxAmountUsd: 50, category: "ads" });
    const bare = await createAutoRule(owned.owner.client, { companyId: owned.companyId, kind: "email.send.first_contact" });
    const rules = await listActiveAutoRules(owned.owner.client, owned.companyId);
    expect(rules).toEqual(
      expect.arrayContaining([
        { id: capped.id, kind: "ads.start", maxAmountUsd: 50, category: "ads", active: true },
        { id: bare.id, kind: "email.send.first_contact", active: true },
      ]),
    );
    expect(rules.find((r) => r.id === bare.id)).not.toHaveProperty("maxAmountUsd");
    expect(rules.find((r) => r.id === bare.id)).not.toHaveProperty("category");
    expect(Object.isFrozen(rules)).toBe(true);
  });

  it("createdFromCardId links the rule to the card that produced it", async () => {
    const card = await openCard(service, { ...sampleCardDraft(owned.companyId), taskId: null });
    const rule = await createAutoRule(owned.owner.client, { companyId: owned.companyId, kind: "ads.start", maxAmountUsd: 10, createdFromCardId: card.id });
    const row = await service.from("auto_rules").select("created_from_card_id, active").eq("id", rule.id).single();
    expect(row.data).toEqual({ created_from_card_id: card.id, active: true });
  });

  it("deactivateAutoRule hides the rule from the active list; an unknown rule throws", async () => {
    const rule = await createAutoRule(owned.owner.client, { companyId: owned.companyId, kind: "social.publish" });
    await deactivateAutoRule(owned.owner.client, owned.companyId, rule.id);
    expect((await listActiveAutoRules(owned.owner.client, owned.companyId)).some((r) => r.id === rule.id)).toBe(false);
    const row = await service.from("auto_rules").select("active").eq("id", rule.id).single();
    expect(row.data?.active).toBe(false);
    await expect(deactivateAutoRule(owned.owner.client, owned.companyId, "00000000-0000-0000-0000-000000000000")).rejects.toBeInstanceOf(DbError);
  });

  it("rejects unknown kinds, negative amounts and unknown categories", async () => {
    await expect(createAutoRule(service, { companyId: owned.companyId, kind: "mine.bitcoin" as never })).rejects.toThrow();
    await expect(createAutoRule(service, { companyId: owned.companyId, kind: "ads.start", maxAmountUsd: -1 })).rejects.toThrow();
    await expect(createAutoRule(service, { companyId: owned.companyId, kind: "ads.start", category: "crypto" as never })).rejects.toThrow();
  });

  it("a stranger cannot create, list or deactivate the company's rules", async () => {
    await expect(createAutoRule(stranger.client, { companyId: owned.companyId, kind: "ads.start" })).rejects.toBeInstanceOf(DbError);
    expect(await listActiveAutoRules(stranger.client, owned.companyId)).toEqual([]);
    const [rule] = await listActiveAutoRules(service, owned.companyId);
    await expect(deactivateAutoRule(stranger.client, owned.companyId, rule!.id)).rejects.toBeInstanceOf(DbError);
    expect((await listActiveAutoRules(service, owned.companyId)).some((r) => r.id === rule!.id)).toBe(true);
  });
});
