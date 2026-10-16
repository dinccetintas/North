import { usageAlertDue } from "@north/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DbError } from "../src/errors";
import { applyUsage, getUsage, listUsage, listUsageToAlert, markUsageAlerted } from "../src/usage";
import { maxRowsServiceClient, POSTGREST_MAX_ROWS } from "./max-rows";
import { createTestUser, deleteTestUser, service, type TestUser } from "./fixtures";

describe("usage repository (BIL-2: the usage projection)", () => {
  let owner: TestUser;
  let stranger: TestUser;

  beforeAll(async () => {
    owner = await createTestUser("usage");
    stranger = await createTestUser("usage-stranger");
  });

  afterAll(async () => {
    await deleteTestUser(owner);
    await deleteTestUser(stranger);
  });

  it("applyUsage adds one run's credits, cost and sandbox minutes to the owner-local month (service role only)", async () => {
    const first = await applyUsage(service, { userId: owner.id, period: "2026-11", credits: 1, costUsd: 60, sandboxMinutes: 0 });
    expect(first).toEqual({ userId: owner.id, period: "2026-11", creditsUsed: 1, llmCostUsd: 60, sandboxMinutes: 0, alertedAt: null });
    expect(Object.isFrozen(first)).toBe(true);
    const second = await applyUsage(service, { userId: owner.id, period: "2026-11", credits: 1, costUsd: 60, sandboxMinutes: 3.5 });
    expect(second).toMatchObject({ creditsUsed: 2, llmCostUsd: 120, sandboxMinutes: 3.5 });
    await applyUsage(service, { userId: owner.id, period: "2026-10", credits: 4, costUsd: 1.25, sandboxMinutes: 0 });
    await expect(applyUsage(owner.client, { userId: owner.id, period: "2026-11", credits: 1, costUsd: 0, sandboxMinutes: 0 })).rejects.toBeInstanceOf(DbError);
    await expect(applyUsage(service, { userId: owner.id, period: "2026-11", credits: -1, costUsd: 0, sandboxMinutes: 0 })).rejects.toThrow();
    await expect(applyUsage(service, { userId: owner.id, period: "Nov 2026", credits: 1, costUsd: 0, sandboxMinutes: 0 })).rejects.toThrow();
  });

  it("getUsage and listUsage read the owner's months newest first; a stranger reads nothing", async () => {
    expect(await getUsage(owner.client, owner.id, "2026-11")).toMatchObject({ creditsUsed: 2, llmCostUsd: 120 });
    expect(await getUsage(owner.client, owner.id, "2026-09")).toBeNull();
    expect((await listUsage(owner.client, owner.id, 12)).map((u) => u.period)).toEqual(["2026-11", "2026-10"]);
    expect((await listUsage(owner.client, owner.id, 1)).map((u) => u.period)).toEqual(["2026-11"]);
    expect(await getUsage(stranger.client, owner.id, "2026-11")).toBeNull();
    expect(await listUsage(stranger.client, owner.id, 12)).toEqual([]);
  });

  it("the 40 % alert goes out once per period: listUsageToAlert lists unalerted rows, markUsageAlerted claims the period once", async () => {
    const usage = (await getUsage(service, owner.id, "2026-11"))!;
    expect(usageAlertDue(usage, 299, usage.alertedAt)).toBe(true);
    expect((await listUsageToAlert(service, ["2026-11"])).some((u) => u.userId === owner.id)).toBe(true);
    expect(await markUsageAlerted(service, owner.id, "2026-11", new Date("2026-11-20T10:41:00.000Z"))).toBe(true);
    expect(await markUsageAlerted(service, owner.id, "2026-11", new Date("2026-11-20T11:41:00.000Z"))).toBe(false);
    const alerted = (await getUsage(owner.client, owner.id, "2026-11"))!;
    expect(new Date(alerted.alertedAt!).toISOString()).toBe("2026-11-20T10:41:00.000Z");
    expect(usageAlertDue(alerted, 299, alerted.alertedAt)).toBe(false);
    expect((await listUsageToAlert(service, ["2026-11"])).some((u) => u.userId === owner.id)).toBe(false);
    expect(await markUsageAlerted(service, owner.id, "2030-01", new Date())).toBe(false);
    await expect(markUsageAlerted(owner.client, owner.id, "2026-10", new Date())).rejects.toBeInstanceOf(DbError);
  });

  it(`listUsageToAlert reads every unalerted row in pages under PostgREST's cap of ${POSTGREST_MAX_ROWS} (it asks again until a page is empty)`, async () => {
    await applyUsage(service, { userId: owner.id, period: "2026-12", credits: 1, costUsd: 0.5, sandboxMinutes: 0 });
    const capped = maxRowsServiceClient();
    const rows = await listUsageToAlert(capped.client, ["2026-12"]);
    expect(rows.some((u) => u.userId === owner.id && u.period === "2026-12")).toBe(true);
    expect(capped.limits.length).toBeGreaterThanOrEqual(2);
    expect(capped.limits.every((limit) => limit <= POSTGREST_MAX_ROWS)).toBe(true);
    expect(capped.cut).toEqual([]);
  });
});
