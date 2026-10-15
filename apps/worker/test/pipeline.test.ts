import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SandboxEvent } from "@north/integrations";
import type { FetchLike } from "../src/services/verifier";
import { directSteps, emptyState, fakeDbModule, fakeDeps, seedTask, type FakeState } from "./fake-db";

const state: FakeState = emptyState();
vi.mock("@north/db", () => fakeDbModule(state));

const { runBuildPipeline } = await import("../src/services/build-pipeline");
const { attemptDecision, escalateTask, retryInstructions } = await import("../src/services/escalate");
const { isPrivateAddress, verifyEvidence, verifyUrl } = await import("../src/services/verifier");
const { settleDecision, finishTaskIfIdle } = await import("../src/services/settle");
const { completeAction, performPending } = await import("../src/services/actions");

const files = [
  { path: "index.html", content: "<h1>Lumen</h1>" },
  { path: "styles.css", content: "h1{}" },
];

let events: SandboxEvent[];

beforeEach(() => {
  Object.assign(state, emptyState());
  state.companies.set("company-1", { id: "company-1", slug: "lumen-ledger", name: "Lumen Ledger", ownerId: "user-1" });
  events = [];
});

describe("runBuildPipeline (M3: repo → push → preview → go-live card)", () => {
  it("records every step through the gate, verifies the preview with a real GET, and parks the task on the go-live card", async () => {
    const task = seedTask(state, { role: "engineering", taskType: "build_site", result: { artifactIds: ["art-1"], costUsd: 0, summary: "built" } });
    const outcome = await runBuildPipeline(fakeDeps(state, events), directSteps, task.id, files);
    expect(outcome.status).toBe("live_card_opened");
    expect(outcome.repoUrl).toBe("sandbox://repos/sandbox/lumen-ledger-site");
    expect(outcome.previewUrl).toMatch(/^http:\/\/127\.0\.0\.1:3101\/sandbox\/sites\/[0-9a-f-]{36}\/$/);
    const heads = state.actions.filter((a) => !state.actions.some((b) => b.supersedes === a.id));
    expect(heads.map((a) => [a.kind, a.tier, a.status])).toEqual([
      ["repo.create", "K1", "notified"],
      ["repo.push", "K1", "notified"],
      ["deploy.preview", "K1", "notified"],
      ["deploy.production", "K2", "pending"],
    ]);
    expect(events.map((e) => `${e.provider}:${e.op}`)).toEqual(["code:ensureRepo", "code:pushTree", "deploy:create"]);
    expect(state.tasks.get(task.id)?.status).toBe("waiting_decision");
    const card = state.cards.get(outcome.cardId!);
    expect(card).toMatchObject({ tier: "K2", actionKind: "deploy.production" });
    expect(card?.rationale).toContain("site: lumen-ledger-site");
    expect(card?.rationale).toContain(`preview: ${outcome.previewUrl}`);
  });

  it("approving the go-live card deploys to production and finishes the task with the live URL as evidence", async () => {
    const task = seedTask(state, { role: "engineering", taskType: "build_site", result: { artifactIds: ["art-1"], costUsd: 0, summary: "built" } });
    const deps = fakeDeps(state, events);
    const outcome = await runBuildPipeline(deps, directSteps, task.id, files);
    Object.assign(state.cards.get(outcome.cardId!)!, { answeredOptionId: "approve", answeredAt: new Date().toISOString(), answeredBy: "user" });
    const settlement = await settleDecision(deps, outcome.cardId!);
    if (settlement.kind !== "perform") throw new Error(settlement.kind);
    const performed = await performPending(deps, settlement.actionId);
    await completeAction(deps, { actionId: settlement.actionId, tier: settlement.tier, outcome: performed });
    expect(performed).toMatchObject({ ok: true, externalRef: "http://127.0.0.1:3101/sandbox/sites/live-lumen-ledger-site/" });
    expect(await finishTaskIfIdle(deps, task.id)).toEqual({ status: "done" });
    expect(state.tasks.get(task.id)?.evidence).toMatchObject({ kind: "url", ref: "http://127.0.0.1:3101/sandbox/sites/live-lumen-ledger-site/", verified: true, sandbox: true });
  });

  it("declining keeps the verified preview as evidence and the task still finishes", async () => {
    const task = seedTask(state, { role: "engineering", taskType: "build_site", result: { artifactIds: ["art-1"], costUsd: 0, summary: "built" } });
    const deps = fakeDeps(state, events);
    const outcome = await runBuildPipeline(deps, directSteps, task.id, files);
    Object.assign(state.cards.get(outcome.cardId!)!, { answeredOptionId: "decline", answeredAt: new Date().toISOString(), answeredBy: "user" });
    expect((await settleDecision(deps, outcome.cardId!)).kind).toBe("declined");
    expect(await finishTaskIfIdle(deps, task.id)).toEqual({ status: "done" });
    expect(state.tasks.get(task.id)?.evidence).toMatchObject({ kind: "url", ref: outcome.previewUrl });
  });

  it("a preview that does not answer 200 fails the pipeline and never opens the go-live card", async () => {
    const task = seedTask(state, { role: "engineering", taskType: "build_site" });
    const outcome = await runBuildPipeline(fakeDeps(state, events, 503), directSteps, task.id, files);
    expect(outcome).toMatchObject({ status: "failed", error: expect.stringContaining("not reachable") });
    expect(state.cards.size).toBe(0);
    expect(state.actions.some((a) => a.kind === "deploy.production")).toBe(false);
  });

  it("ONB-3: in live mode without a GitHub connection the first step opens a connect card and parks the task; opening twice reuses it", async () => {
    const task = seedTask(state, { role: "engineering", taskType: "build_site", result: { artifactIds: ["art-1"], costUsd: 0, summary: "built" } });
    const deps = fakeDeps(state, events, 200, "live");
    const outcome = await runBuildPipeline(deps, directSteps, task.id, files);
    expect(outcome).toMatchObject({ status: "connect_card_opened", repoUrl: null, previewUrl: null });
    expect(events).toEqual([]);
    const card = state.cards.get(outcome.cardId!)!;
    expect(card).toMatchObject({ tier: "K2", actionKind: "repo.create", defaultOptionId: "skip", question: expect.stringContaining("Connect GitHub") });
    expect(card.options.map((o) => o.id)).toEqual(["connected", "skip"]);
    expect(state.tasks.get(task.id)?.status).toBe("waiting_decision");
    const heads = state.actions.filter((a) => !state.actions.some((b) => b.supersedes === a.id));
    expect(heads.map((a) => [a.kind, a.status])).toEqual([["repo.create", "failed"]]);
    const again = await runBuildPipeline(deps, directSteps, task.id, files);
    expect(again.cardId).toBe(outcome.cardId);
    expect(state.cards.size).toBe(1);
    // AGT-2: a task parked on a connect card is not "done with an artifact"; it waits.
    expect(await finishTaskIfIdle(deps, task.id)).toEqual({ status: "waiting_decision" });
    expect(state.tasks.get(task.id)?.status).toBe("waiting_decision");
  });

  it("ONB-3 under a spent quota: the step is stored quota-deferred, the task parks, and it is not finished on its artifacts (DEC-3)", async () => {
    const task = seedTask(state, { role: "engineering", taskType: "build_site", result: { artifactIds: ["art-1"], costUsd: 0, summary: "built" } });
    const deps = fakeDeps(state, events, 200, "live");
    state.quotaExhausted = true;
    const outcome = await runBuildPipeline(deps, directSteps, task.id, files);
    expect(outcome).toMatchObject({ status: "connect_deferred", cardId: null, error: null });
    expect(state.cards.size).toBe(0);
    const deferred = state.actions.filter((a) => a.payload.quota_deferred === true);
    expect(deferred).toHaveLength(1);
    expect(deferred[0]).toMatchObject({ kind: "repo.create", status: "blocked", payload: expect.objectContaining({ connect: "github" }) });
    expect(state.tasks.get(task.id)?.status).toBe("waiting_decision");
    expect(await finishTaskIfIdle(deps, task.id)).toEqual({ status: "waiting_decision" });
    expect(state.tasks.get(task.id)?.status).toBe("waiting_decision");
  });

  it("ONB-3: 'connected' resumes the task through settlement; 'skip' fails it with the reason", async () => {
    const deps = fakeDeps(state, events, 200, "live");
    const resumed = seedTask(state, { role: "engineering", taskType: "build_site" });
    const first = await runBuildPipeline(deps, directSteps, resumed.id, files);
    Object.assign(state.cards.get(first.cardId!)!, { answeredOptionId: "connected", answeredAt: new Date().toISOString(), answeredBy: "user" });
    expect(await settleDecision(deps, first.cardId!)).toEqual({ kind: "resume", cardId: first.cardId, taskId: resumed.id });
    expect(state.tasks.get(resumed.id)?.status).toBe("waiting_decision");

    const skipped = seedTask(state, { role: "engineering", taskType: "build_site" });
    const second = await runBuildPipeline(deps, directSteps, skipped.id, files);
    Object.assign(state.cards.get(second.cardId!)!, { answeredOptionId: "skip", answeredAt: new Date().toISOString(), answeredBy: "default" });
    expect(await settleDecision(deps, second.cardId!)).toEqual({ kind: "abandon", cardId: second.cardId, taskId: skipped.id });
    expect(state.tasks.get(skipped.id)).toMatchObject({ status: "failed" });
    expect(await settleDecision(deps, second.cardId!)).toEqual({ kind: "nothing", cardId: second.cardId });
  });

  it("the kill switch blocks the first step and nothing reaches an adapter", async () => {
    const task = seedTask(state, { role: "engineering", taskType: "build_site" });
    state.killSwitch.set("company-1", true);
    const outcome = await runBuildPipeline(fakeDeps(state, events), directSteps, task.id, files);
    expect(outcome.status).toBe("failed");
    expect(events).toEqual([]);
  });
});

describe("AGT-3 attempt policy", () => {
  it("retries a first failure once and escalates the second, writing a learning", async () => {
    const task = seedTask(state, { status: "failed", attempts: 1, lastError: "first approach broke" } as never);
    expect(await attemptDecision(fakeDeps(state, events), task.id)).toEqual({ next: "retry", attempt: 2 });
    Object.assign(state.tasks.get(task.id)!, { attempts: 2, lastError: "second approach broke" });
    expect(await attemptDecision(fakeDeps(state, events), task.id)).toEqual({ next: "escalate", reason: "second approach broke" });
    const result = await escalateTask(fakeDeps(state, events), task.id, "second approach broke");
    expect(result.escalated).toBe(true);
    expect(state.memory[0]).toMatchObject({ companyId: "company-1", item: expect.objectContaining({ kind: "learning", title: expect.stringContaining("Escalated") }) });
    expect(retryInstructions(2, "x")).toMatch(/Attempt #2 of 2/);
    const running = seedTask(state, { status: "running" });
    expect(await attemptDecision(fakeDeps(state, events), running.id)).toEqual({ next: "none" });
  });
});

describe("verifier (AGT-2)", () => {
  it("never follows redirects and refuses private hosts unless the sandbox site origin is listed (SSRF, M3 review)", async () => {
    const never: FetchLike = async () => {
      throw new Error("fetch must not be called");
    };
    const redirect = await verifyUrl("http://127.0.0.1:3101/x/", { allowPrivate: true, fetchImpl: async () => new Response("", { status: 302, headers: { location: "http://169.254.169.254/" } }) });
    expect(redirect).toMatchObject({ verified: false, detail: expect.stringContaining("not followed") });
    expect((await verifyUrl("http://127.0.0.1:3101/x/", { fetchImpl: never })).detail).toMatch(/private/);
    expect((await verifyUrl("http://10.0.0.5/", { fetchImpl: never })).detail).toMatch(/private/);
    expect((await verifyUrl("http://[::1]/", { fetchImpl: never })).detail).toMatch(/private/);
    expect((await verifyUrl("http://localhost:3101/", { fetchImpl: never })).detail).toMatch(/private/);
    // The sandbox policy lists the site server's origin and nothing else.
    const sandbox = { allowedOrigins: ["http://127.0.0.1:3101"], allowPrivate: true, fetchImpl: async () => new Response("", { status: 200 }) };
    expect((await verifyUrl("http://127.0.0.1:3101/sandbox/sites/x/", sandbox)).verified).toBe(true);
    expect((await verifyUrl("http://127.0.0.1:54321/rest/v1/", sandbox)).detail).toMatch(/not the site server/);
    for (const [address, isPrivate] of [["127.0.0.1", true], ["10.1.2.3", true], ["172.16.0.1", true], ["172.32.0.1", false], ["192.168.1.1", true], ["169.254.169.254", true], ["100.64.0.1", true], ["8.8.8.8", false], ["::1", true], ["fd00::1", true], ["fe80::1", true], ["::ffff:127.0.0.1", true], ["2606:4700::1", false]] as const) {
      expect(isPrivateAddress(address), address).toBe(isPrivate);
    }
  });

  it("accepts 2xx URLs only, rejects bad schemes, and looks artifacts up", async () => {
    const sandbox = { allowPrivate: true };
    const ok = await verifyUrl("http://127.0.0.1:3101/x/", { ...sandbox, fetchImpl: async () => new Response("", { status: 200 }) });
    expect(ok).toMatchObject({ verified: true, detail: "HTTP 200" });
    const missing = await verifyUrl("http://127.0.0.1:3101/x/", { ...sandbox, fetchImpl: async () => new Response("", { status: 404 }) });
    expect(missing.verified).toBe(false);
    const down = await verifyUrl("http://127.0.0.1:1/x/", {
      ...sandbox,
      fetchImpl: async () => {
        throw new Error("ECONNREFUSED");
      },
    });
    expect(down).toMatchObject({ verified: false, detail: "ECONNREFUSED" });
    expect((await verifyUrl("sandbox://repos/x", { ...sandbox, fetchImpl: async () => new Response("") })).verified).toBe(false);
    expect((await verifyUrl("not a url", { ...sandbox, fetchImpl: async () => new Response("") })).verified).toBe(false);
    expect((await verifyUrl("http://user:pw@127.0.0.1:3101/x/", { ...sandbox, fetchImpl: async () => new Response("") })).verified).toBe(false);
    const deps = fakeDeps(state, events);
    expect((await verifyEvidence({ db: deps.db }, "artifact_id", "art-1")).verified).toBe(true);
    expect((await verifyEvidence({ db: deps.db }, "artifact_id", "nope")).verified).toBe(false);
    expect((await verifyEvidence({ db: deps.db }, "message_id", "sandbox:noop:x")).verified).toBe(false);
    expect((await verifyEvidence({ db: deps.db }, "message_id", "sandbox:msg:1")).verified).toBe(true);
  });
});
