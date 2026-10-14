import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { latestMetric, recordMetric } from "../src/metrics";
import { createOwnerWithCompany, createTestUser, deleteTestUser, type OwnedCompany, type TestUser } from "./fixtures";

describe("metrics repository", () => {
  let owned: OwnedCompany;
  let stranger: TestUser;

  beforeAll(async () => {
    owned = await createOwnerWithCompany("metrics");
    stranger = await createTestUser("metrics-stranger");
  });

  afterAll(async () => {
    await deleteTestUser(owned.owner);
    await deleteTestUser(stranger);
  });

  it("latestMetric is null before any measurement", async () => {
    expect(await latestMetric(owned.owner.client, owned.companyId, "signups")).toBeNull();
  });

  it("recordMetric appends and latestMetric returns the newest point per key", async () => {
    await recordMetric(owned.owner.client, { companyId: owned.companyId, metricKey: "signups", value: 3, source: "landing_page" });
    await recordMetric(owned.owner.client, { companyId: owned.companyId, metricKey: "signups", value: 5, source: "landing_page" });
    await recordMetric(owned.owner.client, { companyId: owned.companyId, metricKey: "mrr_usd", value: 49, source: "stripe" });
    const signups = await latestMetric(owned.owner.client, owned.companyId, "signups");
    expect(signups?.value).toBe(5);
    expect(typeof signups?.measuredAt).toBe("string");
    expect((await latestMetric(owned.owner.client, owned.companyId, "mrr_usd"))?.value).toBe(49);
  });

  it("rejects unknown metric keys and other owners", async () => {
    await expect(recordMetric(owned.owner.client, { companyId: owned.companyId, metricKey: "likes" as never, value: 1, source: "x" })).rejects.toThrow();
    await expect(recordMetric(stranger.client, { companyId: owned.companyId, metricKey: "signups", value: 1, source: "x" })).rejects.toThrow();
    expect(await latestMetric(stranger.client, owned.companyId, "signups")).toBeNull();
  });
});
