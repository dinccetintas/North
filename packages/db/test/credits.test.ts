import { consumeEntry, creditBalance as sumEntries, trialGrant } from "@north/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CreditFloorError, creditBalance, insertCreditEntries, listCreditEntries } from "../src/credits";
import { DbError } from "../src/errors";
import { createTestUser, deleteTestUser, service, type TestUser } from "./fixtures";

describe("credits repository (BIL-2: an append-only ledger)", () => {
  let owner: TestUser;
  let stranger: TestUser;

  beforeAll(async () => {
    owner = await createTestUser("credits");
    stranger = await createTestUser("credits-stranger");
  });

  afterAll(async () => {
    await deleteTestUser(owner);
    await deleteTestUser(stranger);
  });

  it("the trial grant is the first entry; a replayed ref inserts nothing and the inserted refs are returned", async () => {
    expect(await creditBalance(owner.client, owner.id)).toBe(300);
    expect(await insertCreditEntries(service, owner.id, [trialGrant(owner.id)])).toEqual([]);
    const pack = { kind: "grant_pack" as const, amount: 100, ref: "pack:cs_fake_1", note: "pack_100" };
    expect(await insertCreditEntries(service, owner.id, [pack, consumeEntry("11111111-1111-4111-8111-111111111111")])).toEqual(["pack:cs_fake_1", "run:11111111-1111-4111-8111-111111111111"]);
    expect(await insertCreditEntries(service, owner.id, [pack])).toEqual([]);
    expect(await insertCreditEntries(service, owner.id, [])).toEqual([]);
    expect(await creditBalance(service, owner.id)).toBe(399);
  });

  it("listCreditEntries is newest first with a limit and sums to the balance; owners read only their own", async () => {
    const entries = await listCreditEntries(owner.client, owner.id, { limit: 20 });
    expect(new Set(entries.map((e) => e.ref))).toEqual(new Set(["pack:cs_fake_1", "run:11111111-1111-4111-8111-111111111111", `trial:${owner.id}`]));
    expect(entries[entries.length - 1]).toMatchObject({ kind: "grant_plan", amount: 300, ref: `trial:${owner.id}`, userId: owner.id });
    expect(sumEntries(entries)).toBe(await creditBalance(owner.client, owner.id));
    expect(Object.isFrozen(entries)).toBe(true);
    expect(await listCreditEntries(owner.client, owner.id, { limit: 1 })).toHaveLength(1);
    expect(await listCreditEntries(stranger.client, owner.id)).toEqual([]);
    expect(await creditBalance(stranger.client, owner.id)).toBe(0);
  });

  it("a consume past the grace floor is refused with CreditFloorError; the floor itself is allowed; signs are checked before any write", async () => {
    await insertCreditEntries(service, owner.id, [{ kind: "adjust", amount: -399, ref: "adjust:drain", note: "test drain" }]);
    expect(await creditBalance(service, owner.id)).toBe(0);
    for (let i = 0; i < 5; i++) await insertCreditEntries(service, owner.id, [consumeEntry(`22222222-2222-4222-8222-22222222222${i}`)]);
    expect(await creditBalance(service, owner.id)).toBe(-5);
    await expect(insertCreditEntries(service, owner.id, [consumeEntry("33333333-3333-4333-8333-333333333333")])).rejects.toBeInstanceOf(CreditFloorError);
    expect(await insertCreditEntries(service, owner.id, [consumeEntry("22222222-2222-4222-8222-222222222220")])).toEqual([]);
    await expect(insertCreditEntries(service, owner.id, [{ kind: "consume", amount: 1, ref: "run:positive", note: "" }])).rejects.toThrow();
    await expect(insertCreditEntries(owner.client, owner.id, [{ kind: "grant_pack", amount: 1000, ref: "pack:forged", note: "" }])).rejects.toBeInstanceOf(DbError);
    expect(await creditBalance(service, owner.id)).toBe(-5);
  });
});
