import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DbError } from "../src/errors";
import { getPublicPage, publicPageView, setPublicPageEnabled, upsertPublicPage } from "../src/publicPages";
import { anon, createOwnerWithCompany, createTestUser, deleteTestUser, raw, type OwnedCompany, type TestUser } from "./fixtures";

const page = { headline: "Bookkeeping that <b>closes</b> the month", blurb: "For one-person firms.", showGoal: true, metricKeys: ["signups" as const], showSiteLink: true, listed: false };

describe("public pages repository (PUB-1)", () => {
  let owned: OwnedCompany;
  let stranger: TestUser;
  let slug: string;

  beforeAll(async () => {
    owned = await createOwnerWithCompany("public-pages", "A thesis that must never appear on the public page.");
    stranger = await createTestUser("public-pages-stranger");
    slug = (await raw.from("companies").select("slug").eq("id", owned.companyId).single()).data!.slug;
    await raw.from("goals").insert({ company_id: owned.companyId, metric_key: "signups", target_value: 40, due_date: "2027-01-01" });
    await raw.from("metrics").insert({ company_id: owned.companyId, metric_key: "signups", value: 9, source: "analytics" });
    await raw.from("actions").insert({ company_id: owned.companyId, agent_role: "engineering", kind: "deploy.production", tier: "K1", description: "Go live", status: "executed", external_ref: "http://insecure.example" });
  });

  afterAll(async () => {
    await deleteTestUser(owned.owner);
    await deleteTestUser(stranger);
  });

  it("the owner writes the page through the core schema; nothing is public until the switch is on", async () => {
    expect(await getPublicPage(owned.owner.client, owned.companyId)).toBeNull();
    const saved = await upsertPublicPage(owned.owner.client, owned.companyId, page);
    expect(saved).toEqual(page);
    expect(Object.isFrozen(saved)).toBe(true);
    expect(await upsertPublicPage(owned.owner.client, owned.companyId, { ...page, blurb: "Updated." })).toMatchObject({ blurb: "Updated." });
    await expect(upsertPublicPage(owned.owner.client, owned.companyId, { ...page, metricKeys: ["signups", "waitlist", "mrr_usd", "demo_calls"] })).rejects.toThrow();
    await expect(upsertPublicPage(owned.owner.client, owned.companyId, { ...page, headline: "x".repeat(121) })).rejects.toThrow();
    await expect(upsertPublicPage(stranger.client, owned.companyId, page)).rejects.toBeInstanceOf(DbError);
    expect(await getPublicPage(stranger.client, owned.companyId)).toBeNull();
    expect(await publicPageView(anon, slug)).toBeNull();
  });

  it("publicPageView (anonymous) renders the owner's choice as plain text: the goal, one metric, no insecure site link, never the thesis", async () => {
    await setPublicPageEnabled(owned.owner.client, owned.companyId, true);
    const view = await publicPageView(anon, slug);
    expect(view).toEqual({ name: "public-pages Co", headline: page.headline, blurb: "Updated.", goal: { metricKey: "signups", target: 40, current: 9 }, metrics: [{ key: "signups", value: 9 }], siteUrl: null, listed: false });
    expect(Object.isFrozen(view)).toBe(true);
    expect(JSON.stringify(view)).not.toContain("never appear");
    expect(await publicPageView(anon, "UPPER CASE")).toBeNull();
    await expect(setPublicPageEnabled(stranger.client, owned.companyId, false)).rejects.toBeInstanceOf(DbError);
    await setPublicPageEnabled(owned.owner.client, owned.companyId, false);
    expect(await publicPageView(anon, slug)).toBeNull();
  });
});
