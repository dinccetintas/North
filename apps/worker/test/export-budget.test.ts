import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { EXPORT_TEXT_MAX_CHARS } from "@north/db";
import { buildExport } from "../src/services/export/bundle";
import { EXPORT_BUDGET } from "../src/services/export/data-export";
import { directSteps } from "../src/services/steps";
import { rowsOf } from "./fake-postgrest";
import { DAY, iso, requestRow, row, seedArtifact, world, zipOf, type World } from "./export-world";

/**
 * M6 security review M4 (EXP-1), on the in-memory fake: byte budgets per
 * table and per export with the README naming every cut, rows streamed to
 * disk page by page (one JSON row per line), free-text columns cut in the
 * select, the zip uploaded as a stream. M5: every artifact past PostgREST's
 * cap. M2: an artifact row naming another company's object is refused.
 */
let w: World;
beforeEach(() => {
  w = world();
});

const memoryRows = (companyId: string, n: number, size: number): void => {
  for (let i = 0; i < n; i += 1) rowsOf(w.store, "memory_items").push({ id: randomUUID(), company_id: companyId, kind: "doc", title: `Note ${i}`, content: `${i}:${"m".repeat(size)}`, created_by_role: "research", created_at: iso(-DAY + i * 1000) });
};

const readme = (id: string): string => zipOf(w, w.owner, id).get("README.md")?.toString("utf8") ?? "";

describe("export budgets and streaming (M6 review M4)", () => {
  it("the defaults keep the zip under the storage upload limit (50 MiB) and a table under a third of it", () => {
    expect(EXPORT_BUDGET.exportBytes).toBeLessThanOrEqual(45 * 1024 * 1024);
    expect(EXPORT_BUDGET.tableBytes).toBeLessThan(EXPORT_BUDGET.exportBytes);
  });

  it("a table over its byte budget stops at the last whole row; the JSON stays valid and the README names the cut", async () => {
    memoryRows(w.lumen, 40, 900);
    const id = requestRow(w, { kind: "data", companyId: w.lumen });
    await buildExport(w.deps, directSteps, id, w.owner, { tableBytes: 10_000, exportBytes: 1_000_000 });
    const memory = JSON.parse(zipOf(w, w.owner, id).get("data/lumen/memory.json")?.toString("utf8") ?? "null") as { content: string }[];
    expect(memory.length).toBeGreaterThan(5);
    expect(memory.length).toBeLessThan(41);
    expect(readme(id)).toMatch(new RegExp(`\`data/lumen/memory\\.json\`: stops at row ${memory.length}: the 10 kB budget per table`));
  });

  it("rows are written one per line as they are read, not pretty-printed", async () => {
    memoryRows(w.lumen, 3, 10);
    const id = requestRow(w, { kind: "data", companyId: w.lumen });
    await buildExport(w.deps, directSteps, id, w.owner);
    const text = zipOf(w, w.owner, id).get("data/lumen/memory.json")?.toString("utf8") ?? "";
    const lines = text.trim().split("\n");
    expect(lines[0]).toBe("[");
    expect(lines.at(-1)).toBe("]");
    expect(lines).toHaveLength(4 + 2);
    expect(JSON.parse(text)).toHaveLength(4);
  });

  it("once the export's budget is spent, later artifacts and tables are left out and named in the README", async () => {
    for (let v = 3; v <= 12; v += 1) seedArtifact(w.store, w.lumen, "doc", "Long notes", v, `# Notes v${v}\n\n${"n".repeat(4000)}\n`);
    const id = requestRow(w, { kind: "full", companyId: w.lumen });
    const outcome = await buildExport(w.deps, directSteps, id, w.owner, { tableBytes: 50_000, exportBytes: 30_000 });
    expect(outcome).toMatchObject({ status: "ready" });
    const record = await row(w, id);
    const total = (record.manifest?.files ?? []).filter((f) => f.path !== "README.md").reduce((sum, f) => sum + f.bytes, 0);
    expect(total).toBeLessThanOrEqual(30_000);
    const text = readme(id);
    expect(text).toMatch(/left out: the 30 kB budget of this export is spent/);
    expect(text).toMatch(/`data\/lumen\/[a-z_]+\.json`: left out: the 30 kB budget of this export is spent/);
  });

  it("a free-text value longer than EXPORT_TEXT_MAX_CHARS arrives cut by the select, and the README says which column", async () => {
    rowsOf(w.store, "tasks").push({ id: randomUUID(), company_id: w.lumen, role: "research", task_type: "market_report", title: "Huge", status: "done", input: {}, output_summary: "s".repeat(EXPORT_TEXT_MAX_CHARS + 500), result: {}, evidence: null, cost_usd: 0, attempts: 1, created_at: iso(-DAY), updated_at: iso(-DAY) });
    const id = requestRow(w, { kind: "data", companyId: w.lumen });
    await buildExport(w.deps, directSteps, id, w.owner);
    const tasks = JSON.parse(zipOf(w, w.owner, id).get("data/lumen/tasks.json")?.toString("utf8") ?? "[]") as { output_summary: string }[];
    expect(tasks[0]?.output_summary).toHaveLength(EXPORT_TEXT_MAX_CHARS);
    expect(readme(id)).toMatch(/`data\/lumen\/tasks\.json`: `output_summary` values longer than 20 000 characters are cut/);
  });

  it("the zip is uploaded from the file as a stream, never read into one buffer", async () => {
    const id = requestRow(w, { kind: "artifacts", companyId: w.lumen });
    await buildExport(w.deps, directSteps, id, w.owner);
    expect(w.store.uploads).toEqual([`exports:stream`]);
  });

  it("M5: every artifact past PostgREST's cap is exported (here 4 rows a request)", async () => {
    w.store.maxRows = 4;
    for (let v = 3; v <= 8; v += 1) seedArtifact(w.store, w.lumen, "doc", "Notes", v, `# Notes v${v}\n`);
    const id = requestRow(w, { kind: "artifacts", companyId: w.lumen });
    await buildExport(w.deps, directSteps, id, w.owner);
    const names = [...zipOf(w, w.owner, id).keys()].filter((n) => n.endsWith(".md") && n !== "README.md");
    expect(names).toHaveLength(3 + 6);
  });

  it("M2: an artifact row naming another company's object is refused and named; that markdown never enters the zip", async () => {
    const rival = rowsOf(w.store, "companies").find((c) => c.slug === "rival");
    rowsOf(w.store, "artifacts").push({ id: randomUUID(), company_id: w.lumen, kind: "prd", title: "Borrowed", version: 1, storage_path: `companies/${String(rival?.id)}/prd/rival-prd-v1.md`, created_by_role: "research", created_at: iso(-DAY) });
    const id = requestRow(w, { kind: "artifacts", companyId: w.lumen });
    expect(await buildExport(w.deps, directSteps, id, w.owner)).toMatchObject({ status: "ready" });
    const zip = zipOf(w, w.owner, id);
    expect([...zip.values()].some((b) => b.toString("latin1").includes("Secret rival plan"))).toBe(false);
    expect(zip.get("README.md")?.toString("utf8")).toMatch(/borrowed-v1\.md` was not exported: its storage path is not in this company's folder/);
  });
});
