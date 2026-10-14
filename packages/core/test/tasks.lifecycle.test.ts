import { describe, expect, it } from "vitest";
import { canRetry, MAX_ATTEMPTS, transition, TaskTransitionError, type TaskState } from "../src/tasks/lifecycle";

const queued: TaskState = { status: "queued", attempts: 0, evidence: null };

describe("AGT-1 task state machine", () => {
  it("queued → running → waiting_decision → running → done", () => {
    const running = transition(queued, { type: "start" });
    expect(running).toMatchObject({ status: "running", attempts: 1 });
    const waiting = transition(running, { type: "wait_decision" });
    expect(waiting.status).toBe("waiting_decision");
    const resumed = transition(waiting, { type: "resume" });
    const done = transition(resumed, { type: "complete", evidence: { kind: "url", ref: "https://x.test", verified: true, sandbox: false } });
    expect(done.status).toBe("done");
    expect(queued.status).toBe("queued"); // never mutated
  });

  it("rejects illegal transitions", () => {
    expect(() => transition(queued, { type: "resume" })).toThrow(TaskTransitionError);
    const done = transition(transition(queued, { type: "start" }), { type: "complete", evidence: { kind: "artifact_id", ref: "a1", verified: true, sandbox: true } });
    expect(() => transition(done, { type: "start" })).toThrow(TaskTransitionError);
  });
});

describe("AGT-2 evidence-only done", () => {
  it("refuses to complete without verified evidence", () => {
    const running = transition(queued, { type: "start" });
    expect(() => transition(running, { type: "complete", evidence: { kind: "url", ref: "https://x.test", verified: false, sandbox: false } })).toThrow(/verified evidence/);
    expect(() => transition(running, { type: "complete", evidence: { kind: "url", ref: "", verified: true, sandbox: false } })).toThrow();
  });
});

describe("AGT-3 two attempts then escalate", () => {
  it(`allows ${MAX_ATTEMPTS} attempts and then refuses to start again`, () => {
    const first = transition(queued, { type: "start" });
    const failed = transition(first, { type: "fail", reason: "approach A failed" });
    expect(canRetry(failed)).toBe(true);
    const second = transition(failed, { type: "start" });
    const failedTwice = transition(second, { type: "fail", reason: "approach B failed" });
    expect(canRetry(failedTwice)).toBe(false);
    expect(() => transition(failedTwice, { type: "start" })).toThrow(/escalate/);
  });
});
