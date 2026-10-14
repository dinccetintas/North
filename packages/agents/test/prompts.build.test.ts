import { beforeAll, describe, expect, it } from "vitest";
import { TASK_TYPES } from "@north/core";
import { MISSING_VALUE, buildSystemPrompt, buildTaskPrompt } from "../src/prompts/build";
import { TASK_GUIDES } from "../src/prompts/task-guides";
import type { RoleDefinition } from "../src/roles/schema";
import { loadTestRoles, makeInput, requireRole } from "./helpers";

let roles: ReadonlyMap<string, RoleDefinition>;
beforeAll(async () => {
  roles = await loadTestRoles();
});

describe("buildSystemPrompt", () => {
  it("substitutes dotted placeholders and renders missing ones as (not set)", () => {
    const role = requireRole(roles, "chief_of_staff");
    const system = buildSystemPrompt(role, { "company.name": "Lumen Ledger", quota: "3" });
    expect(system).toContain("Chief of Staff of Lumen Ledger");
    expect(system).toContain("at\nmost 3 decision cards");
    expect(system).toContain(`Thesis: ${MISSING_VALUE}.`);
    expect(system).not.toMatch(/\{\{/);
  });

  it("leaves every role's prompt free of raw braces with no vars", () => {
    for (const role of roles.values()) expect(buildSystemPrompt(role, {}), role.role).not.toMatch(/\{\{|\}\}/);
  });
});

describe("buildTaskPrompt", () => {
  it("includes task type, instructions, memory digest, the guide, and the output-only rule", () => {
    const role = requireRole(roles, "research");
    const { system, user } = buildTaskPrompt(makeInput(), role, { "company.name": "Lumen Ledger" });
    expect(system).toContain("You research for Lumen Ledger");
    expect(user).toContain("# Task: market_report");
    expect(user).toContain("Write the market report");
    expect(user).toContain("Bookkeeping for solo consultants");
    expect(user).toContain(TASK_GUIDES.market_report);
    expect(user).toContain("Return ONLY the structured output");
    expect(user).toContain("artifacts");
    expect(user).toContain("touch the outside world");
    expect(user).toContain('Primary artifact kind for this task: "market_report"');
  });

  it("uses the plan contract for plan_week and lists known task types and metrics", () => {
    const role = requireRole(roles, "chief_of_staff");
    const { user } = buildTaskPrompt(makeInput({ role: "chief_of_staff", taskType: "plan_week" }), role);
    expect(user).toContain("rationale");
    expect(user).toContain("competitor_map");
    expect(user).toContain("paying_customers");
    expect(user).not.toContain("Primary artifact kind");
  });

  it("mentions the answered decision card when resuming", () => {
    const role = requireRole(roles, "research");
    const { user } = buildTaskPrompt(makeInput({ resume: { sessionId: "s", cardId: "card-7", optionId: "ship" } }), role);
    expect(user).toContain("card-7");
    expect(user).toContain('"ship"');
  });

  it("has a guide for every task type", () => {
    for (const taskType of TASK_TYPES) expect(TASK_GUIDES[taskType].length, taskType).toBeGreaterThan(80);
  });
});
