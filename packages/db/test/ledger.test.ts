import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { listLedgerEntries, recordLedgerEntry } from "../src/ledger";
import { createTask } from "../src/tasks";
import { createOwnerWithCompany, createTestUser, deleteTestUser, service, type OwnedCompany, type TestUser } from "./fixtures";

describe("ledger repository (LED)", () => {
  let owned: OwnedCompany;
  let stranger: TestUser;

  beforeAll(async () => {
    owned = await createOwnerWithCompany("ledger");
    stranger = await createTestUser("ledger-stranger");
  });

  afterAll(async () => {
    await deleteTestUser(owned.owner);
    await deleteTestUser(stranger);
  });

  it("recordLedgerEntry appends an entry linked to a task and listLedgerEntries returns newest first", async () => {
    const task = await createTask(owned.owner.client, { companyId: owned.companyId, role: "research", taskType: "market_report", title: "t" });
    const first = await recordLedgerEntry(owned.owner.client, { companyId: owned.companyId, taskId: task.id, metricKey: "signups", before: 0, after: 3, costUsd: 1.5, channel: "landing_page", note: "after launch" });
    const second = await recordLedgerEntry(owned.owner.client, { companyId: owned.companyId, taskId: null, metricKey: "mrr_usd", before: 0, after: 49, costUsd: 0, channel: "stripe" });
    const entries = await listLedgerEntries(owned.owner.client, owned.companyId);
    expect(entries.map((e) => e.id)).toEqual([second, first]);
    expect(entries[1]).toMatchObject({ taskId: task.id, metricKey: "signups", before: 0, after: 3, costUsd: 1.5, channel: "landing_page", note: "after launch" });
    expect(entries[0]).toMatchObject({ taskId: null, metricKey: "mrr_usd", note: "" });
  });

  it("entries are append-only even for the service role", async () => {
    const [entry] = await listLedgerEntries(service, owned.companyId);
    const del = await service.from("ledger_entries").delete().eq("id", entry!.id);
    expect(del.error?.message).toMatch(/append-only/);
  });

  it("rejects negative cost and unknown metric keys; another owner cannot write", async () => {
    await expect(recordLedgerEntry(owned.owner.client, { companyId: owned.companyId, taskId: null, metricKey: "signups", before: 0, after: 1, costUsd: -1, channel: "x" })).rejects.toThrow();
    await expect(recordLedgerEntry(owned.owner.client, { companyId: owned.companyId, taskId: null, metricKey: "likes" as never, before: 0, after: 1, costUsd: 0, channel: "x" })).rejects.toThrow();
    await expect(recordLedgerEntry(stranger.client, { companyId: owned.companyId, taskId: null, metricKey: "signups", before: 0, after: 1, costUsd: 0, channel: "x" })).rejects.toThrow();
  });
});
