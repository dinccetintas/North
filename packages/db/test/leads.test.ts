import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DbError } from "../src/errors";
import { countLeads, getLead, importLeads, listLeads, markLeads, nextUnsentLeads } from "../src/leads";
import { LeadsCsvError, MAX_LEADS_PER_IMPORT, parseLeadsCsv } from "../src/leads-csv";
import { createCompanyFor, createOwnerWithCompany, createTestUser, deleteTestUser, grantPlan, service, type OwnedCompany, type TestUser } from "./fixtures";

describe("parseLeadsCsv (pure)", () => {
  it("parses the four columns with RFC 4180 quoting, trims, lowercases emails and tolerates a BOM and CRLF", () => {
    const text = '﻿name,email,company,why\r\n"Ada, L.",ADA@Example.test,"Acme ""Inc""","Runs a ""queue"" clinic"\r\nBob,bob@example.test,,\r\n\r\n';
    expect(parseLeadsCsv(text)).toEqual([
      { name: "Ada, L.", email: "ada@example.test", company: 'Acme "Inc"', why: 'Runs a "queue" clinic' },
      { name: "Bob", email: "bob@example.test", company: "", why: "" },
    ]);
    expect(Object.isFrozen(parseLeadsCsv(text))).toBe(true);
    expect(parseLeadsCsv("Name, Email ,Company,Why\nx,x@example.test,y,z")).toHaveLength(1);
  });

  it("refuses a wrong header, a bad email, a short row, an empty file and more than 500 rows", () => {
    expect(() => parseLeadsCsv("name,email\nx,x@example.test")).toThrow(LeadsCsvError);
    expect(() => parseLeadsCsv("name,email,company,why\nx,not-an-email,,")).toThrow(/line 2/);
    expect(() => parseLeadsCsv("name,email,company,why\nx")).toThrow(/line 2/);
    expect(() => parseLeadsCsv("")).toThrow(LeadsCsvError);
    expect(() => parseLeadsCsv("name,email,company,why\n")).toThrow(/no rows/);
    const rows = Array.from({ length: MAX_LEADS_PER_IMPORT + 1 }, (_, i) => `n${i},l${i}@example.test,,`).join("\n");
    expect(() => parseLeadsCsv(`name,email,company,why\n${rows}`)).toThrow(/500/);
    expect(() => parseLeadsCsv('name,email,company,why\n"unterminated,x@example.test,,')).toThrow(LeadsCsvError);
  });
});

describe("leads repository (SLS-K2 input)", () => {
  let owned: OwnedCompany;
  let stranger: TestUser;

  beforeAll(async () => {
    owned = await createOwnerWithCompany("leads");
    // 2 companies for one owner: over the Solo trial's limit (M6).
    await grantPlan(owned.owner.id, "pro");
    stranger = await createTestUser("leads-stranger");
  });

  afterAll(async () => {
    await deleteTestUser(owned.owner);
    await deleteTestUser(stranger);
  });

  it("importLeads (owner, upload) inserts the rows once: duplicates in the file and in the table are skipped", async () => {
    const rows = [
      { name: "Ada", email: "Ada@example.test", company: "Acme", why: "clinic" },
      { name: "Bob", email: "bob@example.test" },
      { name: "Ada twice", email: "ada@example.test" },
    ];
    expect(await importLeads(owned.owner.client, owned.companyId, rows, "upload")).toEqual({ imported: 2, skipped: 1 });
    expect(await importLeads(owned.owner.client, owned.companyId, [{ name: "Bob again", email: "bob@example.test" }, { name: "Cy", email: "cy@example.test" }], "upload")).toEqual({ imported: 1, skipped: 1 });
    expect(await countLeads(owned.owner.client, owned.companyId)).toBe(3);
    const leads = await listLeads(owned.owner.client, owned.companyId);
    expect(leads.map((l) => [l.name, l.email, l.source, l.status])).toEqual([
      ["Ada", "ada@example.test", "upload", "new"],
      ["Bob", "bob@example.test", "upload", "new"],
      ["Cy", "cy@example.test", "upload", "new"],
    ]);
    expect(Object.isFrozen(leads[0])).toBe(true);
  });

  it("validates rows and the batch size; owners cannot import research leads; a stranger cannot import or read", async () => {
    await expect(importLeads(owned.owner.client, owned.companyId, [{ name: "", email: "x@example.test" }], "upload")).rejects.toThrow();
    await expect(importLeads(owned.owner.client, owned.companyId, [{ name: "x", email: "nope" }], "upload")).rejects.toThrow();
    const many = Array.from({ length: 501 }, (_, i) => ({ name: `n${i}`, email: `m${i}@example.test` }));
    await expect(importLeads(owned.owner.client, owned.companyId, many, "upload")).rejects.toThrow();
    await expect(importLeads(owned.owner.client, owned.companyId, [{ name: "Bot", email: "bot@example.test" }], "research")).rejects.toBeInstanceOf(DbError);
    await expect(importLeads(stranger.client, owned.companyId, [{ name: "Eve", email: "eve@example.test" }], "upload")).rejects.toBeInstanceOf(DbError);
    expect(await listLeads(stranger.client, owned.companyId)).toEqual([]);
    expect(await countLeads(stranger.client, owned.companyId)).toBe(0);
  });

  it("the worker imports research leads and marks leads contacted/replied; nextUnsentLeads returns the oldest new ones", async () => {
    expect(await importLeads(service, owned.companyId, [{ name: "Dee", email: "dee@example.test", why: "found" }], "research")).toEqual({ imported: 1, skipped: 0 });
    const next = await nextUnsentLeads(service, owned.companyId, 2);
    expect(next.map((l) => l.email)).toEqual(["ada@example.test", "bob@example.test"]);
    expect(await markLeads(service, owned.companyId, next.map((l) => l.id), "contacted", { batchId: "batch-1", messageId: "sandbox:msg:1" })).toBe(2);
    expect((await nextUnsentLeads(owned.owner.client, owned.companyId, 5)).map((l) => l.email)).toEqual(["cy@example.test", "dee@example.test"]);
    expect(await markLeads(service, owned.companyId, [next[0]!.id], "replied")).toBe(1);
    const ada = (await listLeads(owned.owner.client, owned.companyId, { status: ["replied"] }))[0];
    expect(ada).toMatchObject({ email: "ada@example.test", status: "replied", batchId: "batch-1", messageId: "sandbox:msg:1" });
    expect(await countLeads(owned.owner.client, owned.companyId, { status: ["new"] })).toBe(2);
    await expect(markLeads(owned.owner.client, owned.companyId, [next[1]!.id], "replied")).rejects.toBeInstanceOf(DbError);
    expect(await markLeads(service, owned.companyId, [], "replied")).toBe(0);
  });

  it("listLeads and countLeads filter by exact email (a batch's recipients, ≤ 100), within the company and the statuses", async () => {
    const wanted = ["cy@example.test", "dee@example.test", "nobody@example.test", "Cy@example.test"];
    expect((await listLeads(service, owned.companyId, { emails: wanted, limit: wanted.length })).map((l) => l.email)).toEqual(["cy@example.test", "dee@example.test"]);
    expect((await listLeads(service, owned.companyId, { emails: wanted, status: ["contacted"] })).map((l) => l.email)).toEqual([]);
    expect(await countLeads(service, owned.companyId, { emails: wanted, status: ["new"] })).toBe(2);
    expect(await listLeads(service, owned.companyId, { emails: [] })).toEqual([]);
    expect(await countLeads(service, owned.companyId, { emails: [] })).toBe(0);
    await expect(listLeads(service, owned.companyId, { emails: Array.from({ length: 101 }, (_, i) => `x${i}@example.test`) })).rejects.toThrow();
  });

  it("M4 review H3/M3: markLeads and getLead are company-scoped; a foreign company id changes and finds nothing", async () => {
    const foreign = await createCompanyFor(owned.owner, "leads-foreign");
    const [lead] = await listLeads(service, owned.companyId, { status: ["new"] });
    expect(await markLeads(service, foreign, [lead!.id], "opted_out")).toBe(0);
    expect((await getLead(service, owned.companyId, lead!.id))?.status).toBe("new");
    expect(await getLead(service, foreign, lead!.id)).toBeNull();
    expect(await getLead(stranger.client, owned.companyId, lead!.id)).toBeNull();
    expect((await getLead(owned.owner.client, owned.companyId, lead!.id))?.email).toBe(lead!.email);
  });
});
