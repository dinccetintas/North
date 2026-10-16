import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DbError } from "../src/errors";
import { ledgerEntriesForReport, listLedgerEntries, recordLedgerEntry } from "../src/ledger";
import { createTask } from "../src/tasks";
import { createOwnerWithCompany, createTestUser, deleteTestUser, service, type OwnedCompany, type TestUser } from "./fixtures";

describe("ledger repository (OUT-1)", () => {
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

  it("recordLedgerEntry (worker) appends an entry linked to a task and listLedgerEntries (owner) returns newest first", async () => {
    const task = await createTask(service, { companyId: owned.companyId, role: "research", taskType: "market_report", title: "t" });
    const first = await recordLedgerEntry(service, { companyId: owned.companyId, taskId: task.id, metricKey: "signups", before: 0, after: 3, costUsd: 1.5, channel: "landing_page", note: "after launch" });
    const second = await recordLedgerEntry(service, { companyId: owned.companyId, taskId: null, metricKey: "mrr_usd", before: 0, after: 49, costUsd: 0, channel: "stripe" });
    const entries = await listLedgerEntries(owned.owner.client, owned.companyId);
    expect(entries.map((e) => e.id)).toEqual([second, first]);
    expect(entries[1]).toMatchObject({ taskId: task.id, metricKey: "signups", before: 0, after: 3, costUsd: 1.5, channel: "landing_page", note: "after launch", provenance: null, campaignId: null, actionId: null });
    expect(entries[0]).toMatchObject({ taskId: null, metricKey: "mrr_usd", note: "" });
    expect(Object.isFrozen(entries[0])).toBe(true);
  });

  it("entries carry provenance and links; listLedgerEntries honours limit and sinceDays", async () => {
    const windowEnd = new Date().toISOString();
    const provenance = { channel: "cold_email" as const, batchId: "b-1", messageIds: ["sandbox:msg:1"], windowEnd, sandbox: true };
    const id = await recordLedgerEntry(service, { companyId: owned.companyId, taskId: null, metricKey: "email_replies", before: 0, after: 2, costUsd: 0, channel: "cold_email", provenance });
    const [newest] = await listLedgerEntries(owned.owner.client, owned.companyId, { limit: 1 });
    expect(newest?.id).toBe(id);
    expect(newest?.provenance).toEqual({ ...provenance, raw: undefined });
    await service.from("ledger_entries").insert({ company_id: owned.companyId, metric_key: "signups", before_value: 0, after_value: 1, channel: "old", created_at: new Date(Date.now() - 40 * 86_400_000).toISOString() });
    expect((await listLedgerEntries(service, owned.companyId)).some((e) => e.channel === "old")).toBe(true);
    expect((await listLedgerEntries(service, owned.companyId, { sinceDays: 30 })).some((e) => e.channel === "old")).toBe(false);
  });

  it("ledgerEntriesForReport returns core LedgerEntry rows (OUT-1) for the channel report and the CSV", async () => {
    const rows = await ledgerEntriesForReport(owned.owner.client, owned.companyId, 30);
    expect(rows.length).toBe(3);
    expect(rows[0]).toEqual({ taskId: "", metricKey: "email_replies", before: 0, after: 2, costUsd: 0, channel: "cold_email", measuredAt: expect.any(String) });
    expect(rows.every((r) => Object.isFrozen(r))).toBe(true);
    expect(await ledgerEntriesForReport(stranger.client, owned.companyId, 30)).toEqual([]);
  });

  it("entries are append-only even for the service role", async () => {
    const [entry] = await listLedgerEntries(service, owned.companyId);
    const del = await service.from("ledger_entries").delete().eq("id", entry!.id);
    expect(del.error?.message).toMatch(/append-only/);
  });

  it("owners never write entries; negative cost and unknown metric keys are rejected", async () => {
    await expect(recordLedgerEntry(owned.owner.client, { companyId: owned.companyId, taskId: null, metricKey: "signups", before: 0, after: 1, costUsd: 0, channel: "x" })).rejects.toBeInstanceOf(DbError);
    await expect(recordLedgerEntry(service, { companyId: owned.companyId, taskId: null, metricKey: "signups", before: 0, after: 1, costUsd: -1, channel: "x" })).rejects.toThrow();
    await expect(recordLedgerEntry(service, { companyId: owned.companyId, taskId: null, metricKey: "likes" as never, before: 0, after: 1, costUsd: 0, channel: "x" })).rejects.toThrow();
    await expect(recordLedgerEntry(stranger.client, { companyId: owned.companyId, taskId: null, metricKey: "signups", before: 0, after: 1, costUsd: 0, channel: "x" })).rejects.toThrow();
  });
});
