import { beforeAll, describe, expect, it } from "vitest";
import type { RoleDefinition } from "../src/roles/schema";
import { selectRuntime } from "../src/runtime/select";
import { allowedToolsFor, disallowedToolsFor, MEMORY_SEARCH_TOOL } from "../src/runtime/tool-policy";
import { loadTestRoles, makeDeps, makeInput, requireRole } from "./helpers";

let roles: ReadonlyMap<string, RoleDefinition>;
beforeAll(async () => {
  roles = await loadTestRoles();
});

describe("selectRuntime", () => {
  it("picks the fixture-backed mock by default and runs a fixture", async () => {
    const runtime = selectRuntime(makeDeps(roles), {});
    expect(runtime.name).toBe("mock");
    const result = await runtime.run(makeInput({ role: "design", taskType: "brand_kit" }));
    expect(result.status).toBe("succeeded");
  });

  it("picks the mock for any other AGENT_RUNTIME value", () => {
    expect(selectRuntime(makeDeps(roles), { AGENT_RUNTIME: "managed-agents" }).name).toBe("mock");
  });

  it("picks the Claude Agent SDK runtime when AGENT_RUNTIME=claude-agent-sdk", () => {
    expect(selectRuntime(makeDeps(roles), { AGENT_RUNTIME: "claude-agent-sdk" }).name).toBe("claude-agent-sdk");
  });
});

describe("tool policy", () => {
  it("every role gets memory search; only engineering gets mutating built-ins", () => {
    for (const role of roles.values()) {
      const allowed = allowedToolsFor(role);
      expect(allowed[0]).toBe(MEMORY_SEARCH_TOOL);
      if (role.role === "engineering") {
        expect(allowed).toContain("Bash");
        expect(disallowedToolsFor(role)).toEqual([]);
      } else {
        expect(allowed.some((t) => ["Bash", "Write", "Edit", "MultiEdit", "NotebookEdit"].includes(t))).toBe(false);
        expect(disallowedToolsFor(role)).toEqual(["Bash", "Write", "Edit", "MultiEdit", "NotebookEdit"]);
      }
    }
  });

  it("maps web.search and web.fetch to the SDK web tools", () => {
    expect(allowedToolsFor(requireRole(roles, "research"))).toEqual([MEMORY_SEARCH_TOOL, "WebSearch", "WebFetch"]);
    expect(allowedToolsFor(requireRole(roles, "design"))).toEqual([MEMORY_SEARCH_TOOL]);
  });
});
