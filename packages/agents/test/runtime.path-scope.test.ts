import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PATH_SCOPED_TOOLS, PathSegmentSchema, pathArgumentsOf, pathOutsideWorkspace } from "../src/runtime/path-scope";

/**
 * A real directory tree, so the symlink cases hit the real filesystem:
 *   <root>/workspaces/task-1            the task workspace (src/a.ts, file.txt)
 *   <root>/workspaces/task-1-evil       a sibling whose name starts with the workspace's
 *   <root>/workspaces/other-task        another task's workspace (notes.md)
 *   <root>/agent-config/other-company   another company's config dir (.claude/settings.json)
 */
let root: string;
let workspace: string;
let other: string;
let evil: string;
let foreign: string;

beforeAll(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), "north-scope-")));
  workspace = join(root, "workspaces", "task-1");
  evil = join(root, "workspaces", "task-1-evil");
  other = join(root, "workspaces", "other-task");
  foreign = join(root, "agent-config", "other-company");
  await mkdir(join(workspace, "src"), { recursive: true });
  await mkdir(evil, { recursive: true });
  await mkdir(other, { recursive: true });
  await mkdir(join(foreign, ".claude"), { recursive: true });
  await writeFile(join(workspace, "src", "a.ts"), "export {};\n");
  await writeFile(join(workspace, "file.txt"), "x\n");
  await writeFile(join(other, "notes.md"), "secret\n");
  await writeFile(join(foreign, ".claude", "settings.json"), "{}\n");
});
afterAll(async () => rm(root, { recursive: true, force: true }));

describe("SEC-1 PATH_SCOPED_TOOLS", () => {
  it("lists every built-in file tool and is frozen", () => {
    expect([...PATH_SCOPED_TOOLS].sort()).toEqual(["Edit", "Glob", "Grep", "MultiEdit", "NotebookEdit", "Read", "Write"]);
    expect(Object.isFrozen(PATH_SCOPED_TOOLS)).toBe(true);
  });
});

describe("SEC-1 PathSegmentSchema", () => {
  it("accepts a uuid and a short slug, refuses anything that could leave its directory", () => {
    expect(PathSegmentSchema.safeParse("0b9f2c1e-7a34-4d58-9e61-2f5c8a1d3b70").success).toBe(true);
    expect(PathSegmentSchema.safeParse("task_1-a").success).toBe(true);
    for (const bad of ["", "..", ".", "../x", "a/b", "a\\b", "/abs", "a b", "a".repeat(65), "t\0"]) expect(PathSegmentSchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
  });
});

describe("SEC-1 pathArgumentsOf", () => {
  it("reads file_path, path and notebook_path when they are strings", () => {
    expect(pathArgumentsOf("Read", { file_path: "src/a.ts", offset: 3 })).toEqual(["src/a.ts"]);
    expect(pathArgumentsOf("Edit", { file_path: "/w/a.ts", old_string: "a", new_string: "b" })).toEqual(["/w/a.ts"]);
    expect(pathArgumentsOf("NotebookEdit", { notebook_path: "n.ipynb", new_source: "x" })).toEqual(["n.ipynb"]);
    expect(pathArgumentsOf("Grep", { pattern: "x", path: "src" })).toEqual(["src"]);
  });

  it("Glob and Grep without a path search the cwd, which is allowed, so they yield nothing", () => {
    expect(pathArgumentsOf("Grep", { pattern: "needle" })).toEqual([]);
    expect(pathArgumentsOf("Glob", { pattern: "**/*.ts" })).toEqual([]);
  });

  it("yields nothing for a tool that takes no path, whatever its input holds", () => {
    expect(pathArgumentsOf("WebSearch", { query: "/etc/passwd", path: "/etc" })).toEqual([]);
    expect(pathArgumentsOf("mcp__north__memory_search", { query: "../.." })).toEqual([]);
    expect(pathArgumentsOf("Bash", { command: "cat /etc/passwd" })).toEqual([]);
  });

  it("fails closed on a path argument that is not a string, and on an input that is not an object", () => {
    expect(() => pathArgumentsOf("Read", { file_path: 42 })).toThrow(/file_path/);
    expect(() => pathArgumentsOf("Grep", { pattern: "x", path: ["/etc"] })).toThrow(/path/);
    expect(() => pathArgumentsOf("Grep", { pattern: "x", path: null })).toThrow(/path/);
    expect(() => pathArgumentsOf("Read", "file_path=/etc/passwd")).toThrow(/object/);
    expect(() => pathArgumentsOf("Read", null)).toThrow(/object/);
    expect(() => pathArgumentsOf("Glob", { pattern: 1 })).toThrow(/pattern/);
  });

  it("also scopes the fixed part of a Glob pattern, because an absolute pattern searches from its own base", () => {
    expect(pathArgumentsOf("Glob", { pattern: "/etc/**/*.conf" })).toEqual(["/etc"]);
    expect(pathArgumentsOf("Glob", { pattern: "/**/*.ts" })).toEqual(["/"]);
    expect(pathArgumentsOf("Glob", { pattern: "~/.ssh/*" })).toEqual(["~/.ssh"]);
    expect(pathArgumentsOf("Glob", { pattern: "src/**/*.ts" })).toEqual(["src"]);
    expect(pathArgumentsOf("Glob", { pattern: "../../*.ts", path: "src" })).toEqual(["src", "src/../.."]);
    expect(pathArgumentsOf("Glob", { pattern: "*.ts", path: "/w/a" })).toEqual(["/w/a"]);
  });
});

describe("SEC-1 pathOutsideWorkspace", () => {
  it("allows the workspace itself and paths inside it, relative or absolute", async () => {
    const inside = [".", "", "src/a.ts", "./src/a.ts", "src/../src/a.ts", workspace, join(workspace, "src", "a.ts")];
    expect(await pathOutsideWorkspace(workspace, inside)).toBeNull();
  });

  it("refuses a .. climb into a sibling task, an absolute path elsewhere, and another company's config dir", async () => {
    expect(await pathOutsideWorkspace(workspace, ["../other-task/notes.md"])).toBe("../other-task/notes.md");
    expect(await pathOutsideWorkspace(workspace, ["/etc/passwd"])).toBe("/etc/passwd");
    const settings = join(foreign, ".claude", "settings.json");
    expect(await pathOutsideWorkspace(workspace, [settings])).toBe(settings);
    expect(await pathOutsideWorkspace(workspace, ["/"])).toBe("/");
    expect(await pathOutsideWorkspace(workspace, [".."])).toBe("..");
  });

  it("refuses a sibling whose name only starts with the workspace's name", async () => {
    expect(await pathOutsideWorkspace(workspace, [evil])).toBe(evil);
    expect(await pathOutsideWorkspace(workspace, ["../task-1-evil/x"])).toBe("../task-1-evil/x");
  });

  it("refuses a relative path that climbs out even when it climbs back in", async () => {
    expect(await pathOutsideWorkspace(workspace, ["../task-1/src/a.ts"])).toBe("../task-1/src/a.ts");
  });

  it("returns the first offending candidate, not a later one", async () => {
    expect(await pathOutsideWorkspace(workspace, ["src/a.ts", "/etc/passwd", "../x"])).toBe("/etc/passwd");
    expect(await pathOutsideWorkspace(workspace, [])).toBeNull();
  });

  it("refuses a ~ prefix (the tools expand it to the home directory) and a NUL byte", async () => {
    for (const bad of ["~", "~/.ssh/id_rsa", "~root/x", "~/../../etc", "src/a.ts\0.png", "\0"]) expect(await pathOutsideWorkspace(workspace, [bad]), JSON.stringify(bad)).toBe(bad);
  });

  it("looks through the whitespace the tools trim before they resolve a path", async () => {
    for (const bad of [" /etc/passwd", "\t/etc/passwd\n", " /etc/passwd", " ~/x", " ../other-task/notes.md"]) expect(await pathOutsideWorkspace(workspace, [bad]), JSON.stringify(bad)).toBe(bad);
    expect(await pathOutsideWorkspace(workspace, [` ${join(workspace, "src", "a.ts")} `])).toBeNull();
  });

  it("allows a path whose directories do not exist yet (a Write into a new subdirectory)", async () => {
    expect(await pathOutsideWorkspace(workspace, ["new/deep/dir/out.txt", join(workspace, "dist", "bundle.js")])).toBeNull();
  });

  it("allows a path below an existing file; the tool itself reports the ENOTDIR", async () => {
    expect(await pathOutsideWorkspace(workspace, ["file.txt/child"])).toBeNull();
  });

  it("resolves relative paths against the given cwd", async () => {
    const src = join(workspace, "src");
    expect(await pathOutsideWorkspace(workspace, ["a.ts"], src)).toBeNull();
    expect(await pathOutsideWorkspace(workspace, ["../file.txt"], src)).toBe("../file.txt");
    expect(await pathOutsideWorkspace(workspace, ["a.ts"], other)).toBe("a.ts");
  });

  it("refuses a symlink inside the workspace that points outside, for files, directories and not-yet-existing children", async () => {
    await symlink(other, join(workspace, "link-dir"));
    await symlink(join(other, "notes.md"), join(workspace, "link-file"));
    expect(await pathOutsideWorkspace(workspace, ["link-dir"])).toBe("link-dir");
    expect(await pathOutsideWorkspace(workspace, ["link-dir/notes.md"])).toBe("link-dir/notes.md");
    expect(await pathOutsideWorkspace(workspace, ["link-dir/new/child.txt"])).toBe("link-dir/new/child.txt");
    expect(await pathOutsideWorkspace(workspace, ["link-file"])).toBe("link-file");
    expect(await pathOutsideWorkspace(workspace, [join(workspace, "link-dir", "notes.md")])).toBe(join(workspace, "link-dir", "notes.md"));
  });

  it("refuses a dangling symlink that points outside, so a Write cannot create the target through it", async () => {
    await symlink(join(other, "not-yet.txt"), join(workspace, "dangling"));
    await symlink(join(other, "missing-dir"), join(workspace, "dangling-dir"));
    expect(await pathOutsideWorkspace(workspace, ["dangling"])).toBe("dangling");
    expect(await pathOutsideWorkspace(workspace, ["dangling-dir/child/file.txt"])).toBe("dangling-dir/child/file.txt");
  });

  it("allows a symlink that stays inside the workspace", async () => {
    await symlink(join(workspace, "src"), join(workspace, "link-src"));
    await symlink("src/a.ts", join(workspace, "link-rel"));
    expect(await pathOutsideWorkspace(workspace, ["link-src/a.ts", "link-rel", "link-src/new.ts"])).toBeNull();
  });

  it("fails closed on a symlink loop instead of allowing it", async () => {
    await symlink(join(workspace, "loop-b"), join(workspace, "loop-a"));
    await symlink(join(workspace, "loop-a"), join(workspace, "loop-b"));
    await expect(pathOutsideWorkspace(workspace, ["loop-a"])).rejects.toThrow();
  });

  it("works when the workspace is itself reached through a symlink, under either spelling", async () => {
    const alias = join(root, "alias");
    await symlink(workspace, alias);
    expect(await pathOutsideWorkspace(alias, ["src/a.ts", join(alias, "src", "a.ts"), join(workspace, "src", "a.ts")])).toBeNull();
    expect(await pathOutsideWorkspace(alias, ["../other-task/notes.md", other])).toBe("../other-task/notes.md");
  });

  it("does not mutate its inputs", async () => {
    const candidates = Object.freeze(["src/a.ts", "/etc/passwd"]);
    await pathOutsideWorkspace(workspace, candidates);
    expect(candidates).toEqual(["src/a.ts", "/etc/passwd"]);
  });
});
