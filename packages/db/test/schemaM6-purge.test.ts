import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createCompanyFor, createOwnerWithCompany, deleteTestUser, endEntitlement, grantPlan, raw, type OwnedCompany } from "./fixtures";

type Pending = PromiseLike<{ data: unknown; error: { message: string } | null }>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const must = async (query: Pending): Promise<any> => {
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return data;
};
const one = (table: string, row: Record<string, unknown>) => must(raw.from(table).insert(row).select("id").single()).then((r: { id: string }) => r.id);
const rand = () => Math.random().toString(36).slice(2, 10);

const COMPANY_TABLES = ["theses", "goals", "budgets", "agents", "plans", "tasks", "decision_cards", "auto_rules", "actions", "signals", "metrics", "ledger_entries", "memory_items", "artifacts", "briefs", "agent_runs", "audit_tool_calls", "notifications", "campaigns", "leads", "public_pages", "exports"] as const;
const USER_TABLES = ["connections", "push_subscriptions", "notifications", "usage", "credit_entries", "billing_sessions", "billing_events", "exports", "entitlements"] as const;

/** One owner's company with a row in every company-scoped table, including an action chain, a campaign and a ledger entry that reference each other. */
async function fillCompany(companyId: string, userId: string): Promise<void> {
  const goal = await one("goals", { company_id: companyId, metric_key: "signups", target_value: 10, due_date: "2027-01-01" });
  const plan = await one("plans", { company_id: companyId, goal_id: goal, week_start: "2026-11-02", summary: "Week" });
  const agent = await one("agents", { company_id: companyId, role: "growth", config_ref: "growth.yaml", max_action_tier: "K2" });
  const task = await one("tasks", { company_id: companyId, plan_id: plan, agent_id: agent, role: "growth", title: "Ads", task_type: "campaign_spec" });
  const due = new Date(Date.now() + 86_400_000).toISOString();
  const card = await one("decision_cards", { company_id: companyId, task_id: task, action_kind: "ads.start", tier: "K2", question: "Start?", options: [{ id: "approve", label: "Approve" }], recommended_option_id: "approve", rationale: "r", due_at: due });
  const pending = await one("actions", { company_id: companyId, task_id: task, agent_role: "growth", kind: "ads.start", tier: "K2", description: "Start", status: "pending", decision_card_id: card });
  const executed = await one("actions", { company_id: companyId, task_id: task, agent_role: "growth", kind: "ads.start", tier: "K2", description: "Start", status: "executed", decision_card_id: card, supersedes: pending });
  await must(raw.from("decision_cards").update({ action_id: pending }).eq("id", card));
  const rule = await one("auto_rules", { company_id: companyId, kind: "ads.start", created_from_card_id: card });
  await one("actions", { company_id: companyId, agent_role: "growth", kind: "ads.start", tier: "K2", description: "Auto", status: "executed", auto_rule_id: rule });
  await one("budgets", { company_id: companyId, category: "ads", total_limit_usd: 100, daily_limit_usd: 10 });
  const campaign = await one("campaigns", { company_id: companyId, task_id: task, action_id: executed, provider: "meta_ads", provider_campaign_id: `c-${rand()}`, name: "Test", channel: "meta_ads", metric_key: "signups", daily_budget_usd: 10, total_budget_usd: 50 });
  await one("ledger_entries", { company_id: companyId, task_id: task, metric_key: "signups", before_value: 0, after_value: 1, channel: "meta_ads", campaign_id: campaign, action_id: executed });
  const run = await one("agent_runs", { company_id: companyId, task_id: task, role: "growth", model: "m", runtime: "mock", status: "succeeded" });
  await one("audit_tool_calls", { company_id: companyId, agent_run_id: run, task_id: task, tool_name: "Read", decision: "allow" });
  await one("signals", { company_id: companyId, source: "reddit", source_ref: `s-${rand()}`, converted_card_id: card, converted_task_id: task });
  await one("notifications", { company_id: companyId, user_id: userId, channel: "push", kind: "card", card_id: card, status: "sandbox" });
  await one("metrics", { company_id: companyId, metric_key: "signups", value: 1, source: "analytics" });
  await one("memory_items", { company_id: companyId, kind: "learning", title: "L", content: "C" });
  await one("artifacts", { company_id: companyId, kind: "prd", title: "PRD", storage_path: `companies/${companyId}/prd/prd-v1.md`, created_by_role: "strategy_product" });
  await one("briefs", { company_id: companyId, brief_date: "2026-11-02", content: {} });
  await one("leads", { company_id: companyId, name: "Lead", email: `lead-${rand()}@example.com`, source: "upload" });
  await must(raw.from("public_pages").insert({ company_id: companyId }));
  await one("exports", { user_id: userId, company_id: companyId, kind: "data" });
}

async function fillUser(userId: string): Promise<string> {
  const connection = await one("connections", { user_id: userId, provider: "github", scopes: ["sandbox"] });
  await must(raw.from("connection_secrets").insert({ connection_id: connection, ciphertext: "c", iv: "i", tag: "t" }));
  await one("push_subscriptions", { user_id: userId, endpoint: `https://push.example/${rand()}`, p256dh: "p", auth: "a" });
  await must(raw.rpc("usage_apply", { p_user_id: userId, p_period: "2026-11", p_credits: 1, p_cost_usd: 0.1, p_sandbox_minutes: 0 }));
  await one("credit_entries", { user_id: userId, kind: "consume", amount: -1, ref: `run:${rand()}` });
  await one("billing_sessions", { user_id: userId, kind: "portal" });
  await one("billing_events", { event_id: `evt_${rand()}`, type: "customer.subscription.deleted", user_id: userId, payload: {} });
  await one("exports", { user_id: userId, kind: "full" });
  return connection;
}

async function remaining(userId: string, companyIds: readonly string[], connectionId: string): Promise<Record<string, number>> {
  const count = async (table: string, column: string, values: readonly string[]) => (await raw.from(table).select("*", { count: "exact", head: true }).in(column, [...values])).count ?? -1;
  const out: Record<string, number> = {};
  for (const table of COMPANY_TABLES) out[`company:${table}`] = await count(table, "company_id", companyIds);
  for (const table of USER_TABLES) out[`user:${table}`] = await count(table, "user_id", [userId]);
  out.companies = await count("companies", "owner_id", [userId]);
  out.users = await count("users", "id", [userId]);
  out.connection_secrets = await count("connection_secrets", "connection_id", [connectionId]);
  return out;
}

/** 0013_m6_pages_exports_purge.sql, RET-1 (ADR 0016): purge_owner is the one delete path. */
describe("M6 schema: purge_owner", () => {
  let owned: OwnedCompany;
  let witness: OwnedCompany;
  let second: string;
  let connection: string;

  beforeAll(async () => {
    owned = await createOwnerWithCompany("schema-m6-purge");
    witness = await createOwnerWithCompany("schema-m6-purge-witness");
    await grantPlan(owned.owner.id, "pro");
    second = await createCompanyFor(owned.owner, "schema-m6-purge-2");
    await fillCompany(owned.companyId, owned.owner.id);
    await fillCompany(second, owned.owner.id);
    await fillCompany(witness.companyId, witness.owner.id);
    connection = await fillUser(owned.owner.id);
  });

  afterAll(async () => {
    await deleteTestUser(witness.owner);
  });

  it("refuses for an active entitlement, an ended one inside retention, a bad reason and any caller but the service role", async () => {
    const purge = (reason = "smoke") => raw.rpc("purge_owner", { p_user_id: owned.owner.id, p_reason: reason });
    expect((await purge()).error?.message).toMatch(/retention/);
    await endEntitlement(owned.owner.id);
    expect((await purge()).error?.message).toMatch(/retention/);
    await endEntitlement(owned.owner.id, { retentionPassed: true });
    expect((await purge("Drop Table")).error).not.toBeNull();
    expect((await owned.owner.client.rpc("purge_owner", { p_user_id: owned.owner.id, p_reason: "smoke" })).error).not.toBeNull();
    expect(Object.values(await remaining(owned.owner.id, [owned.companyId, second], connection)).every((n) => n > 0)).toBe(true);
  });

  it("after retention it deletes every row of the owner including actions and the ledger, logs the counts, and auth.admin.deleteUser then succeeds", async () => {
    const result = await raw.rpc("purge_owner", { p_user_id: owned.owner.id, p_reason: "smoke" });
    expect(result.error).toBeNull();
    const counts = result.data as Record<string, number>;
    expect(counts).toMatchObject({ companies: 2, actions: 6, ledger_entries: 2, audit_tool_calls: 2, campaigns: 2, credit_entries: 2, billing_events: 1, exports: 3, entitlements: 1, users: 1, connection_secrets: 1 });
    expect(Object.values(await remaining(owned.owner.id, [owned.companyId, second], connection)).every((n) => n === 0)).toBe(true);
    const hash = createHash("sha256").update(owned.owner.id).digest("hex");
    const log = await raw.from("purge_log").select("user_hash, reason, counts").eq("user_hash", hash);
    expect(log.data).toEqual([{ user_hash: hash, reason: "smoke", counts }]);
    expect(JSON.stringify(log.data)).not.toContain(owned.owner.id);
    const deleted = await raw.auth.admin.deleteUser(owned.owner.id);
    expect(deleted.error).toBeNull();
  });

  it("the append-only triggers are enabled again afterwards: updates and deletes still raise, for the service role too", async () => {
    const action = (await raw.from("actions").select("id").eq("company_id", witness.companyId).limit(1).single()).data!.id;
    expect((await raw.from("actions").update({ description: "rewritten" }).eq("id", action)).error?.message).toMatch(/append-only/);
    expect((await raw.from("actions").delete().eq("id", action)).error?.message).toMatch(/append-only/);
    expect((await raw.from("ledger_entries").update({ after_value: 99 }).eq("company_id", witness.companyId)).error?.message).toMatch(/append-only/);
    expect((await raw.from("audit_tool_calls").delete().eq("company_id", witness.companyId)).error?.message).toMatch(/append-only/);
    expect((await raw.from("credit_entries").delete().eq("user_id", witness.owner.id)).error?.message).toMatch(/append-only/);
    expect((await raw.from("purge_log").delete().neq("reason", "")).error?.message).toMatch(/append-only/);
    expect((await raw.from("actions").select("id", { count: "exact", head: true }).eq("company_id", witness.companyId)).count).toBe(3);
  });
});
