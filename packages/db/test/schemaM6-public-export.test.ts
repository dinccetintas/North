import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { anon, createOwnerWithCompany, createTestUser, deleteTestUser, raw, type OwnedCompany, type RawClient, type TestUser } from "./fixtures";

const asRaw = (user: TestUser): RawClient => user.client as unknown as RawClient;
const THESIS = "Closing the books is a secret thesis nobody outside may read.";

/** 0013_m6_pages_exports_purge.sql: PUB-1 (public_page_view is the only anonymous read) and EXP-1 (exports rows and the private bucket). */
describe("M6 schema: public page and exports", () => {
  let owned: OwnedCompany;
  let stranger: TestUser;
  let slug: string;

  beforeAll(async () => {
    owned = await createOwnerWithCompany("schema-m6-public", THESIS);
    stranger = await createTestUser("schema-m6-public-stranger");
    slug = (await raw.from("companies").select("slug").eq("id", owned.companyId).single()).data!.slug;
    const day = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);
    await raw.from("goals").insert({ company_id: owned.companyId, metric_key: "signups", target_value: 50, due_date: day });
    await raw.from("metrics").insert([
      { company_id: owned.companyId, metric_key: "signups", value: 5, source: "analytics", measured_at: "2026-10-01T00:00:00Z" },
      { company_id: owned.companyId, metric_key: "signups", value: 12, source: "analytics", measured_at: "2026-10-10T00:00:00Z" },
      { company_id: owned.companyId, metric_key: "waitlist", value: 3, source: "analytics", measured_at: "2026-10-10T00:00:00Z" },
    ]);
    await raw.from("actions").insert({ company_id: owned.companyId, agent_role: "engineering", kind: "deploy.production", tier: "K1", description: "Go live", status: "executed", external_ref: "https://acme.example" });
  });

  afterAll(async () => {
    await deleteTestUser(owned.owner);
    await deleteTestUser(stranger);
  });

  it("PUB-1: public_page_view is null while the switch is off, then returns only the chosen fields to an anonymous caller, never the thesis", async () => {
    const view = async () => (await anon.rpc("public_page_view", { p_slug: slug })).data;
    expect(await view()).toBeNull();
    const page = { company_id: owned.companyId, headline: "Bookkeeping that <b>closes</b> the month", blurb: "For one-person firms.", show_goal: true, metric_keys: ["signups"], show_site_link: true };
    expect((await asRaw(owned.owner).from("public_pages").insert(page)).error).toBeNull();
    expect(await view()).toBeNull();
    expect((await asRaw(owned.owner).from("companies").update({ public_page_enabled: true }).eq("id", owned.companyId)).error).toBeNull();
    const shown = await view();
    expect(shown).toEqual({
      name: "schema-m6-public Co",
      page: { headline: page.headline, blurb: page.blurb, showGoal: true, metricKeys: ["signups"], showSiteLink: true, listed: false },
      goal: { metricKey: "signups", target: 50, current: 12 },
      metrics: [{ key: "signups", value: 12 }],
      siteUrl: "https://acme.example",
    });
    expect(JSON.stringify(shown)).not.toContain("secret thesis");
    expect((await asRaw(owned.owner).from("public_pages").update({ show_goal: false, show_site_link: false, metric_keys: [] }).eq("company_id", owned.companyId)).error).toBeNull();
    expect(await view()).toMatchObject({ goal: null, metrics: [], siteUrl: null });
    expect((await anon.rpc("public_page_view", { p_slug: "no-such-company-slug" })).data).toBeNull();
    expect((await anon.rpc("public_page_view", { p_slug: "../Bad Slug" })).data).toBeNull();
    expect((await anon.from("companies").select("id").eq("id", owned.companyId)).data ?? []).toEqual([]);
    expect((await anon.from("public_pages").select("company_id")).data ?? []).toEqual([]);
  });

  it("PUB-1: metric keys are outcome keys, at most three; a stranger cannot write the owner's page", async () => {
    const update = (keys: string[]) => asRaw(owned.owner).from("public_pages").update({ metric_keys: keys }).eq("company_id", owned.companyId);
    expect((await update(["signups", "waitlist", "mrr_usd", "demo_calls"])).error?.code).toBe("23514");
    expect((await update(["ad_spend_usd"])).error?.code).toBe("23514");
    expect((await update(["signups", "waitlist", "mrr_usd"])).error).toBeNull();
    expect((await asRaw(stranger).from("public_pages").update({ headline: "pwned" }).eq("company_id", owned.companyId).select("company_id")).data).toEqual([]);
    expect((await asRaw(stranger).from("public_pages").insert({ company_id: owned.companyId, headline: "pwned" })).error).not.toBeNull();
    expect((await raw.from("public_pages").select("headline").eq("company_id", owned.companyId).single()).data?.headline).toBe("Bookkeeping that <b>closes</b> the month");
  });

  it("PUB-1: an archived company has no public page", async () => {
    expect((await raw.from("companies").update({ status: "archived", kill_switch_active: true, paused_reason: "retention" }).eq("id", owned.companyId)).error).toBeNull();
    expect((await anon.rpc("public_page_view", { p_slug: slug })).data).toBeNull();
    expect((await raw.from("companies").update({ status: "active", kill_switch_active: false }).eq("id", owned.companyId)).error).toBeNull();
  });

  it("EXP-1: the owner inserts only a requested export of their own; the storage path is pinned to users/<userId>/exports/<id>.zip", async () => {
    const mine = asRaw(owned.owner);
    const ok = await mine.from("exports").insert({ user_id: owned.owner.id, kind: "full", company_id: null }).select("id, status").single();
    expect(ok.data?.status).toBe("requested");
    expect((await mine.from("exports").insert({ user_id: owned.owner.id, kind: "full", status: "ready" })).error).not.toBeNull();
    expect((await mine.from("exports").insert({ user_id: owned.owner.id, kind: "data", storage_path: "users/x/exports/y.zip" })).error).not.toBeNull();
    expect((await mine.from("exports").insert({ user_id: stranger.id, kind: "data" })).error).not.toBeNull();
    const foreign = await createOwnerWithCompany("schema-m6-export-foreign");
    expect((await mine.from("exports").insert({ user_id: owned.owner.id, kind: "data", company_id: foreign.companyId })).error).not.toBeNull();
    await deleteTestUser(foreign.owner);
    expect((await mine.from("exports").update({ status: "ready" }).eq("id", ok.data!.id)).error?.code).toBe("42501");
    const elsewhere = await raw.from("exports").update({ storage_path: `users/${stranger.id}/exports/${ok.data!.id}.zip` }).eq("id", ok.data!.id);
    expect(elsewhere.error?.code).toBe("23514");
    const incomplete = await raw.from("exports").update({ status: "ready" }).eq("id", ok.data!.id);
    expect(incomplete.error?.code).toBe("23514");
  });

  it("EXP-1: a ready export is downloadable through the owner's signed URL; a stranger sees no row and gets no URL", async () => {
    // M6 review M4: one open export per user; the previous test left one requested.
    await raw.from("exports").update({ status: "failed", error: "test" }).eq("user_id", owned.owner.id).in("status", ["requested", "running"]);
    const created = await asRaw(owned.owner).from("exports").insert({ user_id: owned.owner.id, kind: "data" }).select("id").single();
    const path = `users/${owned.owner.id}/exports/${created.data!.id}.zip`;
    expect((await raw.storage.from("exports").upload(path, new Blob(["PK-zip"], { type: "application/zip" }), { contentType: "application/zip" })).error).toBeNull();
    const ready = await raw
      .from("exports")
      .update({ status: "ready", storage_path: path, bytes: 6, manifest: { files: [], companies: [], generatedAt: new Date().toISOString() }, expires_at: new Date(Date.now() + 7 * 86_400_000).toISOString() })
      .eq("id", created.data!.id);
    expect(ready.error).toBeNull();
    const signed = await owned.owner.client.storage.from("exports").createSignedUrl(path, 3600);
    expect(signed.error).toBeNull();
    const body = await fetch(signed.data!.signedUrl);
    expect(body.status).toBe(200);
    expect(await body.text()).toBe("PK-zip");
    expect((await asRaw(stranger).from("exports").select("id").eq("id", created.data!.id)).data).toEqual([]);
    expect((await stranger.client.storage.from("exports").createSignedUrl(path, 3600)).data?.signedUrl ?? null).toBeNull();
    expect((await anon.storage.from("exports").createSignedUrl(path, 3600)).data?.signedUrl ?? null).toBeNull();
    expect((await owned.owner.client.storage.from("exports").upload(`users/${owned.owner.id}/exports/forged.zip`, new Blob(["x"]))).error).not.toBeNull();
  });
});
