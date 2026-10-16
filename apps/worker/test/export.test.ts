import { randomUUID } from "node:crypto";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { LEDGER_CSV_COLUMNS, type ExportKind } from "@north/core";
import { getExport, type ExportRecord } from "@north/db";
import type { WorkerDeps } from "../src/deps";
import { bundleExport, buildExport, EXPORT_FAILURES, failExport, produceArtifacts, produceData } from "../src/services/export/bundle";
import { exportDir, removeDir } from "../src/services/export/files";
import { loadExport } from "../src/services/export/load";
import { directSteps } from "../src/services/steps";
import { pdfText, slideCount, unzip } from "./export-readers";
import { emptyStore, fakeSupabase, rowsOf, type FakeStore } from "./fake-postgrest";

/** EXP-1 / MEM-2 / RET-1 (D6-4): `build-export` against the real repositories on an in-memory database and bucket. */

const NOW = new Date("2026-11-20T10:00:00.000Z");
const iso = (ms: number): string => new Date(NOW.getTime() + ms).toISOString();
const DAY = 86_400_000;
const PRD = "# Lumen PRD\n\nŞirket closes the month in one click.\n\n## Users\n\n- solo consultants\n";
const DECK = "# Seed deck\n\nOne click close.\n\n## Problem\n\n- Month end takes days\n\n## Ask\n\n- $500k\n";

interface World {
  readonly store: FakeStore;
  readonly deps: Pick<WorkerDeps, "db" | "env" | "clock">;
  readonly root: string;
  readonly owner: string;
  readonly stranger: string;
  readonly lumen: string;
  readonly orbit: string;
}

function seedUser(store: FakeStore, id: string, email: string, entitlement: { status?: string; endedAt?: string | null; retentionUntil?: string | null; purgeDue?: boolean } = {}): void {
  rowsOf(store, "users").push({ id, email, timezone: "Europe/Istanbul", daily_decision_quota: 3, brief_hour: 9, plan: "pro", created_at: iso(-90 * DAY) });
  rowsOf(store, "entitlements").push({
    user_id: id,
    plan_id: "pro",
    status: entitlement.status ?? "active",
    company_limit: 3,
    monthly_credits: 1000,
    price_usd: 299,
    period_start: iso(-10 * DAY),
    period_end: iso(20 * DAY),
    cancel_at: null,
    stripe_customer_id: null,
    stripe_subscription_id: null,
    ended_at: entitlement.endedAt ?? null,
    retention_until: entitlement.retentionUntil ?? null,
    purge_due: entitlement.purgeDue ?? false,
    last_event_created: null,
    created_at: iso(-90 * DAY),
    updated_at: iso(-1 * DAY),
  });
  rowsOf(store, "credit_entries").push({ id: randomUUID(), user_id: id, kind: "grant_plan", amount: 1000, ref: `plan:${id}`, note: null, created_at: iso(-10 * DAY) });
  rowsOf(store, "connections").push({ id: randomUUID(), user_id: id, provider: "github", status: "connected", account_label: email, scopes: ["repo"], vault_secret_id: "vault-ref-never-exported", created_at: iso(-30 * DAY), updated_at: iso(-30 * DAY) });
}

function seedCompany(store: FakeStore, ownerId: string, slug: string, status = "active", ageDays = 30): string {
  const id = randomUUID();
  rowsOf(store, "companies").push({ id, owner_id: ownerId, name: `${slug[0]?.toUpperCase()}${slug.slice(1)}`, slug, status, kill_switch_active: status !== "active", paused_reason: status === "archived" ? "retention" : null, onboarding_step: "done", public_page_enabled: false, sentry_project_slug: null, archived_at: null, created_at: iso(-ageDays * DAY), updated_at: iso(-DAY) });
  return id;
}

function seedArtifact(store: FakeStore, companyId: string, kind: string, title: string, version: number, markdown: string): void {
  const path = `companies/${companyId}/${kind}/${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-v${version}.md`;
  rowsOf(store, "artifacts").push({ id: randomUUID(), company_id: companyId, kind, title, version, storage_path: path, created_by_role: "strategy_product", created_at: iso(-version * DAY) });
  store.objects.set(`artifacts/${path}`, new TextEncoder().encode(markdown));
}

function seedRepo(store: FakeStore, companyId: string, ref: string): void {
  const pending = randomUUID();
  rowsOf(store, "actions").push({ id: pending, company_id: companyId, task_id: null, agent_role: "engineering", kind: "repo.create", tier: "K1", description: "Create the repository", payload: { name: "site" }, status: "pending", external_ref: null, decision_card_id: null, auto_rule_id: null, sandbox: true, supersedes: null, created_at: iso(-5 * DAY) });
  rowsOf(store, "actions").push({ id: randomUUID(), company_id: companyId, task_id: null, agent_role: "engineering", kind: "repo.create", tier: "K1", description: "Create the repository", payload: { supersedes: pending }, status: "notified", external_ref: ref, decision_card_id: null, auto_rule_id: null, sandbox: true, supersedes: pending, created_at: iso(-5 * DAY + 1000) });
}

function seedData(store: FakeStore, companyId: string): void {
  rowsOf(store, "ledger_entries").push({ id: randomUUID(), company_id: companyId, task_id: null, metric_key: "signups", before_value: 3, after_value: 7, cost_usd: 12.5, channel: "meta_ads", attribution_note: "=HYPERLINK(1)", provenance: null, campaign_id: null, action_id: null, created_at: iso(-2 * DAY) });
  rowsOf(store, "decision_cards").push({ id: randomUUID(), company_id: companyId, task_id: null, action_id: null, action_kind: "deploy.production", tier: "K2", question: "Go live?", rationale: "verified preview", options: [{ id: "approve", label: "Approve" }], recommended_option_id: "approve", default_option_id: "decline", expected_impact: null, cost_usd: 0, opened_at: iso(-DAY), due_at: iso(DAY), day: "2026-11-19", seq: 1, answered_option_id: null, answered_at: null, answered_by: null, merge_key: null, created_at: iso(-DAY) });
  rowsOf(store, "memory_items").push({ id: randomUUID(), company_id: companyId, kind: "learning", title: "Pricing", content: "Consultants pay yearly.", created_by_role: "research", embedding: "[0.1,0.2]", search: "'pricing'", created_at: iso(-DAY) });
}

function world(): World {
  const store = emptyStore();
  const root = mkdtempSync(join(tmpdir(), "north-export-"));
  const owner = randomUUID();
  const stranger = randomUUID();
  seedUser(store, owner, "ceo@lumen.test");
  seedUser(store, stranger, "rival@rival.test");
  const lumen = seedCompany(store, owner, "lumen", "active", 40);
  const orbit = seedCompany(store, owner, "orbit", "paused", 20);
  const rival = seedCompany(store, stranger, "rival");
  seedArtifact(store, lumen, "prd", "Lumen PRD", 1, PRD);
  seedArtifact(store, lumen, "prd", "Lumen PRD", 2, `${PRD}\nv2\n`);
  seedArtifact(store, lumen, "investor_deck", "Seed deck", 1, DECK);
  seedArtifact(store, orbit, "plan", "Week plan", 1, "# Week plan\n\n## Monday\n\n- ship\n");
  seedArtifact(store, rival, "prd", "Rival PRD", 1, "# Secret rival plan\n");
  seedRepo(store, lumen, "sandbox://repos/ceo/lumen-site");
  seedRepo(store, orbit, "sandbox://repos/ceo/orbit-site");
  seedData(store, lumen);
  seedData(store, orbit);
  seedData(store, rival);
  const deps = { db: fakeSupabase(store), env: { WORKSPACE_ROOT: root } as WorkerDeps["env"], clock: () => new Date(NOW) };
  return { store, deps, root, owner, stranger, lumen, orbit };
}

function requestRow(w: World, opts: { kind?: ExportKind; companyId?: string | null; includeArchived?: boolean; userId?: string } = {}): string {
  const id = randomUUID();
  rowsOf(w.store, "exports").push({ id, user_id: opts.userId ?? w.owner, company_id: opts.companyId ?? null, kind: opts.kind ?? "full", include_archived: opts.includeArchived ?? false, status: "requested", storage_path: null, bytes: null, manifest: null, error: null, expires_at: null, created_at: iso(-60_000), updated_at: iso(-60_000) });
  return id;
}

const row = async (w: World, id: string): Promise<ExportRecord> => {
  const r = await getExport(w.deps.db, id);
  if (!r) throw new Error("export row missing");
  return r;
};
const zipOf = (w: World, userId: string, exportId: string): ReadonlyMap<string, Buffer> => {
  const bytes = w.store.objects.get(`exports/users/${userId}/exports/${exportId}.zip`);
  if (!bytes) throw new Error("no zip uploaded");
  return unzip(bytes);
};

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
