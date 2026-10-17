// TST-5 / CMP-1: the fence and the outreach rules at the gate, end to end through `gateAction` on the worker fakes.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { gate, type ActionSpec } from "@north/core";
import type { CampaignRecord } from "@north/db";
import type { SandboxEvent } from "@north/integrations";
import { adsStart, directSteps, emptyState, fakeDbModule, fakeDeps, seedCompany, seedTask, type FakeConnection, type FakeState } from "./fake-db";

/**
 * TST-5 / CMP-1 at the gate (worker fakes): `gateFor` tells `gate()` the
 * fence targets and the outreach facts, and a block it returns is recorded
 * with a marker (`test_fence`, `outreach_policy`) and a `blocked_reason` that
 * names the target, the address or the missing identity. With the fence off
 * everything behaves as before (the rest of the worker suite).
 */

const state: FakeState = emptyState();
const dbModule = fakeDbModule(state);
vi.mock("@north/db", () => dbModule);

const { gateAction } = await import("../src/services/actions");
const { pauseForCap } = await import("../src/services/campaigns");
const { fenceTargetsOf } = await import("../src/services/fence-targets");
const { fencePolicyFor } = await import("../src/env");

type FenceLists = { readonly meta?: string; readonly owners?: string; readonly domains?: string };
/** The fence as the worker builds it from its env (`fencePolicyFor`), on. */
const fenceOn = (lists: FenceLists = {}) =>
  fencePolicyFor({ NORTH_TEST_FENCE: "1", NORTH_FENCE_META_AD_ACCOUNTS: lists.meta, NORTH_FENCE_GITHUB_OWNERS: lists.owners, NORTH_FENCE_RECIPIENT_DOMAINS: lists.domains ?? "resend.app", NORTH_FENCE_VERCEL_PREFIX: undefined });

let events: SandboxEvent[];
const deps = (opts: { fence?: FenceLists | false; mode?: "sandbox" | "live" } = {}) => {
  const base = fakeDeps(state, events, 200, opts.mode ?? "sandbox");
  return opts.fence === false || opts.fence === undefined ? base : { ...base, fence: fenceOn(opts.fence) };
};

beforeEach(() => {
  Object.assign(state, emptyState());
  state.budgets.set("company-1", [{ category: "ads", totalLimitUsd: 300, dailyLimitUsd: 20, spentTotalUsd: 0, spentTodayUsd: 0 }]);
  events = [];
  dbModule.getConnection.mockReset();
});

async function lead(email: string): Promise<string> {
  await dbModule.importLeads(null, "company-1", [{ name: email, email }], "upload");
  return [...state.leads.values()].find((l) => l.email === email)!.id;
}

const first = (to: string, extra: Record<string, unknown> = {}): ActionSpec => ({ kind: "email.send.first_contact", companyId: "x", agentRole: "x", description: `Email ${to}`, payload: { to, subject: "Hello", text: "t", ...extra } });
const deploy = (name: string): ActionSpec => ({ kind: "deploy.preview", companyId: "x", agentRole: "x", description: `Preview ${name}`, payload: { name, files: [{ path: "index.html", content: "<h1>x</h1>" }] } });
const last = () => state.actions.at(-1)!;

describe("TST-5 fence at the gate", () => {
  it("TST-5 a first contact outside the allowed domains is recorded blocked test_fence, naming the address; no card", async () => {
    const task = seedTask(state, { role: "sales", taskType: "outreach_batch" });
    await lead("x@gmail.com");
    const gated = await gateAction(deps({ fence: {} }), task.id, first("x@gmail.com"));
    expect(gated).toMatchObject({ kind: "blocked", reason: "test_fence" });
    expect(last()).toMatchObject({ status: "blocked", kind: "email.send.first_contact", payload: { test_fence: true, gate: "block" } });
    expect(String(last().payload.blocked_reason)).toContain("x@gmail.com");
    expect((last().payload.reasons as string[]).at(-1)).toBe("test_fence");
    expect(state.cards.size).toBe(0);
  });

  it("TST-5 the worker's record and core gate() agree on the same input", async () => {
    const task = seedTask(state, { role: "sales", taskType: "outreach_batch" });
    const spec = { ...first("x@gmail.com"), companyId: "company-1", agentRole: "sales" };
    const decision = gate(spec, { killSwitchActive: false, budgets: [], autoRules: [], cardDueAt: "2026-10-18T00:00:00.000Z", fence: { policy: fenceOn(), targets: fenceTargetsOf(spec, { mode: "sandbox", connection: null }) } });
    expect(decision).toMatchObject({ kind: "block" });
    expect(decision.reasons.at(-1)).toBe("test_fence");
    await gateAction(deps({ fence: {} }), task.id, first("x@gmail.com"));
    expect(last().payload.reasons).toEqual([...decision.reasons]);
  });

  it("TST-5 a first contact to an allowed subdomain opens its card", async () => {
    const task = seedTask(state, { role: "sales", taskType: "outreach_batch" });
    await lead("x@mail.resend.app");
    expect(await gateAction(deps({ fence: {} }), task.id, first("x@mail.resend.app"))).toMatchObject({ kind: "card" });
    expect(state.cards.size).toBe(1);
  });

  it("TST-5 a copy outside the fence blocks the send even when `to` is inside", async () => {
    const task = seedTask(state, { role: "sales", taskType: "outreach_batch" });
    await lead("x@mail.resend.app");
    expect(await gateAction(deps({ fence: {} }), task.id, first("x@mail.resend.app", { bcc: "boss@gmail.com" }))).toMatchObject({ kind: "blocked", reason: "test_fence" });
    expect(String(last().payload.blocked_reason)).toContain("boss@gmail.com");
  });

  it("TST-5 deploy.preview: `site` is blocked naming it, `e2e-site` goes on to run", async () => {
    const task = seedTask(state, { role: "engineering", taskType: "build_site" });
    expect(await gateAction(deps({ fence: {} }), task.id, deploy("site"))).toMatchObject({ kind: "blocked", reason: "test_fence" });
    expect(last()).toMatchObject({ status: "blocked", payload: { test_fence: true, blocked_reason: "vercel_project site is outside the test fence" } });
    expect(await gateAction(deps({ fence: {} }), task.id, deploy("e2e-site"))).toMatchObject({ kind: "execute", tier: "K1" });
  });

  it("TST-5 with the fence off everything behaves as before", async () => {
    const task = seedTask(state, { role: "sales", taskType: "outreach_batch" });
    await lead("x@gmail.com");
    expect(await gateAction(deps(), task.id, first("x@gmail.com"))).toMatchObject({ kind: "card" });
    const build = seedTask(state, { role: "engineering", taskType: "build_site" });
    expect(await gateAction(deps(), build.id, deploy("site"))).toMatchObject({ kind: "execute" });
    expect(state.actions.some((a) => a.payload.test_fence)).toBe(false);
  });

  it("TST-5 sandbox mode: ads.* has no provider target, so the fence lets it through to its card", async () => {
    const task = seedTask(state);
    expect(await gateAction(deps({ fence: {} }), task.id, adsStart())).toMatchObject({ kind: "card" });
  });

  it("TST-5 live mode: ads.* with no connection is blocked as an unknown target", async () => {
    seedCompany(state);
    const task = seedTask(state);
    expect(await gateAction(deps({ fence: {}, mode: "live" }), task.id, adsStart())).toMatchObject({ kind: "blocked", reason: "test_fence" });
    expect(last()).toMatchObject({ status: "blocked", tier: "K2", payload: { test_fence: true, blocked_reason: "unknown target for ads.start" } });
  });

  it("TST-5 live mode: the connection's act:123 passes a fence listing 123 or act_123, and act:999 is blocked naming act_999", async () => {
    seedCompany(state);
    const task = seedTask(state);
    const connect = (act: string) => dbModule.getConnection.mockImplementation(async () => ({ id: "c-meta", provider: "meta_ads", status: "connected", scopes: [`act:${act}`], accountLabel: "Test Ads" }));
    connect("123");
    expect(await gateAction(deps({ fence: { meta: "123" }, mode: "live" }), task.id, adsStart())).toMatchObject({ kind: "card" });
    const other = seedTask(state);
    expect(await gateAction(deps({ fence: { meta: "act_123" }, mode: "live" }), other.id, adsStart({ description: "Second campaign" }))).toMatchObject({ kind: "card" });
    connect("999");
    const third = seedTask(state);
    expect(await gateAction(deps({ fence: { meta: "123" }, mode: "live" }), third.id, adsStart({ description: "Third campaign" }))).toMatchObject({ kind: "blocked", reason: "test_fence" });
    expect(last().payload.blocked_reason).toBe("meta_ad_account act_999 is outside the test fence");
  });

  it("TST-5 the kill switch answers first: a fenced action under the kill switch is recorded as the kill switch's", async () => {
    const task = seedTask(state, { role: "engineering", taskType: "build_site" });
    state.killSwitch.set("company-1", true);
    const gated = await gateAction(deps({ fence: {} }), task.id, deploy("site"));
    expect(gated).toMatchObject({ kind: "blocked" });
    expect(gated.kind === "blocked" && gated.reason).toContain("kill_switch");
    expect(last().payload.test_fence).toBeUndefined();
  });

  it("TST-5 K0 internal work never meets the fence", async () => {
    const task = seedTask(state, { role: "research", taskType: "market_report" });
    expect(await gateAction(deps({ fence: {}, mode: "live" }), task.id, { kind: "research", companyId: "x", agentRole: "x", description: "Search the market" })).toMatchObject({ kind: "executed" });
  });
});

describe("CMP-1 at the gate", () => {
  it("CMP-1 a first contact whose lead is suppressed is blocked outreach_policy, naming the address; no card", async () => {
    const task = seedTask(state, { role: "sales", taskType: "outreach_batch" });
    await lead("mara@example.test");
    state.suppressions.push({ companyId: "company-1", email: "mara@example.test" });
    expect(await gateAction(deps(), task.id, first("mara@example.test"))).toMatchObject({ kind: "blocked", reason: "outreach_policy" });
    expect(last()).toMatchObject({ status: "blocked", payload: { outreach_policy: true, blocked_reason: "suppressed: mara@example.test" } });
    expect((last().payload.reasons as string[]).at(-1)).toBe("suppressed");
    expect(state.cards.size).toBe(0);
  });

  it("CMP-1 without a sender identity the send is blocked outreach_policy: no sender identity", async () => {
    const task = seedTask(state, { role: "sales", taskType: "outreach_batch" });
    await lead("mara@example.test");
    state.senderIdentities.set("company-1", null);
    expect(await gateAction(deps(), task.id, first("mara@example.test"))).toMatchObject({ kind: "blocked", reason: "outreach_policy" });
    expect(last()).toMatchObject({ payload: { outreach_policy: true, blocked_reason: "no_sender_identity: no sender identity" } });
    expect(state.cards.size).toBe(0);
  });

  it("CMP-1 with a clean lead and a sender identity the card opens", async () => {
    const task = seedTask(state, { role: "sales", taskType: "outreach_batch" });
    await lead("mara@example.test");
    state.suppressions.push({ companyId: "company-1", email: "other.io" });
    expect(await gateAction(deps(), task.id, first("mara@example.test"))).toMatchObject({ kind: "card" });
  });

  it("CMP-1 a cc to a suppressed address blocks even when `to` is clean", async () => {
    const task = seedTask(state, { role: "sales", taskType: "outreach_batch" });
    await lead("mara@example.test");
    state.suppressions.push({ companyId: "company-1", email: "blocked.io" });
    expect(await gateAction(deps(), task.id, first("mara@example.test", { cc: "Boss <boss@blocked.io>" }))).toMatchObject({ kind: "blocked", reason: "outreach_policy" });
    expect(last().payload.blocked_reason).toBe("suppressed: boss@blocked.io");
  });

  it("CMP-1 a reply to a suppressed address is blocked too", async () => {
    const task = seedTask(state, { role: "sales", taskType: "outreach_batch" });
    const leadId = await lead("mara@example.test");
    state.suppressions.push({ companyId: "company-1", email: "mara@example.test" });
    const reply: ActionSpec = { kind: "email.send.reply", companyId: "x", agentRole: "x", description: "Reply", payload: { to: "mara@example.test", subject: "Re", text: "t", leadId } };
    expect(await gateAction(deps(), task.id, reply)).toMatchObject({ kind: "blocked", reason: "outreach_policy" });
  });

  it("CMP-1 the batch scope reads core's list: a copy to someone who is not a new lead refuses the card (batch_mismatch)", async () => {
    const task = seedTask(state, { role: "sales", taskType: "outreach_batch" });
    await lead("mara@example.test");
    expect(await gateAction(deps(), task.id, first("mara@example.test", { cc: "Boss <boss@example.test>" }))).toMatchObject({ kind: "blocked", reason: "batch_mismatch" });
    expect(last().payload.blocked_reason).toBe("batch_mismatch: boss@example.test is not a new lead of this company");
    expect(state.cards.size).toBe(0);
  });

  it("CMP-1 a later send of a batch that copies someone off the card's list cannot ride on the card", async () => {
    const task = seedTask(state, { role: "sales", taskType: "outreach_batch" });
    const recipients = ["a@example.test", "b@example.test"];
    for (const r of recipients) await lead(r);
    const send = (to: string, extra: Record<string, unknown> = {}) => first(to, { batchId: `batch-${task.id}`, recipients, ...extra });
    expect(await gateAction(deps(), task.id, send("a@example.test"))).toMatchObject({ kind: "card" });
    expect(await gateAction(deps(), task.id, send("b@example.test", { bcc: "c@example.test" }))).toMatchObject({ kind: "blocked", reason: "batch_mismatch" });
    expect(last().payload.blocked_reason).toBe("batch_mismatch: c@example.test is not on the card's list");
    expect(await gateAction(deps(), task.id, send("b@example.test"))).toMatchObject({ kind: "card" });
  });

  it("CMP-1 the fence answers before the outreach rules", async () => {
    const task = seedTask(state, { role: "sales", taskType: "outreach_batch" });
    await lead("x@gmail.com");
    state.suppressions.push({ companyId: "company-1", email: "x@gmail.com" });
    expect(await gateAction(deps({ fence: {} }), task.id, first("x@gmail.com"))).toMatchObject({ kind: "blocked", reason: "test_fence" });
  });
});

describe("TST-5 fix round 1: repository names, stop-spend kinds, failing reads", () => {
  const connect = (row: FakeConnection) => dbModule.getConnection.mockImplementation(async () => row);
  const github = (login: string) => connect({ id: "c-gh", status: "connected", scopes: ["repo"], accountLabel: login });
  const push = (fullName: string): ActionSpec => ({ kind: "repo.push", companyId: "x", agentRole: "x", description: `Push to ${fullName}`, payload: { fullName, branch: "main", message: "m", files: [{ path: "index.html", content: "x" }] } });
  const pr = (fullName: string): ActionSpec => ({ kind: "repo.pull_request", companyId: "x", agentRole: "x", description: `PR in ${fullName}`, payload: { fullName, head: "fix/x", base: "main", title: "Fix", body: "" } });

  it("TST-5 live: a dot-segment or percent-encoded fullName is blocked as an unknown target, for a push and a pull request", async () => {
    seedCompany(state);
    github("allowed");
    const task = seedTask(state, { role: "engineering", taskType: "build_site" });
    for (const fullName of ["allowed/../victim/repo", "allowed/%2e%2e/victim/repo"]) {
      expect(await gateAction(deps({ fence: { owners: "allowed" }, mode: "live" }), task.id, push(fullName)), fullName).toMatchObject({ kind: "blocked", reason: "test_fence" });
      expect(last().payload.blocked_reason).toBe("unknown target for repo.push");
      expect(await gateAction(deps({ fence: { owners: "allowed" }, mode: "live" }), task.id, pr(fullName)), fullName).toMatchObject({ kind: "blocked", reason: "test_fence" });
      expect(last().payload.blocked_reason).toBe("unknown target for repo.pull_request");
    }
  });

  it("TST-5 live: a real Owner/repo.name-1 inside the fence goes on; a login outside the fence is blocked naming it", async () => {
    seedCompany(state);
    const task = seedTask(state, { role: "engineering", taskType: "build_site" });
    github("north-e2e");
    expect(await gateAction(deps({ fence: { owners: "north-e2e, Owner" }, mode: "live" }), task.id, push("Owner/repo.name-1"))).toMatchObject({ kind: "execute", tier: "K1" });
    github("octo-real");
    expect(await gateAction(deps({ fence: { owners: "north-e2e, Owner" }, mode: "live" }), task.id, push("Owner/repo.name-1"))).toMatchObject({ kind: "blocked", reason: "test_fence" });
    expect(last().payload.blocked_reason).toBe("github_owner octo-real is outside the test fence");
  });

  it("TST-5 a cap pause goes through with the fence on even when the Meta account is outside it", async () => {
    seedCompany(state);
    connect({ id: "c-meta", status: "connected", scopes: ["act:999"], accountLabel: "Real Ads" });
    const fenced = deps({ fence: { meta: "123" }, mode: "live" });
    const started = await fenced.integrations.ads(null).startCampaign({ companyId: "company-1", name: "Launch", dailyBudgetUsd: 10 });
    const campaign = (await dbModule.registerCampaign(null, { companyId: "company-1", taskId: null, actionId: "action-launch", provider: "meta_ads", providerCampaignId: started.campaignId, name: "Launch", metricKey: "signups", dailyBudgetUsd: 10, totalBudgetUsd: 50, status: "active" })) as unknown as CampaignRecord;
    const run = await pauseForCap(fenced, directSteps, campaign, "daily", new Date().toISOString().slice(0, 10));
    expect(run.gated).toMatchObject({ kind: "execute", tier: "K1" });
    expect(run.completed).toMatchObject({ status: "notified" });
    expect(state.actions.some((a) => a.payload.test_fence)).toBe(false);
    const task = seedTask(state);
    expect(await gateAction(fenced, task.id, adsStart())).toMatchObject({ kind: "blocked", reason: "test_fence" });
  });

  it("TST-5 / CMP-1 a read that fails (suppressions, connection) fails the gate closed: it rejects, no row, no card", async () => {
    seedCompany(state);
    const task = seedTask(state, { role: "sales", taskType: "outreach_batch" });
    await lead("mara@example.test");
    dbModule.listSuppressed.mockRejectedValueOnce(new Error("suppressions unreadable"));
    await expect(gateAction(deps(), task.id, first("mara@example.test"))).rejects.toThrow(/suppressions unreadable/);
    dbModule.getConnection.mockRejectedValueOnce(new Error("connections unreadable"));
    const ads = seedTask(state);
    await expect(gateAction(deps({ fence: { meta: "123" }, mode: "live" }), ads.id, adsStart())).rejects.toThrow(/connections unreadable/);
    expect(state.actions).toEqual([]);
    expect(state.cards.size).toBe(0);
  });
});
