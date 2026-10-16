// SEC-1: the PreToolUse hook keeps the built-in file tools inside the task workspace.
import { mkdir, mkdtemp, realpath, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { auditHook, buildQueryOptions, type ClaudeAgentSdkDeps, type ToolAuditEntry, type ToolCallTrace } from "../src/runtime/claude-agent-sdk";
import { MEMORY_SEARCH_TOOL } from "../src/runtime/tool-policy";
import type { RoleDefinition } from "../src/roles/schema";
import { loadTestRoles, makeDeps, makeInput, preToolUse, requireRole } from "./helpers";

let roles: ReadonlyMap<string, RoleDefinition>;
beforeAll(async () => {
  roles = await loadTestRoles();
});

describe("SEC-1 auditHook scopes the file tools to the task workspace", () => {
  const signal = () => ({ signal: new AbortController().signal });
  const FILE_TOOLS = ["Read", "Glob", "Grep", "Write", "Edit", "MultiEdit", "NotebookEdit"];
  /** Runs one call through the hook of an engineering run (all file tools allowed) and returns the output and the audit log. */
  async function call(tool: string, input: unknown, extra: Partial<ClaudeAgentSdkDeps> = {}, taskId = "task-1") {
    const log: ToolAuditEntry[] = [];
    const hook = auditHook(makeInput({ role: "engineering", taskId }), FILE_TOOLS, { ...makeDeps(roles, log), ...extra });
    const output = await hook(preToolUse(tool, input), "tu-1", signal());
    return { output, log };
  }
  const denied = (output: unknown, reason: string | RegExp) =>
    expect(output).toMatchObject({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: typeof reason === "string" ? reason : expect.stringMatching(reason) } });

  it("SEC-1 denies a Read of a sibling task's file, and audits the denial with the reason", async () => {
    const { output, log } = await call("Read", { file_path: "../other-task/notes.md" });
    denied(output, 'Path "../other-task/notes.md" is outside the task workspace');
    expect(log).toEqual([{ companyId: "company-1", taskId: "task-1", toolName: "Read", input: { file_path: "../other-task/notes.md" }, decision: "deny" }]);
  });

  it("SEC-1 denies an absolute path outside the workspace and another company's config dir", async () => {
    denied((await call("Read", { file_path: "/etc/passwd" })).output, 'Path "/etc/passwd" is outside the task workspace');
    const settings = "/tmp/north-agent-config/other-company/.claude/settings.json";
    const { output, log } = await call("Read", { file_path: settings });
    denied(output, `Path "${settings}" is outside the task workspace`);
    expect(log[0]?.decision).toBe("deny");
  });

  it("SEC-1 denies a Glob over / and a Grep of the workspace root's parent, but lets a Grep without a path search the cwd", async () => {
    denied((await call("Glob", { pattern: "**/*", path: "/" })).output, 'Path "/" is outside the task workspace');
    denied((await call("Grep", { pattern: "x", path: "/tmp/north-workspaces" })).output, /outside the task workspace/);
    const open = await call("Grep", { pattern: "needle" });
    expect(open.output).toEqual({});
    expect(open.log[0]?.decision).toBe("allow");
  });

  it("SEC-1 denies a Glob whose absolute pattern would search elsewhere", async () => {
    denied((await call("Glob", { pattern: "/etc/**/*.conf" })).output, 'Path "/etc" is outside the task workspace');
    denied((await call("Glob", { pattern: "/tmp/north-agent-config/*/.claude/*.json" })).output, /outside the task workspace/);
    expect((await call("Glob", { pattern: "src/**/*.ts" })).output).toEqual({});
  });

  it("SEC-1 allows a Read inside the workspace and a Write of a new file in a subdirectory that does not exist yet", async () => {
    expect((await call("Read", { file_path: "./src/a.ts" })).output).toEqual({});
    expect((await call("Read", { file_path: "/tmp/north-workspaces/task-1/src/a.ts" })).output).toEqual({});
    const write = await call("Write", { file_path: "generated/deep/new.txt", content: "x" });
    expect(write.output).toEqual({});
    expect(write.log[0]?.decision).toBe("allow");
  });

  it("SEC-1 scopes every write tool as well", async () => {
    for (const [tool, input] of [
      ["Write", { file_path: "/etc/cron.d/x", content: "x" }],
      ["Edit", { file_path: "../other-task/a.ts", old_string: "a", new_string: "b" }],
      ["MultiEdit", { file_path: "/tmp/north-agent-config/company-1/.claude/settings.json", edits: [] }],
      ["NotebookEdit", { notebook_path: "/home/n.ipynb", new_source: "x" }],
    ] as const) denied((await call(tool, input)).output, /outside the task workspace/);
  });

  it("SEC-1 denies a Read through a symlink planted in the workspace that points outside", async () => {
    const base = await realpath(await mkdtemp(join(tmpdir(), "north-hook-")));
    try {
      const workspaceRoot = join(base, "workspaces");
      const secret = join(base, "agent-config", "other-company");
      await mkdir(join(workspaceRoot, "task-1"), { recursive: true });
      await mkdir(secret, { recursive: true });
      await symlink(secret, join(workspaceRoot, "task-1", "escape"));
      const { output, log } = await call("Read", { file_path: "escape/.claude/settings.json" }, { workspaceRoot });
      denied(output, 'Path "escape/.claude/settings.json" is outside the task workspace');
      expect(log[0]?.decision).toBe("deny");
      expect((await call("Read", { file_path: "ok.txt" }, { workspaceRoot })).output).toEqual({});
    } finally {
      await rm(base, { recursive: true, force: true });
    }
  });

  it("SEC-1 hands the denial to the tracer with its reason, like any other denial", async () => {
    const traces: ToolCallTrace[] = [];
    await call("Read", { file_path: "/etc/shadow" }, { onToolCall: (trace: ToolCallTrace) => void traces.push(trace) });
    expect(traces).toMatchObject([{ toolName: "Read", decision: "deny", reason: 'Path "/etc/shadow" is outside the task workspace' }]);
  });

  it("SEC-1 a path check that throws denies the call, with the error in the reason", async () => {
    denied((await call("Read", { file_path: 42 })).output, /Path check failed \(.*file_path.*\); call denied/);
    denied((await call("Read", "not an object")).output, /Path check failed/);
    const crafted = await call("Read", { file_path: "a.ts" }, {}, "../escape");
    denied(crafted.output, /Path check failed \(.*task id.*\)/);
    expect(crafted.log[0]?.decision).toBe("deny");
  });

  it("SEC-1 leaves a tool that takes no path alone, and keeps the earlier checks first", async () => {
    const web = auditHook(makeInput(), [MEMORY_SEARCH_TOOL, "WebSearch"], makeDeps(roles));
    expect(await web(preToolUse("WebSearch", { query: "/etc/passwd ../.." }), "tu-1", signal())).toEqual({});
    const notAllowed = auditHook(makeInput(), [MEMORY_SEARCH_TOOL], makeDeps(roles));
    denied(await notAllowed(preToolUse("Read", { file_path: "/etc/passwd" }), "tu-1", signal()), /Tool "Read" is not allowed for role/);
    const killed = await call("Read", { file_path: "/etc/passwd" }, { isKilled: async () => true });
    denied(killed.output, /Kill switch/);
  });

  it("SEC-1 buildQueryOptions wires the scoped hook, so a real run is covered", async () => {
    const options = buildQueryOptions(makeInput({ role: "engineering" }), requireRole(roles, "engineering"), makeDeps(roles));
    const hook = options.hooks?.PreToolUse?.[0]?.hooks[0];
    denied(await hook?.(preToolUse("Read", { file_path: "/etc/passwd" }), "tu-1", signal()), /outside the task workspace/);
    expect(await hook?.(preToolUse("Read", { file_path: "src/a.ts" }), "tu-1", signal())).toEqual({});
  });
});

