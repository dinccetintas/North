import { describe, expect, it } from "vitest";
import type { LedgerEntry } from "@north/core";
import { LEDGER_EXPORT_FILENAME, ledgerCsvResponse } from "./ledger-csv";
import { CsvBodyError, MAX_CSV_BODY_BYTES, readCsvBody } from "./leads-import";

const entry = (overrides: Partial<LedgerEntry> = {}): LedgerEntry => ({
  taskId: "11111111-1111-4111-8111-111111111111",
  metricKey: "signups",
  before: 0,
  after: 1,
  costUsd: 4,
  channel: "meta_ads",
  measuredAt: "2026-10-15T10:00:00+00:00",
  ...overrides,
});

describe("OUT-1: GET /api/companies/[id]/ledger.csv response", () => {
  it("is a text/csv attachment, private and not cached, with the fixed header row", async () => {
    const res = ledgerCsvResponse([entry()], "acme-co");
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("text/csv; charset=utf-8");
    expect(res.headers.get("Content-Disposition")).toBe(`attachment; filename="${LEDGER_EXPORT_FILENAME("acme-co")}"`);
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    const lines = (await res.text()).split("\r\n");
    expect(lines[0]).toBe("measured_at,channel,metric_key,before,after,delta,cost_usd,task_id");
    expect(lines[1]).toBe("2026-10-15T10:00:00+00:00,meta_ads,signups,0,1,1,4,11111111-1111-4111-8111-111111111111");
    expect(lines[2]).toBe("");
  });

  it("has a header and no rows for an empty ledger", async () => {
    const text = await ledgerCsvResponse([], "acme-co").text();
    expect(text).toBe("measured_at,channel,metric_key,before,after,delta,cost_usd,task_id\r\n");
  });

  it("guards formula injection and quotes commas and quotes (RFC 4180)", async () => {
    const text = await ledgerCsvResponse([entry({ channel: "=HYPERLINK(\"http://evil\")", taskId: "+1,2" }), entry({ channel: 'say "hi"', taskId: "@x" })], "acme-co").text();
    const [, first, second] = text.split("\r\n");
    expect(first).toContain('"\'=HYPERLINK(""http://evil"")"');
    expect(first).toContain("\"'+1,2\"");
    expect(second).toContain('"say ""hi"""');
    expect(second).toContain("\"'@x\"");
    expect(text).not.toMatch(/(^|,)[=+\-@]/m);
  });
});

describe("POST /api/companies/[id]/leads/import body", () => {
  const csv = "name,email,company,why\nAda,ada@example.test,Acme,clinic\n";

  it("reads a text body or a multipart file field", async () => {
    expect(await readCsvBody(new Request("http://x/leads", { method: "POST", headers: { "Content-Type": "text/csv" }, body: csv }))).toBe(csv);
    const form = new FormData();
    form.set("file", new Blob([csv], { type: "text/csv" }), "leads.csv");
    expect(await readCsvBody(new Request("http://x/leads", { method: "POST", body: form }))).toBe(csv);
    const text = new FormData();
    text.set("csv", csv);
    // A multipart text field arrives with CRLF line ends; the parser accepts both.
    expect((await readCsvBody(new Request("http://x/leads", { method: "POST", body: text }))).replace(/\r\n/g, "\n")).toBe(csv);
  });

  it("refuses a missing file field and a body over 256 KB (declared or actual)", async () => {
    const empty = new FormData();
    empty.set("other", "x");
    await expect(readCsvBody(new Request("http://x/leads", { method: "POST", body: empty }))).rejects.toMatchObject({ name: "CsvBodyError", status: 400 });
    const declared = new Request("http://x/leads", { method: "POST", headers: { "Content-Type": "text/csv", "Content-Length": String(MAX_CSV_BODY_BYTES + 1) }, body: "x" });
    await expect(readCsvBody(declared)).rejects.toBeInstanceOf(CsvBodyError);
    const big = new Request("http://x/leads", { method: "POST", headers: { "Content-Type": "text/plain" }, body: "a".repeat(MAX_CSV_BODY_BYTES + 1) });
    await expect(readCsvBody(big)).rejects.toMatchObject({ status: 413 });
  });
});
