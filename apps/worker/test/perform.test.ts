import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { verifyUnsubscribeToken } from "@north/core";
import { SANDBOX_OUTREACH_MAILBOX, type OutreachSendInput, type SandboxEvent } from "@north/integrations";
import { SANDBOX_UNSUBSCRIBE_SECRET } from "../src/env";
import { emptyState, FAKE_SENDER_IDENTITY, fakeDbModule, fakeDeps, type FakeState } from "./fake-db";

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
const { SenderIdentityRequiredError, UnsubscribeSecretRequiredError } = await import("../src/services/outreach-compliance");

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

describe("performAction: compliance on the wire (CMP-1)", () => {
  const PUBLIC_URL = "https://worker.north.example";
  /** Sandbox deps whose public URL is a real-looking host, and a spy on what reaches the outreach adapter. */
  function wired(mode: "sandbox" | "live" = "sandbox", env: Record<string, unknown> = {}) {
    const base = fakeDeps(state, events, 200, mode, root);
    const sent: OutreachSendInput[] = [];
    const outreach = base.integrations.outreach(null);
    const spy = { ...outreach, send: (input: OutreachSendInput) => (sent.push(input), outreach.send(input)), replies: outreach.replies.bind(outreach), status: outreach.status.bind(outreach) };
    const deps = { ...base, env: { ...base.env, NORTH_WORKER_PUBLIC_URL: PUBLIC_URL, ...env } as typeof base.env, integrations: { ...base.integrations, outreach: () => spy } };
    return { deps, sent };
  }
  async function newLead(email = "ada@example.test") {
    await dbModule.importLeads(null, "company-1", [{ name: "Ada", email }], "upload");
    return [...state.leads.values()].find((l) => l.email === email)!;
  }
  const firstContact = (leadId: string, extra: Record<string, unknown> = {}) => ({ kind: "email.send.first_contact" as const, companyId: "company-1", agentRole: "sales", description: "Hi Ada", payload: { to: "ada@example.test", subject: "Hi Ada", text: "Body", leadId, ...extra } });

  it("CMP-1: the sandbox send input carries the footer with the legal name and postal address, and List-Unsubscribe under NORTH_WORKER_PUBLIC_URL with a token for { companyId, email }", async () => {
    const { deps, sent } = wired();
    const lead = await newLead();
    const result = await performAction(deps, firstContact(lead.id));
    const input = sent[0]!;
    expect(input.footer).toContain(FAKE_SENDER_IDENTITY.legalName);
    expect(input.footer).toContain(FAKE_SENDER_IDENTITY.postalAddress);
    expect(input.unsubscribe?.mailto).toBe(`${SANDBOX_OUTREACH_MAILBOX}?subject=unsubscribe`);
    const url = input.unsubscribe?.url ?? "";
    expect(url.startsWith(`${PUBLIC_URL}/u/`)).toBe(true);
    expect(input.footer?.endsWith(url)).toBe(true);
    expect(verifyUnsubscribeToken(url.slice(`${PUBLIC_URL}/u/`.length), SANDBOX_UNSUBSCRIBE_SECRET)).toEqual({ companyId: "company-1", email: "ada@example.test" });
    // The sandbox record keeps both, so a test (or the e2e) can read them back.
    const record = JSON.parse(await readFile(join(root, "mail", `${result.externalRef}.json`), "utf8"));
    expect(record).toMatchObject({ footer: input.footer, unsubscribe: input.unsubscribe });
  });

  it("CMP-1: a reply carries the footer and List-Unsubscribe too", async () => {
    const { deps, sent } = wired();
    const lead = await newLead();
    Object.assign(lead, { status: "replied", messageId: "sandbox:msg:first" });
    await performAction(deps, { kind: "email.send.reply", companyId: "company-1", agentRole: "sales", description: "Re", payload: { to: "ada@example.test", subject: "Re", text: "t", leadId: lead.id } });
    expect(sent[0]).toMatchObject({ kind: "reply", footer: expect.stringContaining(FAKE_SENDER_IDENTITY.postalAddress), unsubscribe: { url: expect.stringMatching(/^https:\/\/worker\.north\.example\/u\//) } });
  });

  it("CMP-1: live mode without an unsubscribe secret, or a company without a sender identity, throws before any send and leaves the lead unclaimed", async () => {
    const lead = await newLead();
    const { deps: noSecret, sent } = wired("live", { UNSUBSCRIBE_SECRET: undefined, WORKER_HOST: "0.0.0.0" });
    await expect(performAction(noSecret, firstContact(lead.id))).rejects.toBeInstanceOf(UnsubscribeSecretRequiredError);
    await expect(performAction(noSecret, firstContact(lead.id))).rejects.not.toThrow(/fake-live-unsubscribe-secret/);
    state.senderIdentities.set("company-1", null);
    const { deps: noIdentity } = wired();
    await expect(performAction(noIdentity, firstContact(lead.id))).rejects.toBeInstanceOf(SenderIdentityRequiredError);
    expect(sent).toEqual([]);
    expect(events).toEqual([]);
    expect(state.leads.get(lead.id)).toMatchObject({ status: "new", contactActionId: null });
  });

  it("CMP-1: cc and bcc reach the adapter only as arrays of plain addresses read from those keys; other payload keys never do", async () => {
    const { deps, sent } = wired();
    const lead = await newLead();
    await performAction(deps, firstContact(lead.id, { cc: "Dev <Dev@Example.test>, ops@example.test", bcc: ["audit@example.test"], headers: "Bcc: evil@example.test", replyTo: "evil@example.test" }));
    expect(sent[0]?.cc).toEqual(["dev@example.test", "ops@example.test"]);
    expect(sent[0]?.bcc).toEqual(["audit@example.test"]);
    expect(Object.keys(sent[0]!).sort()).toEqual(["bcc", "cc", "companyId", "footer", "kind", "subject", "text", "to", "unsubscribe"]);
    expect(JSON.stringify(sent[0])).not.toContain("evil@example.test");
    const other = await newLead("bob@example.test");
    for (const cc of ["dev@example.test\r\nBcc: evil@example.test", { address: "dev@example.test" }, ["dev@example.test", 7]]) {
      await expect(performAction(deps, { ...firstContact(other.id, { cc }), payload: { ...firstContact(other.id, { cc }).payload, to: "bob@example.test" } })).rejects.toThrow(/cc/);
    }
    expect(sent).toHaveLength(1);
    expect(state.leads.get(other.id)).toMatchObject({ status: "new" });
  });
});
