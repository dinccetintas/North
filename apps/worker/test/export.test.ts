import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";
import { LEDGER_CSV_COLUMNS } from "@north/core";
import { bundleExport, buildExport, EXPORT_FAILURES, failExport, produceArtifacts, produceData } from "../src/services/export/bundle";
import { exportDir, removeDir } from "../src/services/export/files";
import { loadExport } from "../src/services/export/load";
import { directSteps } from "../src/services/steps";
import { pdfText, slideCount } from "./export-readers";
import { rowsOf } from "./fake-postgrest";
import { DAY, iso, NOW, PRD, requestRow, row, seedArtifact, world, zipOf, type World } from "./export-world";

/** EXP-1 / MEM-2 / RET-1 (D6-4): `build-export` against the real repositories on an in-memory database and bucket. */

let w: World;
beforeEach(() => {
  w = world();
});

describe("build-export (D6-4)", () => {
  it("a full export of two companies yields the manifest paths, a README naming both repos and a ready row with bytes > 0", async () => {
    const id = requestRow(w);
    const outcome = await buildExport(w.deps, directSteps, id, w.owner);
    expect(outcome).toMatchObject({ status: "ready", exportId: id });
    const record = await row(w, id);
    expect(record).toMatchObject({ status: "ready", storagePath: `users/${w.owner}/exports/${id}.zip`, expiresAt: iso(7 * DAY), error: null });
    expect(record.bytes).toBeGreaterThan(0);
    expect(record.bytes).toBe(w.store.objects.get(`exports/${record.storagePath}`)?.byteLength);

    const zip = zipOf(w, w.owner, id);
    const names = [...zip.keys()];
    for (const expected of [
      "README.md",
      "artifacts/lumen/prd/lumen-prd-v1.md",
      "artifacts/lumen/prd/lumen-prd-v1.pdf",
      "artifacts/lumen/prd/lumen-prd-v2.md",
      "artifacts/lumen/investor_deck/seed-deck-v1.md",
      "artifacts/lumen/investor_deck/seed-deck-v1.pdf",
      "artifacts/lumen/investor_deck/seed-deck-v1.pptx",
      "artifacts/orbit/plan/week-plan-v1.pptx",
      "data/lumen/company.json",
      "data/lumen/ledger.csv",
      "data/lumen/actions.json",
      "data/lumen/memory.json",
      "data/orbit/decision_cards.csv",
      "data/orbit/leads.csv",
      "data/profile.json",
    ]) {
      expect(names, expected).toContain(expected);
    }
    expect(names.filter((n) => n.startsWith("artifacts/lumen/prd/") && n.endsWith(".pptx"))).toEqual([]);
    expect(record.manifest?.files.map((f) => f.path).sort()).toEqual([...names].sort());
    expect(record.manifest?.companies).toEqual([
      { slug: "lumen", repoUrl: "sandbox://repos/ceo/lumen-site" },
      { slug: "orbit", repoUrl: "sandbox://repos/ceo/orbit-site" },
    ]);

    // MEM-2: the markdown is exact, the PDF has the heading, the deck has a slide per H2 plus the title.
    expect(zip.get("artifacts/lumen/prd/lumen-prd-v1.md")?.toString("utf8")).toBe(PRD);
    expect(pdfText(zip.get("artifacts/lumen/prd/lumen-prd-v1.pdf") ?? new Uint8Array())).toContain("Lumen PRD");
    expect(slideCount(zip.get("artifacts/lumen/investor_deck/seed-deck-v1.pptx") ?? new Uint8Array())).toBe(3);
    const readme = zip.get("README.md")?.toString("utf8") ?? "";
    expect(readme).toContain("sandbox://repos/ceo/lumen-site");
    expect(readme).toContain("sandbox://repos/ceo/orbit-site");
    expect(readme).toContain(NOW.toISOString());
    expect(zip.get("data/lumen/ledger.csv")?.toString("utf8").split("\r\n")[0]).toBe(LEDGER_CSV_COLUMNS.join(","));
    expect(zip.get("data/lumen/actions.json")?.toString("utf8")).toContain("sandbox://repos/ceo/lumen-site");
  });

  it("reads only the owner's own rows and only owner-visible columns, and removes its scratch directory", async () => {
    const id = requestRow(w);
    await buildExport(w.deps, directSteps, id, w.owner);
    const zip = zipOf(w, w.owner, id);
    const everything = [...zip.values()].map((b) => b.toString("latin1")).join("\n");
    expect([...zip.keys()].some((n) => n.includes("rival"))).toBe(false);
    expect(everything).not.toContain("Secret rival plan");
    expect(everything).not.toContain("rival@rival.test");
    expect(everything).not.toContain("vault-ref-never-exported");
    expect(zip.get("data/lumen/memory.json")?.toString("utf8")).not.toContain("embedding");
    const profile = JSON.parse(zip.get("data/profile.json")?.toString("utf8") ?? "{}");
    expect(profile.profile.email).toBe("ceo@lumen.test");
    expect(profile.entitlement.status).toBe("active");
    expect(profile.credit_entries).toHaveLength(1);
    expect(existsSync(exportDir(w.deps, id))).toBe(false);
  });

  it("EXP-1 / CMP-1: the export carries the suppression list, the sender identity and memory's department, provenance, status and validity", async () => {
    const id = requestRow(w);
    await buildExport(w.deps, directSteps, id, w.owner);
    const zip = zipOf(w, w.owner, id);
    const suppressions = JSON.parse(zip.get("data/lumen/suppressions.json")?.toString("utf8") ?? "null");
    expect(suppressions).toEqual([expect.objectContaining({ email: `optout-${w.lumen.slice(0, 8)}@example.test`, domain: "example.test", reason: "opt_out", source_action_id: null })]);
    expect(zip.get("data/orbit/suppressions.json")?.toString("utf8")).toContain(`optout-${w.orbit.slice(0, 8)}@example.test`);
    const rival = String(rowsOf(w.store, "companies").find((c) => c.slug === "rival")?.id);
    expect([...zip.values()].map((b) => b.toString("latin1")).join("\n")).not.toContain(`optout-${rival.slice(0, 8)}@example.test`);
    const company = JSON.parse(zip.get("data/lumen/company.json")?.toString("utf8") ?? "{}");
    expect(company).toMatchObject({ legal_name: "lumen Labs Ltd", postal_address: "1 lumen Street, Springfield 12345" });
    const memory = JSON.parse(zip.get("data/lumen/memory.json")?.toString("utf8") ?? "[]");
    expect(memory[0]).toMatchObject({ department: "sales", provenance: { source: "task" }, status: "active", valid_until: expect.any(String) });
  });

  it("a stranger's export id is not found and the row is left alone", async () => {
    const id = requestRow(w);
    expect(await buildExport(w.deps, directSteps, id, w.stranger)).toEqual({ status: "not_found", exportId: id });
    expect(await buildExport(w.deps, directSteps, randomUUID(), w.owner)).toMatchObject({ status: "not_found" });
    expect((await row(w, id)).status).toBe("requested");
    expect([...w.store.objects.keys()].some((k) => k.startsWith("exports/"))).toBe(false);
  });

  it("an ended owner inside retention can export; after retention_until (or once purge is due) the request fails with archived", async () => {
    const ent = rowsOf(w.store, "entitlements").find((e) => e.user_id === w.owner);
    if (!ent) throw new Error("no entitlement");
    Object.assign(ent, { status: "ended", ended_at: iso(-10 * DAY), retention_until: iso(80 * DAY) });
    const inside = requestRow(w);
    expect(await buildExport(w.deps, directSteps, inside, w.owner)).toMatchObject({ status: "ready" });

    Object.assign(ent, { ended_at: iso(-91 * DAY), retention_until: iso(-DAY) });
    const after = requestRow(w);
    expect(await buildExport(w.deps, directSteps, after, w.owner)).toEqual({ status: "failed", exportId: after, error: EXPORT_FAILURES.archived });
    expect(await row(w, after)).toMatchObject({ status: "failed", error: "archived", storagePath: null });

    Object.assign(ent, { retention_until: iso(DAY), purge_due: true });
    const due = requestRow(w);
    expect(await buildExport(w.deps, directSteps, due, w.owner)).toMatchObject({ status: "failed", error: "archived" });
  });

  it("scopes by kind and company; archived companies only when asked for", async () => {
    const artifactsOnly = requestRow(w, { kind: "artifacts", companyId: w.lumen });
    await buildExport(w.deps, directSteps, artifactsOnly, w.owner);
    const a = [...zipOf(w, w.owner, artifactsOnly).keys()];
    expect(a.every((n) => n === "README.md" || n.startsWith("artifacts/lumen/"))).toBe(true);

    const dataOnly = requestRow(w, { kind: "data" });
    await buildExport(w.deps, directSteps, dataOnly, w.owner);
    const d = [...zipOf(w, w.owner, dataOnly).keys()];
    expect(d.every((n) => n === "README.md" || n.startsWith("data/"))).toBe(true);
    expect(d).toContain("data/orbit/tasks.csv");

    const archived = rowsOf(w.store, "companies").find((c) => c.id === w.orbit);
    if (archived) archived.status = "archived";
    const withoutArchived = requestRow(w, { kind: "data" });
    await buildExport(w.deps, directSteps, withoutArchived, w.owner);
    expect([...zipOf(w, w.owner, withoutArchived).keys()].some((n) => n.startsWith("data/orbit/"))).toBe(false);
    const withArchived = requestRow(w, { kind: "data", includeArchived: true });
    await buildExport(w.deps, directSteps, withArchived, w.owner);
    expect([...zipOf(w, w.owner, withArchived).keys()]).toContain("data/orbit/company.json");

    const notTheirs = requestRow(w, { companyId: randomUUID() });
    expect(await buildExport(w.deps, directSteps, notTheirs, w.owner)).toMatchObject({ status: "failed", error: EXPORT_FAILURES.companyNotFound });
  });

  it("a replayed event finds the row ready and does nothing", async () => {
    const id = requestRow(w);
    await buildExport(w.deps, directSteps, id, w.owner);
    const bytes = (await row(w, id)).bytes;
    expect(await buildExport(w.deps, directSteps, id, w.owner)).toEqual({ status: "skipped", exportId: id, current: "ready" });
    expect((await row(w, id)).bytes).toBe(bytes);
  });

  it("a markdown the PDF renderer refuses (above 5 MB) is exported as markdown and named in the README", async () => {
    seedArtifact(w.store, w.lumen, "doc", "Huge notes", 1, "x".repeat(5 * 1024 * 1024 + 1));
    const id = requestRow(w, { kind: "artifacts", companyId: w.lumen });
    await buildExport(w.deps, directSteps, id, w.owner);
    const zip = zipOf(w, w.owner, id);
    expect(zip.get("artifacts/lumen/doc/huge-notes-v1.md")?.byteLength).toBe(5 * 1024 * 1024 + 1);
    expect(zip.has("artifacts/lumen/doc/huge-notes-v1.pdf")).toBe(false);
    expect(zip.get("README.md")?.toString("utf8")).toMatch(/huge-notes-v1\.pdf` was not rendered: .*5 MB/);
  });

  it("an upload that keeps failing is retried by Inngest, then failExport marks the owner's row failed with the fixed message", async () => {
    const id = requestRow(w);
    w.store.failing.add("storage:exports");
    await expect(buildExport(w.deps, directSteps, id, w.owner)).rejects.toThrow(/upload failed/);
    expect(existsSync(exportDir(w.deps, id))).toBe(false);
    expect(await failExport(w.deps, id, w.stranger)).toEqual({ failed: false });
    expect((await row(w, id)).status).toBe("running");
    expect(await failExport(w.deps, id, w.owner)).toEqual({ failed: true });
    expect(await row(w, id)).toMatchObject({ status: "failed", error: EXPORT_FAILURES.error });
  });

  it("the bundle step rebuilds entries that are not on this machine's disk (a step served elsewhere)", async () => {
    const id = requestRow(w);
    const loaded = await loadExport(w.deps, id, w.owner);
    if (!loaded.ok) throw new Error("load refused");
    const artifacts = await produceArtifacts(w.deps, loaded.plan);
    const data = await produceData(w.deps, loaded.plan);
    await removeDir(exportDir(w.deps, id));
    expect(await bundleExport(w.deps, loaded.plan, artifacts, data)).toMatchObject({ status: "ready", files: artifacts.files.length + data.files.length + 1 });
    expect(zipOf(w, w.owner, id).has("artifacts/lumen/prd/lumen-prd-v2.md")).toBe(true);
  });
});
