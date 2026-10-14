import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createCompany, getCompanyBySlug, listCompanies, setKillSwitch } from "../src/companies.js";
import { createTestUser, deleteTestUser, service, type TestUser } from "./fixtures.js";

/**
 * M0 acceptance: user A cannot see, change or delete user B's company or any
 * child row; the service role can. Runs against the local Supabase stack.
 */
describe("RLS isolation between owners", () => {
  let alice: TestUser;
  let bob: TestUser;
  let aliceCompanyId: string;
  let bobCompanyId: string;

  beforeAll(async () => {
    alice = await createTestUser("alice");
    bob = await createTestUser("bob");
    aliceCompanyId = (await createCompany(alice.client, { ownerId: alice.id, name: "Alice Co", thesis: "Alice builds a queue app for clinics." })).id;
    bobCompanyId = (await createCompany(bob.client, { ownerId: bob.id, name: "Bob Co", thesis: "Bob sells cold email to agencies." })).id;
  });

  afterAll(async () => {
    await deleteTestUser(alice);
    await deleteTestUser(bob);
  });

  it("each owner lists only their own companies", async () => {
    expect((await listCompanies(alice.client)).map((c) => c.id)).toEqual([aliceCompanyId]);
    expect((await listCompanies(bob.client)).map((c) => c.id)).toEqual([bobCompanyId]);
  });

  it("an owner cannot read another owner's company by slug or id", async () => {
    const bobSlug = (await getCompanyBySlug(bob.client, "bob-co"))?.slug ?? "bob-co";
    expect(await getCompanyBySlug(alice.client, bobSlug)).toBeNull();
    const direct = await alice.client.from("companies").select("id").eq("id", bobCompanyId);
    expect(direct.data).toEqual([]);
  });

  it("an owner cannot update or delete another owner's company", async () => {
    const update = await alice.client.from("companies").update({ name: "Hacked" }).eq("id", bobCompanyId).select("id");
    expect(update.data).toEqual([]);
    const del = await alice.client.from("companies").delete().eq("id", bobCompanyId).select("id");
    expect(del.data).toEqual([]);
    const still = await service.from("companies").select("name").eq("id", bobCompanyId).single();
    expect(still.data?.name).toBe("Bob Co");
  });

  it("child rows (theses) are invisible across owners and visible to the service role", async () => {
    const mine = await alice.client.from("theses").select("company_id").eq("company_id", aliceCompanyId);
    expect(mine.data?.length).toBe(1);
    const theirs = await alice.client.from("theses").select("company_id").eq("company_id", bobCompanyId);
    expect(theirs.data).toEqual([]);
    const all = await service.from("theses").select("company_id").in("company_id", [aliceCompanyId, bobCompanyId]);
    expect(all.data?.length).toBe(2);
  });

  it("an owner cannot insert a company for someone else", async () => {
    const forged = await alice.client.from("companies").insert({ owner_id: bob.id, name: "Forged", slug: `forged-${Date.now()}` }).select("id");
    expect(forged.error).not.toBeNull();
  });

  it("the kill switch flips only the owner's company", async () => {
    await setKillSwitch(alice.client, aliceCompanyId, true);
    expect((await getCompanyBySlug(alice.client, "alice-co"))?.killSwitchActive).toBe(true);
    await expect(setKillSwitch(alice.client, bobCompanyId, true)).resolves.toBeUndefined();
    const bobs = await service.from("companies").select("kill_switch_active").eq("id", bobCompanyId).single();
    expect(bobs.data?.kill_switch_active).toBe(false);
  });

  it("creating a profile happens automatically on sign-up", async () => {
    const profile = await alice.client.from("users").select("id, email, daily_decision_quota").eq("id", alice.id).single();
    expect(profile.data).toMatchObject({ id: alice.id, email: alice.email, daily_decision_quota: 3 });
  });
});
