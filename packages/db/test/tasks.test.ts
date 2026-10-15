import { TaskTransitionError } from "@north/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTask, getTask, listTasks, listTasksByType, markTaskDone, markTaskFailed, markTaskRunning, markTaskWaiting } from "../src/tasks";
import { createOwnerWithCompany, createTestUser, deleteTestUser, service, type OwnedCompany, type TestUser } from "./fixtures";

describe("tasks repository (AGT-1/2/3)", () => {
  let owned: OwnedCompany;
  let stranger: TestUser;
  const verified = { kind: "artifact_id" as const, ref: "art-1", verified: true };

  const newTask = (title: string) =>
    createTask(owned.owner.client, { companyId: owned.companyId, role: "research", taskType: "market_report", title, input: "Look at the clinic queue market", metricKey: "signups", expectedDelta: 5 });

  beforeAll(async () => {
    owned = await createOwnerWithCompany("tasks");
    stranger = await createTestUser("tasks-stranger");
  });

  afterAll(async () => {
    await deleteTestUser(owned.owner);
    await deleteTestUser(stranger);
  });

  it("createTask queues a task and stores the input text as { text }", async () => {
    const task = await newTask("Market report");
    expect(task).toMatchObject({ status: "queued", attempts: 0, evidence: null, input: "Look at the clinic queue market", taskType: "market_report", role: "research", metricKey: "signups", expectedDelta: 5, costUsd: 0, planId: null });
    const raw = await service.from("tasks").select("input").eq("id", task.id).single();
    expect(raw.data?.input).toEqual({ text: "Look at the clinic queue market" });
    expect(await getTask(owned.owner.client, task.id)).toEqual(task);
  });

  it("walks queued → running → waiting_decision → running → done with evidence, cost and summary", async () => {
    const task = await newTask("Happy path");
    const running = await markTaskRunning(owned.owner.client, task.id);
    expect(running).toMatchObject({ status: "running", attempts: 1 });
    expect((await markTaskWaiting(owned.owner.client, task.id)).status).toBe("waiting_decision");
    const resumed = await markTaskRunning(owned.owner.client, task.id);
    expect(resumed).toMatchObject({ status: "running", attempts: 1 });
    const done = await markTaskDone(owned.owner.client, task.id, { evidence: verified, costUsd: 0.42, outputSummary: "Report written" });
    expect(done).toMatchObject({ status: "done", costUsd: 0.42, outputSummary: "Report written", evidence: { ...verified, sandbox: false } });
  });

  it("AGT-2: done without verified evidence throws TaskTransitionError and leaves the row untouched", async () => {
    const task = await newTask("No evidence");
    await markTaskRunning(owned.owner.client, task.id);
    await expect(markTaskDone(owned.owner.client, task.id, { evidence: { ...verified, verified: false }, costUsd: 0, outputSummary: "x" })).rejects.toBeInstanceOf(TaskTransitionError);
    expect((await getTask(service, task.id))?.status).toBe("running");
  });

  it("illegal transitions throw TaskTransitionError (done from queued, waiting from queued)", async () => {
    const task = await newTask("Illegal");
    await expect(markTaskDone(owned.owner.client, task.id, { evidence: verified, costUsd: 0, outputSummary: "x" })).rejects.toBeInstanceOf(TaskTransitionError);
    await expect(markTaskWaiting(owned.owner.client, task.id)).rejects.toBeInstanceOf(TaskTransitionError);
  });

  it("AGT-3: after two failed attempts a third start is refused", async () => {
    const task = await newTask("Retry");
    await markTaskRunning(owned.owner.client, task.id);
    const failed1 = await markTaskFailed(owned.owner.client, task.id, "first approach failed");
    expect(failed1).toMatchObject({ status: "failed", attempts: 1, lastError: "first approach failed" });
    await markTaskRunning(owned.owner.client, task.id);
    const failed2 = await markTaskFailed(owned.owner.client, task.id, "second approach failed");
    expect(failed2).toMatchObject({ status: "failed", attempts: 2, lastError: "second approach failed" });
    await expect(markTaskRunning(owned.owner.client, task.id)).rejects.toBeInstanceOf(TaskTransitionError);
  });

  it("listTasks filters by status and orders oldest first", async () => {
    const all = await listTasks(owned.owner.client, owned.companyId);
    const times = all.map((t) => t.createdAt);
    expect([...times].sort()).toEqual(times);
    const queued = await listTasks(owned.owner.client, owned.companyId, { status: ["queued"] });
    expect(queued.every((t) => t.status === "queued")).toBe(true);
    expect(queued.length).toBeGreaterThan(0);
    const doneOrFailed = await listTasks(owned.owner.client, owned.companyId, { status: ["done", "failed"] });
    expect(doneOrFailed.map((t) => t.status).sort()).toEqual(["done", "failed"]);
  });

  it("listTasksByType lists one task type, optionally only in some statuses (an open fix_error for the same ref)", async () => {
    const fix = await createTask(owned.owner.client, { companyId: owned.companyId, role: "engineering", taskType: "fix_error", title: "Fix ABC-1", input: "ref: 12345" });
    const second = await createTask(owned.owner.client, { companyId: owned.companyId, role: "engineering", taskType: "fix_error", title: "Fix ABC-2", input: "ref: 67890" });
    await markTaskRunning(owned.owner.client, second.id);
    await markTaskFailed(owned.owner.client, second.id, "boom");
    expect((await listTasksByType(owned.owner.client, owned.companyId, "fix_error")).map((t) => t.id)).toEqual([fix.id, second.id]);
    expect((await listTasksByType(owned.owner.client, owned.companyId, "fix_error", { status: ["queued", "running", "waiting_decision"] })).map((t) => t.id)).toEqual([fix.id]);
    expect(await listTasksByType(owned.owner.client, owned.companyId, "signal_research")).toEqual([]);
    expect(await listTasksByType(stranger.client, owned.companyId, "fix_error")).toEqual([]);
    await expect(listTasksByType(service, owned.companyId, "hack" as never)).rejects.toThrow();
  });

  it("another owner sees nothing and cannot drive the task", async () => {
    const task = await newTask("Private");
    expect(await getTask(stranger.client, task.id)).toBeNull();
    expect(await listTasks(stranger.client, owned.companyId)).toEqual([]);
    await expect(markTaskRunning(stranger.client, task.id)).rejects.toThrow(/not found/);
  });
});
