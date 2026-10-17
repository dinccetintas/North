// SEC-1: the engineering role's OS sandbox, its filesystem rules, and which roles get one.
import { beforeAll, describe, expect, it } from "vitest";
import { isAbsolute, resolve } from "node:path";
import { buildQueryOptions, engineeringSandbox } from "../src/runtime/claude-agent-sdk";
import { allowedToolsFor, ENGINEERING_ROLE } from "../src/runtime/tool-policy";
import type { RoleDefinition } from "../src/roles/schema";
import { loadTestRoles, makeDeps, makeInput, requireRole } from "./helpers";

let roles: ReadonlyMap<string, RoleDefinition>;
beforeAll(async () => {
  roles = await loadTestRoles();
});

describe("SEC-1 engineering sandbox filesystem rules", () => {
  it("SEC-1 the sandbox never makes the company config dir writable, because its settings.json could loosen the sandbox for the next run", () => {
    const options = buildQueryOptions(makeInput({ role: "engineering", companyId: "company-3" }), requireRole(roles, "engineering"), makeDeps(roles));
    const companyDir = "/tmp/north-agent-config/company-3";
    const writable = options.sandbox?.filesystem?.allowWrite ?? [];
    expect(writable).toEqual([`${companyDir}/npm-cache`]);
    for (const path of writable) {
      expect(path).not.toBe(companyDir);
      expect(path === `${companyDir}/.claude` || path.startsWith(`${companyDir}/.claude/`), path).toBe(false);
    }
    expect(options.sandbox?.filesystem?.denyWrite).toBeUndefined();
  });

  it("SEC-1 engineeringSandbox is a function of its paths and returns a fresh object, fresh lists included, on every call", () => {
    const paths = { configRoot: "/c", workspaceRoot: "/w", workspace: "/w/t", companyDir: "/c/co" };
    const first = engineeringSandbox(paths);
    const second = engineeringSandbox(paths);
    expect(first).toEqual(second);
    expect(first).not.toBe(second);
    expect(first.filesystem).not.toBe(second.filesystem);
    expect(first.filesystem?.denyRead).not.toBe(second.filesystem?.denyRead);
    first.filesystem?.denyRead?.push("/mutated");
    first.network?.allowedDomains?.push("evil.example");
    expect(second.filesystem?.denyRead).toEqual(["/c", "/w"]);
    expect(second.network?.allowedDomains).toEqual(["registry.npmjs.org"]);
    expect(engineeringSandbox({ ...paths, companyDir: "/c/other" }).filesystem?.allowRead).toEqual(["/w/t", "/c/other"]);
  });

  it("SEC-1 sandboxDenyRead (the worker's cwd and the repo root, where .env lives) is appended to denyRead, made absolute and de-duplicated; the task workspace stays readable", () => {
    const deps = { ...makeDeps(roles), sandboxDenyRead: ["/srv/north", "rel/repo", "/srv/north/", "/tmp/north-workspaces"] };
    const filesystem = buildQueryOptions(makeInput({ role: "engineering", taskId: "t-9" }), requireRole(roles, "engineering"), deps).sandbox?.filesystem;
    expect(filesystem?.denyRead).toEqual(["/tmp/north-agent-config", "/tmp/north-workspaces", "/srv/north", resolve("rel/repo")]);
    expect(filesystem?.allowRead).toEqual(["/tmp/north-workspaces/t-9", "/tmp/north-agent-config/company-1"]);
    expect(engineeringSandbox({ configRoot: "/c", workspaceRoot: "/w", workspace: "/w/t", companyDir: "/c/co" }).filesystem?.denyRead).toEqual(["/c", "/w"]);
    const extra = ["/repo"];
    const sandbox = engineeringSandbox({ configRoot: "/c", workspaceRoot: "/w", workspace: "/w/t", companyDir: "/c/co", denyRead: extra });
    sandbox.filesystem?.denyRead?.push("/mutated");
    expect(extra).toEqual(["/repo"]);
  });

  it("SEC-1 the sandbox rules are absolute paths, so they do not depend on the worker's cwd", () => {
    const deps = { ...makeDeps(roles), workspaceRoot: "rel/workspaces", configRoot: "rel/agent-config" };
    const filesystem = buildQueryOptions(makeInput({ role: "engineering" }), requireRole(roles, "engineering"), deps).sandbox?.filesystem;
    for (const path of [...(filesystem?.denyRead ?? []), ...(filesystem?.allowRead ?? []), ...(filesystem?.allowWrite ?? [])]) expect(isAbsolute(path), path).toBe(true);
  });

  it("SEC-2 a relative config root still gives the subprocess an absolute HOME and CLAUDE_CONFIG_DIR, the same dir the sandbox names", () => {
    // The query runs with cwd = the task workspace: a relative HOME would put the settings and transcripts inside it.
    const { configRoot, ...noConfigRoot } = makeDeps(roles);
    void configRoot;
    for (const deps of [{ ...makeDeps(roles), configRoot: "rel/agent-config" }, { ...noConfigRoot, workspaceRoot: "rel/workspaces" }]) {
      const options = buildQueryOptions(makeInput({ role: "engineering", companyId: "company-1" }), requireRole(roles, "engineering"), deps);
      const home = options.env?.HOME ?? "";
      expect(isAbsolute(home), home).toBe(true);
      expect(options.env?.CLAUDE_CONFIG_DIR).toBe(home);
      expect(options.sandbox?.filesystem?.allowRead).toContain(home);
    }
    const relative = buildQueryOptions(makeInput({ role: "engineering", companyId: "company-1" }), requireRole(roles, "engineering"), { ...makeDeps(roles), configRoot: "rel/agent-config" });
    expect(relative.env?.HOME).toBe(resolve("rel/agent-config", "company-1"));
  });

  it("SEC-1 the sandbox of two engineering runs of two companies names each company's own dirs only", () => {
    const engineering = requireRole(roles, "engineering");
    const a = buildQueryOptions(makeInput({ role: "engineering", companyId: "co-a", taskId: "t-a" }), engineering, makeDeps(roles)).sandbox?.filesystem;
    const b = buildQueryOptions(makeInput({ role: "engineering", companyId: "co-b", taskId: "t-b" }), engineering, makeDeps(roles)).sandbox?.filesystem;
    expect(a?.allowRead).toEqual(["/tmp/north-workspaces/t-a", "/tmp/north-agent-config/co-a"]);
    expect(b?.allowRead).toEqual(["/tmp/north-workspaces/t-b", "/tmp/north-agent-config/co-b"]);
    expect(JSON.stringify(a)).not.toContain("co-b");
  });

  it("SEC-1 the npm cache is pinned into the company's own dir for every role", () => {
    for (const role of roles.values()) {
      const env = buildQueryOptions(makeInput({ role: role.role, companyId: "company-5" }), role, makeDeps(roles)).env ?? {};
      expect(env.npm_config_cache, role.role).toBe("/tmp/north-agent-config/company-5/npm-cache");
    }
  });

  it("F2 only the roles that can run a shell get a sandbox: Bash allowed iff the options carry one, for every role YAML", () => {
    expect(roles.size).toBeGreaterThan(3);
    for (const role of roles.values()) {
      const options = buildQueryOptions(makeInput({ role: role.role }), role, makeDeps(roles));
      expect("sandbox" in options, role.role).toBe(allowedToolsFor(role).includes("Bash"));
    }
    expect(ENGINEERING_ROLE).toBe("engineering");
  });
});
