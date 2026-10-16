import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FIXTURE_LEADS, MockRuntime, mockScripts } from "@north/agents";
import type { SandboxEvent } from "@north/integrations";
import { emptyState, fakeDbModule, fakeDeps, seedCompany, seedTask, type FakeState } from "./fake-db";

/**
 * SLS-K2 / DEC-3: a lead is in at most one open first-contact batch. The
 * batch input skips leads that an open (pending) `email.send.first_contact`
 * of the company already holds, and the gate refuses a batch that names one,
 * so two outreach tasks over the same five leads open one card, not two. A
 * task whose leads are all held ends like a batch with no new lead at all:
 * its sends are blocked, no card opens, it finishes on its artifact.
 */

const state: FakeState = emptyState();
const dbModule = fakeDbModule(state);
vi.mock("@north/db", () => dbModule);

const { gateAction } = await import("../src/services/actions");
const { companyContext } = await import("../src/services/company-context");
const { executeTask } = await import("../src/services/execute-task");
const { finishTaskIfIdle, settleDecision } = await import("../src/services/settle");

let events: SandboxEvent[];
let root: string;

const emails = (names: readonly string[]) => names.map((n) => `${n}@example.test`);
const answer = (cardId: string, optionId: string) => Object.assign(state.cards.get(cardId)!, { answeredOptionId: optionId, answeredAt: new Date().toISOString(), answeredBy: "user" });
const deps = () => fakeDeps(state, events, 200, "sandbox", root);
const leadsVar = async (companyId = "company-1") => (JSON.parse((await companyContext(deps().db, companyId, "outreach_batch")).vars.leads ?? "null") as { id: string; email: string }[]).map((l) => l.email);

async function importLeads(addresses: readonly string[], companyId = "company-1") {
  await dbModule.importLeads(null, companyId, addresses.map((email) => ({ name: email.split("@")[0] ?? email, email })), "upload");
}

const mail = (taskId: string, to: string, recipients: readonly string[]) => ({
  kind: "email.send.first_contact" as const,
  companyId: "x",
  agentRole: "x",
  description: `Email ${to}`,
  payload: { batchId: `batch-${taskId}`, recipients, to, subject: "s", text: "t", leadId: [...state.leads.values()].find((l) => l.email === to)?.id },
});

/** Gates the first `sends` emails of a batch over `recipients` for a new outreach task; returns the task and its card. */
async function openBatch(recipients: readonly string[], sends = recipients.length) {
  const task = seedTask(state, { role: "sales", taskType: "outreach_batch", result: { artifactIds: ["art-1"], costUsd: 0, summary: "batch" } });
  let cardId = "";
  for (const to of recipients.slice(0, sends)) {
    const gated = await gateAction(deps(), task.id, mail(task.id, to, recipients));
    if (gated.kind !== "card") throw new Error(`expected a card, got ${gated.kind}`);
    cardId = gated.cardId;
  }
  return { task, cardId };
}

beforeEach(async () => {
  Object.assign(state, emptyState());
  events = [];
  root = await mkdtemp(join(tmpdir(), "north-overlap-"));
  seedCompany(state);
  seedCompany(state, { id: "company-2", ownerId: "user-2", slug: "other" });
});

describe("SLS-K2: the batch input skips leads an open batch holds", () => {
  it("every recipient on an open card's list is held (not only the sends already attached); a declined card frees them again", async () => {
    await importLeads(emails(["a", "b", "c", "d", "e", "f", "g"]));
    const { cardId } = await openBatch(emails(["a", "b", "c", "d", "e"]), 1);
    expect(await leadsVar()).toEqual(emails(["f", "g"]));

    answer(cardId, "decline");
    expect(await settleDecision(deps(), cardId)).toMatchObject({ kind: "declined" });
    expect(await leadsVar()).toEqual(emails(["a", "b", "c", "d", "e"]));
  });

  it("when every new lead is held, the hand-over is the empty list a company with no new leads gets", async () => {
    await importLeads(emails(["a", "b", "c", "d", "e"]));
    await openBatch(emails(["a", "b", "c", "d", "e"]));
    expect(await leadsVar()).toEqual([]);
    expect((await companyContext(deps().db, "company-1", "outreach_batch")).vars.leads).toBe((await companyContext(deps().db, "company-2", "outreach_batch")).vars.leads);
  });

  it("another company's open batch holds nothing here", async () => {
    await importLeads(emails(["a", "b"]));
    await importLeads(emails(["a", "b"]), "company-2");
    const other = seedTask(state, { companyId: "company-2", role: "sales", taskType: "outreach_batch" });
    expect((await gateAction(deps(), other.id, mail(other.id, "a@example.test", emails(["a", "b"])))).kind).toBe("card");
    expect(await leadsVar()).toEqual(emails(["a", "b"]));
  });
});

describe("SLS-K2: the gate refuses a batch that overlaps an open one (defence in depth)", () => {
  it("a recipient already on an open batch refuses the new batch batch_mismatch before a card opens; no decision is spent", async () => {
    await importLeads(emails(["a", "b", "c", "d", "e", "f"]));
    await openBatch(emails(["a", "b", "c", "d", "e"]), 1);
    const second = seedTask(state, { role: "sales", taskType: "outreach_batch" });
    const gated = await gateAction(deps(), second.id, mail(second.id, "f@example.test", emails(["e", "f"])));
    expect(gated).toMatchObject({ kind: "blocked", reason: "batch_mismatch" });
    expect(state.actions.at(-1)).toMatchObject({ taskId: second.id, status: "blocked", payload: { batch_mismatch: true, blocked_reason: "batch_mismatch: e@example.test is already in an open batch" } });
    expect(state.cards.size).toBe(1);
    expect(state.tasks.get(second.id)?.status).toBe("running");
  });

  it("once the open card is declined, the same batch opens its own card", async () => {
    await importLeads(emails(["a", "b", "c", "d", "e", "f"]));
    const { cardId } = await openBatch(emails(["a", "b", "c", "d", "e"]));
    answer(cardId, "decline");
    await settleDecision(deps(), cardId);
    const second = seedTask(state, { role: "sales", taskType: "outreach_batch" });
    expect((await gateAction(deps(), second.id, mail(second.id, "f@example.test", emails(["e", "f"])))).kind).toBe("card");
    expect(state.cards.size).toBe(2);
  });
});

describe("SLS-K2: a first contact without batchId follows a batch's first-send rules", () => {
  const single = (to: string) => ({ kind: "email.send.first_contact" as const, companyId: "x", agentRole: "x", description: `Email ${to}`, payload: { to, subject: "s", text: "t", leadId: [...state.leads.values()].find((l) => l.email === to)?.id } });
  const refusalOf = () => state.actions.at(-1)?.payload.blocked_reason;

  it("a recipient that is not a new lead of the company, or no recipient at all, is refused before a card opens", async () => {
    await importLeads(emails(["a"]));
    await importLeads(emails(["b"]), "company-2");
    Object.assign([...state.leads.values()].find((l) => l.email === "a@example.test")!, { status: "contacted" });
    const task = seedTask(state, { role: "sales", taskType: "outreach_batch" });
    expect(await gateAction(deps(), task.id, single("a@example.test"))).toMatchObject({ kind: "blocked", reason: "batch_mismatch" });
    expect(refusalOf()).toBe("batch_mismatch: a@example.test is not a new lead of this company");
    expect(await gateAction(deps(), task.id, single("b@example.test"))).toMatchObject({ kind: "blocked", reason: "batch_mismatch" });
    expect(await gateAction(deps(), task.id, { ...single("b@example.test"), payload: { subject: "s", text: "t" } })).toMatchObject({ kind: "blocked", reason: "batch_mismatch" });
    expect(refusalOf()).toBe("batch_mismatch: a first contact needs its recipient");
    expect(state.cards.size).toBe(0);
  });

  it("a lead held by an open batch is refused; a free new lead opens its own card, which then holds it against a batch", async () => {
    await importLeads(emails(["a", "b", "c"]));
    await openBatch(emails(["a", "b"]), 1);
    const task = seedTask(state, { role: "sales", taskType: "outreach_batch" });
    expect(await gateAction(deps(), task.id, single("b@example.test"))).toMatchObject({ kind: "blocked", reason: "batch_mismatch" });
    expect(refusalOf()).toBe("batch_mismatch: b@example.test is already in an open batch");
    expect((await gateAction(deps(), task.id, single("c@example.test"))).kind).toBe("card");
    const batch = seedTask(state, { role: "sales", taskType: "outreach_batch" });
    expect(await gateAction(deps(), batch.id, mail(batch.id, "c@example.test", emails(["c"])))).toMatchObject({ kind: "blocked", reason: "batch_mismatch" });
    expect(state.cards.size).toBe(2);
  });
});

describe("SLS-K2: the gate checks a batch's own recipients, not the 500 oldest new leads", () => {
  it("a batch of the five newest of 505 new leads opens its card", async () => {
    await importLeads(Array.from({ length: 505 }, (_, i) => `l${String(i).padStart(3, "0")}@example.test`));
    const newest = Array.from({ length: 5 }, (_, i) => `l${500 + i}@example.test`);
    const { cardId } = await openBatch(newest);
    expect(state.cards.get(cardId)).toMatchObject({ actionKind: "email.send.first_contact" });
    expect(dbModule.listLeads).toHaveBeenLastCalledWith(expect.anything(), "company-1", expect.objectContaining({ status: ["new"], emails: newest }));
  });
});

describe("0017: the gate opens a first contact's card and its pending row in one call under the outreach lock", () => {
  it("two batches over the same leads gated at the same moment open one card; the other is refused held", async () => {
    await importLeads(emails(["a", "b", "c"]));
    const [first, second] = [seedTask(state, { role: "sales", taskType: "outreach_batch" }), seedTask(state, { role: "sales", taskType: "outreach_batch" })];
    const opens = vi.mocked(dbModule.openFirstContactCard).mock.calls.length;
    const cards = vi.mocked(dbModule.openCard).mock.calls.length;
    const gated = await Promise.all([gateAction(deps(), first.id, mail(first.id, "a@example.test", emails(["a", "b"]))), gateAction(deps(), second.id, mail(second.id, "b@example.test", emails(["b", "c"])))]);
    expect(gated.map((g) => g.kind).sort()).toEqual(["blocked", "card"]);
    expect(state.cards.size).toBe(1);
    expect(state.actions.filter((a) => a.status === "pending")).toHaveLength(1);
    expect(vi.mocked(dbModule.openFirstContactCard).mock.calls.length - opens).toBe(2);
    expect(vi.mocked(dbModule.openCard).mock.calls.length - cards).toBe(0);
  });
});

describe("SLS-K2 / DEC-3: two outreach tasks over the same five leads (the M4 e2e race)", () => {
  const fixtureRun = () => ({ ...deps(), runtime: MockRuntime.fromRecord({ ...mockScripts }) });
  const outreachTask = () => seedTask(state, { role: "sales", taskType: "outreach_batch", metricKey: "email_replies", status: "queued", attempts: 0 });

  /** The second task gated after the first: no card, every send blocked batch_mismatch, done on its artifact, nothing sent. */
  async function expectSecondEndsWithoutCard(run: ReturnType<typeof fixtureRun>, first: string, second: string, gated: readonly { kind: string; reason?: string }[]) {
    expect(state.cards.size).toBe(1);
    expect(gated).toHaveLength(5);
    expect(gated.every((g) => g.kind === "blocked" && g.reason === "batch_mismatch")).toBe(true);
    expect(state.tasks.get(first)?.status).toBe("waiting_decision");
    expect(await finishTaskIfIdle(run, second)).toEqual({ status: "done" });
    expect(state.tasks.get(second)?.evidence).toMatchObject({ kind: "artifact_id" });
    expect(events).toEqual([]);
  }

  beforeEach(async () => {
    // The company's leads are the lead-research fixture's five, so the outreach fixture's
    // fallback prospects (what it sends to when vars.leads is empty) are the leads the first batch holds.
    await dbModule.importLeads(null, "company-1", FIXTURE_LEADS.map((l) => ({ ...l })), "research");
  });

  it("one after the other: the second run gets no lead (the empty hand-over) and its fallback sends are refused at the gate", async () => {
    const run = fixtureRun();
    const [first, second] = [outreachTask(), outreachTask()];
    for (const action of (await executeTask(run, first.id)).pendingActions) await gateAction(run, first.id, action);
    const ranSecond = await executeTask(run, second.id);
    expect(ranSecond.pendingActions.map((a) => a.payload?.leadId)).toEqual([undefined, undefined, undefined, undefined, undefined]);
    const gated = [];
    for (const action of ranSecond.pendingActions) gated.push(await gateAction(run, second.id, action));
    await expectSecondEndsWithoutCard(run, first.id, second.id, gated);
  });

  it("interleaved: both runs read the same five leads before either gates; the gate opens one card and refuses the second batch", async () => {
    const run = fixtureRun();
    const [first, second] = [outreachTask(), outreachTask()];
    const [ranFirst, ranSecond] = [await executeTask(run, first.id), await executeTask(run, second.id)];
    expect(ranSecond.pendingActions.every((a) => typeof a.payload?.leadId === "string")).toBe(true);
    for (const action of ranFirst.pendingActions) await gateAction(run, first.id, action);
    const gated = [];
    for (const action of ranSecond.pendingActions) gated.push(await gateAction(run, second.id, action));
    await expectSecondEndsWithoutCard(run, first.id, second.id, gated);
  });
});
