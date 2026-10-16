import { randomUUID } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getExport, type ExportRecord } from "@north/db";
import type { ExportKind } from "@north/core";
import type { WorkerDeps } from "../src/deps";
import { unzip } from "./export-readers";
import { emptyStore, fakeSupabase, rowsOf, type FakeStore } from "./fake-postgrest";

/** The in-memory world the `build-export` tests run on: two companies of the owner, one of a stranger, artifacts, repositories and a row in the data tables. */

export const NOW = new Date("2026-11-20T10:00:00.000Z");
export const iso = (ms: number): string => new Date(NOW.getTime() + ms).toISOString();
export const DAY = 86_400_000;
export const PRD = "# Lumen PRD\n\nŞirket closes the month in one click.\n\n## Users\n\n- solo consultants\n";
export const DECK = "# Seed deck\n\nOne click close.\n\n## Problem\n\n- Month end takes days\n\n## Ask\n\n- $500k\n";

export interface World {
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

export function seedArtifact(store: FakeStore, companyId: string, kind: string, title: string, version: number, markdown: string): void {
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

export function world(): World {
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

export function requestRow(w: World, opts: { kind?: ExportKind; companyId?: string | null; includeArchived?: boolean; userId?: string } = {}): string {
  const id = randomUUID();
  rowsOf(w.store, "exports").push({ id, user_id: opts.userId ?? w.owner, company_id: opts.companyId ?? null, kind: opts.kind ?? "full", include_archived: opts.includeArchived ?? false, status: "requested", storage_path: null, bytes: null, manifest: null, error: null, expires_at: null, created_at: iso(-60_000), updated_at: iso(-60_000) });
  return id;
}

export const row = async (w: World, id: string): Promise<ExportRecord> => {
  const r = await getExport(w.deps.db, id);
  if (!r) throw new Error("export row missing");
  return r;
};
export const zipOf = (w: World, userId: string, exportId: string): ReadonlyMap<string, Buffer> => {
  const bytes = w.store.objects.get(`exports/users/${userId}/exports/${exportId}.zip`);
  if (!bytes) throw new Error("no zip uploaded");
  return unzip(bytes);
};
