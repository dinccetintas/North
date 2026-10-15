import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SandboxEvent } from "@north/integrations";
import { emptyState, fakeDbModule, fakeDeps, type FakeState } from "./fake-db";

/**
 * D4-1 `performAction`: which connection each kind runs on, the landing URL a
 * campaign gets, the cap raise's external reference, pause/resume by row id,
 * and BUD-1 at perform time (a cap reached since the card was approved stops
 * the action before any provider is touched).
 */

const state: FakeState = emptyState();
const dbModule = fakeDbModule(state);
vi.mock("@north/db", () => dbModule);

const { performAction } = await import("../src/services/perform");
const { BudgetCapReachedError } = await import("../src/services/budget-check");

let events: SandboxEvent[];
let root: string;
const today = new Date().toISOString().slice(0, 10);

const adsStart = { kind: "ads.start" as const, companyId: "company-1", agentRole: "growth", description: "Start the launch test", amountUsd: 50, category: "ads" as const, payload: { name: "Launch test", dailyBudgetUsd: 10, audience: "solo consultants", creativeMarkdown: "# Hi", targeting: { countries: ["US", "GB"], ageMin: 25, ageMax: 55 } } };

beforeEach(async () => {
  Object.assign(state, emptyState());
  state.budgets.set("company-1", [{ category: "ads", totalLimitUsd: 100, dailyLimitUsd: 10, spentTotalUsd: 0, spentTodayUsd: 0 }]);
  events = [];
  root = await mkdtemp(join(tmpdir(), "north-perform-"));
});

describe("performAction (D4-1)", () => {
  it("ads.start fills the landing URL from the company's live site (else its preview) when the payload has none, and passes the targeting through", async () => {
    state.site = { live: null, preview: "http://127.0.0.1:3101/sandbox/sites/abc/" };
    const deps = fakeDeps(state, events, 200, "sandbox", root);
    const result = await performAction(deps, adsStart);
    expect(result.externalRef).toMatch(/^sandbox:campaign:/);
    expect(result.meta).toEqual({ landingUrl: "http://127.0.0.1:3101/sandbox/sites/abc/" });
    expect(events[0]).toMatchObject({ provider: "ads", op: "startCampaign", payload: { dailyBudgetUsd: 10, landingUrl: "http://127.0.0.1:3101/sandbox/sites/abc/", targeting: { countries: ["US", "GB"], ageMin: 25, ageMax: 55 } } });
    state.site = { live: "https://lumen.example", preview: "http://127.0.0.1:3101/sandbox/sites/abc/" };
    expect((await performAction(deps, adsStart)).meta).toEqual({ landingUrl: "https://lumen.example" });
    expect((await performAction(deps, { ...adsStart, payload: { ...adsStart.payload, landingUrl: "https://given.example/page" } })).meta).toEqual({ landingUrl: "https://given.example/page" });
  });

  it("BUD-1: a start whose daily budget no longer fits today's cap is refused before the adapter is called", async () => {
    const deps = fakeDeps(state, events, 200, "sandbox", root);
    state.budgets.set("company-1", [{ category: "ads", totalLimitUsd: 100, dailyLimitUsd: 10, spentTotalUsd: 11, spentTodayUsd: 11 }]);
    await expect(performAction(deps, adsStart)).rejects.toBeInstanceOf(BudgetCapReachedError);
    state.budgets.set("company-1", [{ category: "ads", totalLimitUsd: 100, dailyLimitUsd: 5, spentTotalUsd: 0, spentTodayUsd: 0 }]);
    await expect(performAction(deps, adsStart)).rejects.toThrow(/exceeds today's ads cap/);
    state.budgets.set("company-1", [{ category: "ads", totalLimitUsd: 50, dailyLimitUsd: 10, spentTotalUsd: 50, spentTodayUsd: 0 }]);
    await expect(performAction(deps, adsStart)).rejects.toThrow(/total cap/);
    expect(events).toEqual([]);
  });

  it("ads.pause / ads.resume name the campaign by its row id and reach the provider by its provider id; a resume is checked against the caps first", async () => {
    const deps = fakeDeps(state, events, 200, "sandbox", root);
    const started = await performAction(deps, adsStart);
    const row = await dbModule.registerCampaign(null, { companyId: "company-1", taskId: null, actionId: "action-1", provider: "meta_ads", providerCampaignId: started.externalRef, name: "Launch test", metricKey: "signups", dailyBudgetUsd: 10, totalBudgetUsd: 50 });
    const pause = await performAction(deps, { kind: "ads.pause", companyId: "company-1", agentRole: "growth", description: "Pause", payload: { campaignId: row.id, reason: "cap" } });
    expect(pause).toEqual({ externalRef: `paused:${started.externalRef}`, sandbox: true });
    expect(await deps.integrations.ads(null).status("company-1", started.externalRef)).toBe("paused");
    await dbModule.setCampaignStatus(null, row.id, "paused_cap", { pausedDay: today });
    const resume = await performAction(deps, { kind: "ads.resume", companyId: "company-1", agentRole: "growth", description: "Resume", payload: { campaignIds: [row.id], reason: "day_roll" } });
    expect(resume.externalRef).toBe(`resumed:${started.externalRef}`);
    expect(await deps.integrations.ads(null).status("company-1", started.externalRef)).toBe("active");
    state.budgets.set("company-1", [{ category: "ads", totalLimitUsd: 100, dailyLimitUsd: 10, spentTotalUsd: 11, spentTodayUsd: 11 }]);
    await expect(performAction(deps, { kind: "ads.resume", companyId: "company-1", agentRole: "growth", description: "Resume", payload: { campaignId: row.id, reason: "cap_raised" } })).rejects.toBeInstanceOf(BudgetCapReachedError);
    await expect(performAction(deps, { kind: "ads.pause", companyId: "company-1", agentRole: "growth", description: "Pause", payload: {} })).rejects.toThrow(/no campaign id/);
  });

  it("budget.cap.raise raises today's cap (or the total cap) on North's own budget row with the reference cap:<category>:<day>:+<usd>", async () => {
    const deps = fakeDeps(state, events, 200, "sandbox", root);
    const daily = await performAction(deps, { kind: "budget.cap.raise", companyId: "company-1", agentRole: "growth", description: "Raise today's cap by $10?", amountUsd: 10, category: "ads", payload: { campaignId: "x", resumeCampaignId: "x", cap: "daily", day: today, spentUsd: 11, capUsd: 10 } });
    expect(daily).toEqual({ externalRef: `cap:ads:${today}:+10`, sandbox: true });
    expect(state.budgets.get("company-1")?.[0]).toMatchObject({ dailyExtraUsd: 10, totalLimitUsd: 100 });
    const total = await performAction(deps, { kind: "budget.cap.raise", companyId: "company-1", agentRole: "growth", description: "Raise the total cap by $40?", amountUsd: 40, category: "ads", payload: { campaignId: "x", resumeCampaignId: "x", cap: "total", day: today, spentUsd: 100, capUsd: 100 } });
    expect(total.externalRef).toBe(`cap:ads:${today}:+40`);
    expect(state.budgets.get("company-1")?.[0]).toMatchObject({ dailyExtraUsd: 10, totalLimitUsd: 140 });
    expect(events).toEqual([]);
  });

  it("every email kind leaves through the outreach provider (the user's mailbox); kinds without an adapter throw", async () => {
    const deps = fakeDeps(state, events, 200, "sandbox", root);
    await dbModule.importLeads(null, "company-1", [{ name: "a", email: "a@example.test" }], "upload");
    const lead = [...state.leads.values()][0]!;
    Object.assign(lead, { status: "replied", messageId: "sandbox:msg:first" });
    const reply = await performAction(deps, { kind: "email.send.reply", companyId: "company-1", agentRole: "sales", description: "Re", payload: { to: "a@example.test", subject: "Re", text: "t", leadId: lead.id } });
    expect(reply.externalRef).toMatch(/^sandbox:msg:/);
    expect(events.map((e) => `${e.provider}:${e.op}`)).toEqual(["outreach:send"]);
    expect(events[0]?.payload).toMatchObject({ kind: "reply" });
    await expect(performAction(deps, { kind: "social.publish", companyId: "company-1", agentRole: "growth", description: "Post" })).rejects.toThrow(/No adapter/);
  });
});
