import { describe, expect, it } from "vitest";
import { dropTaskType, missingRevisionReasons, type PlanOutput, type PlannedTask } from "../src/index";

/**
 * PLN-2 / SLS-K2: the platform drops a task type it cannot run this week
 * (an outreach batch with no free lead) and the plan still explains every
 * shrink: an `added` or `more` entry for the type goes, a `dropped` entry
 * with the platform's reason replaces whatever the planner wrote for it.
 */

const task = (taskType: PlannedTask["taskType"], title: string = taskType): PlannedTask => ({ taskType, title, input: "", metricKey: "artifacts", expectedDelta: 1, costEstimateUsd: 0.5 });
const plan = (tasks: readonly PlannedTask[], revisions: PlanOutput["revisions"] = []): PlanOutput => ({ summary: "s", rationale: "r", tasks: [...tasks], revisions: [...revisions] });
const REASON = "no free lead: 0 new leads that no open batch holds";

describe("dropTaskType (PLN-2)", () => {
  it("removes the type and, when the previous plan had it, records it dropped with the reason (passing PLN-2)", () => {
    const input = plan([task("prd"), task("outreach_batch"), task("outreach_batch", "second")], [{ taskType: "outreach_batch", change: "more", reason: "two batches" }]);
    const previous = [{ taskType: "outreach_batch" }, { taskType: "prd" }];
    const out = dropTaskType(input, "outreach_batch", REASON, previous);
    expect(out.tasks.map((t) => t.taskType)).toEqual(["prd"]);
    expect(out.revisions).toEqual([{ taskType: "outreach_batch", change: "dropped", reason: REASON }]);
    expect(missingRevisionReasons(out, previous)).toEqual([]);
    expect(input.tasks).toHaveLength(3);
    expect(Object.isFrozen(out)).toBe(true);
  });

  it("a type the previous plan did not have leaves no revision behind (its `added` entry goes too)", () => {
    const input = plan([task("prd"), task("outreach_batch")], [{ taskType: "outreach_batch", change: "added", reason: "5 leads are waiting" }, { taskType: "prd", change: "added", reason: "first week" }]);
    const out = dropTaskType(input, "outreach_batch", REASON, []);
    expect(out.tasks.map((t) => t.taskType)).toEqual(["prd"]);
    expect(out.revisions).toEqual([{ taskType: "prd", change: "added", reason: "first week" }]);
  });

  it("a plan without the type is returned unchanged, and a plan of only that type may end empty", () => {
    const without = plan([task("prd")]);
    expect(dropTaskType(without, "outreach_batch", REASON, [{ taskType: "outreach_batch" }])).toBe(without);
    expect(dropTaskType(plan([task("outreach_batch")]), "outreach_batch", REASON, []).tasks).toEqual([]);
  });
});
