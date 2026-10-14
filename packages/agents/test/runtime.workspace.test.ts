import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { workspaceFiles } from "../src/runtime/workspace";

describe("workspaceFiles", () => {
  it("collects text files with relative posix paths and skips hidden, ignored, binary and oversized entries", async () => {
    const dir = await mkdtemp(join(tmpdir(), "north-ws-"));
    await mkdir(join(dir, "styles"), { recursive: true });
    await mkdir(join(dir, "node_modules", "x"), { recursive: true });
    await mkdir(join(dir, ".git"), { recursive: true });
    await writeFile(join(dir, "index.html"), "<h1>hi</h1>");
    await writeFile(join(dir, "styles", "site.css"), "h1{}");
    await writeFile(join(dir, "node_modules", "x", "index.js"), "ignored");
    await writeFile(join(dir, ".git", "HEAD"), "ignored");
    await writeFile(join(dir, ".env"), "SECRET=1");
    await writeFile(join(dir, "logo.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    await writeFile(join(dir, "huge.txt"), "x".repeat(600 * 1024));

    const files = await workspaceFiles(dir);
    expect(files.map((f) => f.path)).toEqual(["index.html", "styles/site.css"]);
    expect(files[0]?.content).toBe("<h1>hi</h1>");
    expect(Object.isFrozen(files)).toBe(true);
  });

  it("returns an empty list for a missing or empty workspace", async () => {
    expect(await workspaceFiles(join(tmpdir(), "north-ws-does-not-exist"))).toEqual([]);
  });
});
