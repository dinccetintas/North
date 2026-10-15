import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentRunResult } from "@north/agents";
import type { SandboxEvent } from "@north/integrations";
import { emptyState, fakeDbModule, fakeDeps, seedTask, type FakeState } from "./fake-db";

/**
 * D4-7: a `lead_research` run's `output.leads` lands in `leads` once (source
 * research, duplicates skipped); the company context hands an outreach batch
 * the next unsent leads as `vars.leads` and a campaign spec the site URL.
 */

const state: FakeState = emptyState();
const dbModule = fakeDbModule(state);
vi.mock("@north/db", () => dbModule);

const { executeTask } = await import("../src/services/execute-task");
const { companyContext } = await import("../src/services/company-context");

let events: SandboxEvent[];

const LEADS = [
  { name: "Mara Lindqvist", email: "mara@example.test", company: "Northwind Studio", why: "Hiring a bookkeeper" },
  { name: "Dev Okafor", email: "dev@example.test", company: "Okafor Consulting", why: "Closes the month by hand" },
];

const researchRuntime = (seen: Record<string, string | undefined>[]) => ({
  name: "mock" as const,
  run: async (input: { vars?: Readonly<Record<string, string>> }): Promise<AgentRunResult> => {
    seen.push({ ...input.vars });
    return {
      status: "succeeded",
      output: { summary: "Five leads from public research.", artifacts: [{ kind: "lead_list", title: "Lead list", markdown: "# Leads" }], memory: [], actions: [], leads: LEADS, confidence: "medium" },
      actions: [],
      sessionId: "mock-1",
      usage: { model: "mock", inputTokens: 1, outputTokens: 1, costUsd: 0, durationMs: 1 },
    };
  },
});

beforeEach(() => {
  Object.assign(state, emptyState());
  state.companies.set("company-1", { id: "company-1", slug: "lumen", name: "Lumen", ownerId: "user-1" });
  events = [];
});

describe("executeTask persists research leads (D4-7)", () => {
  it("imports output.leads as research rows once; a second run with the same emails imports nothing new", async () => {
    const seen: Record<string, string | undefined>[] = [];
    const deps = { ...fakeDeps(state, events), runtime: researchRuntime(seen) };
    const first = seedTask(state, { role: "sales", taskType: "lead_research", status: "queued", attempts: 0 });
    const result = await executeTask(deps, first.id);
    expect(result.status).toBe("ran");
    expect(result.artifactIds).toHaveLength(1);
    expect([...state.leads.values()].map((l) => [l.email, l.source, l.status])).toEqual([
      ["mara@example.test", "research", "new"],
      ["dev@example.test", "research", "new"],
    ]);
    const second = seedTask(state, { role: "sales", taskType: "lead_research", status: "queued", attempts: 0 });
    await executeTask(deps, second.id);
    expect(state.leads.size).toBe(2);
    expect(seen[0]?.leads).toBeUndefined();
  });
});

describe("companyContext hand-overs", () => {
  it("outreach_batch gets vars.leads (next unsent five, JSON with ids); campaign_spec gets vars['site.url']; other tasks get neither", async () => {
    const deps = fakeDeps(state, events);
    await dbModule.importLeads(null, "company-1", [...LEADS, { name: "X", email: "x@example.test" }], "upload");
    const [contacted] = await dbModule.nextUnsentLeads(null, "company-1", 1);
    await dbModule.markLeads(null, [contacted!.id], "contacted", { batchId: "batch-old" });
    state.site = { live: "https://lumen.example", preview: "http://127.0.0.1:3101/sandbox/sites/x/" };

    const outreach = await companyContext(deps.db, "company-1", "outreach_batch");
    const leads = JSON.parse(outreach.vars.leads ?? "[]") as { id: string; email: string; company: string; why: string }[];
    expect(leads.map((l) => l.email)).toEqual(["dev@example.test", "x@example.test"]);
    expect(leads[0]).toMatchObject({ id: expect.any(String), company: "Okafor Consulting", why: "Closes the month by hand" });
    expect(outreach.vars["site.url"]).toBeUndefined();

    const campaign = await companyContext(deps.db, "company-1", "campaign_spec");
    expect(campaign.vars["site.url"]).toBe("https://lumen.example");
    expect(campaign.vars.leads).toBeUndefined();
    state.site = { live: null, preview: "http://127.0.0.1:3101/sandbox/sites/x/" };
    expect((await companyContext(deps.db, "company-1", "campaign_spec")).vars["site.url"]).toBe("http://127.0.0.1:3101/sandbox/sites/x/");

    const research = await companyContext(deps.db, "company-1", "market_report");
    expect(research.vars.leads).toBeUndefined();
    expect(research.vars["company.name"]).toBe("Lumen");
  });
});
