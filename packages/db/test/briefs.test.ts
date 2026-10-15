import type { Brief } from "@north/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createBrief, getBrief, latestBrief, listBriefs, listBriefsForDay } from "../src/briefs";
import { DbError } from "../src/errors";
import { createCompanyFor, createOwnerWithCompany, createTestUser, deleteTestUser, grantPlan, service, type OwnedCompany, type TestUser } from "./fixtures";

const briefFor = (day: string, overrides: Partial<Brief> = {}): Brief => {
  const base: Brief = {
    day,
    companyName: "Briefs Co",
    stopped: false,
    blocked: null,
    yesterday: { outcomes: [], actions: [{ kind: "deploy.production", status: "executed", description: "Site went live" }] },
    metrics: [{ key: "signups", value: 5, previous: 3, measuredAt: "2026-10-18T06:00:00.000Z" }],
    goal: { metricKey: "signups", target: 50, current: 5, dueDate: "2026-12-31" },
    decisions: { pending: [], deferred: 1, answeredYesterday: 3 },
    today: [],
    spend: [{ category: "ads", spentTodayUsd: 0, dailyCapUsd: 100, spentTotalUsd: 4, totalCapUsd: 300 }],
    signals: [{ id: "sig-1", title: "Looking for a tool", source: "reddit", score: 0.85, status: "deferred" }],
    escalations: [],
    wordCount: 48,
  };
  return Object.freeze({ ...base, ...overrides });
};

describe("briefs repository (BRF-1)", () => {
  let owned: OwnedCompany;
  let stranger: TestUser;

  beforeAll(async () => {
    owned = await createOwnerWithCompany("briefs");
    stranger = await createTestUser("briefs-stranger");
  });

  afterAll(async () => {
    await deleteTestUser(owned.owner);
    await deleteTestUser(stranger);
  });

  it("getBrief and latestBrief are null before any brief exists", async () => {
    expect(await getBrief(owned.owner.client, owned.companyId, "2026-10-19")).toBeNull();
    expect(await latestBrief(owned.owner.client, owned.companyId)).toBeNull();
    expect(await listBriefs(owned.owner.client, owned.companyId, 10)).toEqual([]);
  });

  it("createBrief stores the core Brief once per company and day; a second call returns the existing row", async () => {
    const content = briefFor("2026-10-19");
    const created = await createBrief(service, { companyId: owned.companyId, day: "2026-10-19", content, wordCount: 48 });
    expect(created).toMatchObject({ companyId: owned.companyId, day: "2026-10-19", wordCount: 48, content });
    expect(typeof created.id).toBe("string");
    expect(typeof created.createdAt).toBe("string");
    expect(Object.isFrozen(created)).toBe(true);
    expect(Object.isFrozen(created.content)).toBe(true);
    const again = await createBrief(service, { companyId: owned.companyId, day: "2026-10-19", content: briefFor("2026-10-19", { wordCount: 99, stopped: true }), wordCount: 99 });
    expect(again.id).toBe(created.id);
    expect(again.wordCount).toBe(48);
    expect(again.content.stopped).toBe(false);
    const rows = await service.from("briefs").select("id").eq("company_id", owned.companyId);
    expect(rows.data?.length).toBe(1);
  });

  it("the owner reads the brief, a stranger sees nothing, and content is validated on the way out", async () => {
    const brief = await getBrief(owned.owner.client, owned.companyId, "2026-10-19");
    expect(brief?.content.signals[0]).toEqual({ id: "sig-1", title: "Looking for a tool", source: "reddit", score: 0.85, status: "deferred" });
    expect(await getBrief(stranger.client, owned.companyId, "2026-10-19")).toBeNull();
    expect(await latestBrief(stranger.client, owned.companyId)).toBeNull();
    expect(await listBriefs(stranger.client, owned.companyId, 10)).toEqual([]);
    await service.from("briefs").insert({ company_id: owned.companyId, brief_date: "2000-01-01", content: { not: "a brief" }, word_count: 0 });
    await expect(getBrief(service, owned.companyId, "2000-01-01")).rejects.toThrow();
    await service.from("briefs").delete().eq("company_id", owned.companyId).eq("brief_date", "2000-01-01");
  });

  it("latestBrief is the newest day and listBriefs is newest first with a limit", async () => {
    await createBrief(service, { companyId: owned.companyId, day: "2026-10-21", content: briefFor("2026-10-21"), wordCount: 50 });
    await createBrief(service, { companyId: owned.companyId, day: "2026-10-20", content: briefFor("2026-10-20"), wordCount: 49 });
    expect((await latestBrief(owned.owner.client, owned.companyId))?.day).toBe("2026-10-21");
    expect((await listBriefs(owned.owner.client, owned.companyId, 10)).map((b) => b.day)).toEqual(["2026-10-21", "2026-10-20", "2026-10-19"]);
    expect((await listBriefs(owned.owner.client, owned.companyId, 2)).map((b) => b.day)).toEqual(["2026-10-21", "2026-10-20"]);
  });

  it("owners cannot insert briefs and malformed input never reaches the database", async () => {
    await expect(createBrief(owned.owner.client, { companyId: owned.companyId, day: "2026-10-22", content: briefFor("2026-10-22"), wordCount: 1 })).rejects.toBeInstanceOf(DbError);
    await expect(createBrief(service, { companyId: owned.companyId, day: "22/10/2026", content: briefFor("2026-10-22"), wordCount: 1 })).rejects.toThrow();
    await expect(createBrief(service, { companyId: owned.companyId, day: "2026-10-22", content: { ...briefFor("2026-10-22"), stopped: "no" } as unknown as Brief, wordCount: 1 })).rejects.toThrow();
    await expect(createBrief(service, { companyId: owned.companyId, day: "2026-10-22", content: briefFor("2026-10-22"), wordCount: -1 })).rejects.toThrow();
    expect(await getBrief(service, owned.companyId, "2026-10-22")).toBeNull();
  });

  it("MULTI-1: listBriefsForDay gives the owner every company's brief of the day and nothing of another owner's", async () => {
    const day = "2026-11-02";
    await grantPlan(owned.owner.id, "pro");
    const second = await createCompanyFor(owned.owner, "briefs-second");
    const other = await createOwnerWithCompany("briefs-other");
    for (const companyId of [owned.companyId, second, other.companyId]) await createBrief(service, { companyId, day, content: briefFor(day), wordCount: 48 });
    await createBrief(service, { companyId: second, day: "2026-11-01", content: briefFor("2026-11-01"), wordCount: 48 });
    const mine = await listBriefsForDay(owned.owner.client, day);
    expect(new Set(mine.map((b) => b.companyId))).toEqual(new Set([owned.companyId, second]));
    expect(mine.every((b) => b.day === day)).toBe(true);
    expect(Object.isFrozen(mine)).toBe(true);
    expect((await listBriefsForDay(other.owner.client, day)).map((b) => b.companyId)).toEqual([other.companyId]);
    expect(await listBriefsForDay(stranger.client, day)).toEqual([]);
    await expect(listBriefsForDay(owned.owner.client, "02/11/2026")).rejects.toThrow();
    expect((await listBriefsForDay(owned.owner.client, "2026-11-01")).map((b) => b.companyId)).toEqual([second]);
    await deleteTestUser(other.owner);
  });
});
