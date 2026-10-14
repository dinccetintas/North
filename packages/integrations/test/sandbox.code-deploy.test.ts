import { mkdtemp, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SandboxCodeHost } from "../src/sandbox/code";
import { SandboxDeploy, liveSiteDir } from "../src/sandbox/deploy";
import { safeJoin } from "../src/sandbox/files";
import { SandboxImages, placeholderSvg } from "../src/sandbox/images";
import { createSandboxIntegrations } from "../src/sandbox/index";
import type { SandboxEvent } from "../src/types";

const files = [
  { path: "index.html", content: "<h1>Lumen</h1>" },
  { path: "styles/site.css", content: "h1{color:#000}" },
];

const recorder = () => {
  const events: SandboxEvent[] = [];
  return { events, sink: (event: SandboxEvent) => void events.push(event) };
};

describe("SandboxCodeHost", () => {
  it("creates a repo folder once and rewrites it on every push with a content-hash commit", async () => {
    const root = await mkdtemp(join(tmpdir(), "north-code-"));
    const { events, sink } = recorder();
    const code = new SandboxCodeHost(sink, root);
    const first = await code.ensureRepo({ companyId: "c1", name: "lumen-site" });
    const second = await code.ensureRepo({ companyId: "c1", name: "lumen-site" });
    expect(first).toMatchObject({ fullName: "sandbox/lumen-site", created: true, sandbox: true });
    expect(second).toMatchObject({ repoId: first.repoId, created: false });

    const push = await code.pushTree({ companyId: "c1", fullName: first.fullName, message: "Initial site", files });
    expect(push.commitSha).toMatch(/^[0-9a-f]{40}$/);
    expect(await readFile(join(root, "repos", "sandbox", "lumen-site", "styles", "site.css"), "utf8")).toBe("h1{color:#000}");
    const again = await code.pushTree({ companyId: "c1", fullName: first.fullName, message: "Same", files });
    expect(again.commitSha).toBe(push.commitSha);
    const log = await readFile(join(root, "repos", "sandbox", "lumen-site.commits.jsonl"), "utf8");
    expect(log.trim().split("\n")).toHaveLength(2);
    expect(events.map((e) => e.op)).toEqual(["ensureRepo", "ensureRepo", "pushTree", "pushTree"]);
  });

  it("rejects repo names that are not url-safe and paths that escape the repo", async () => {
    const root = await mkdtemp(join(tmpdir(), "north-code-"));
    const code = new SandboxCodeHost(undefined, root);
    await expect(code.ensureRepo({ companyId: "c1", name: "Bad Name" })).rejects.toThrow();
    await expect(code.pushTree({ companyId: "c1", fullName: "sandbox/x", message: "m", files: [{ path: "../../etc/passwd", content: "x" }] })).rejects.toThrow(/outside the sandbox/);
    expect(() => safeJoin("/tmp/a", "../b")).toThrow();
    expect(safeJoin("/tmp/a", "b/c.txt")).toBe("/tmp/a/b/c.txt");
  });
});

describe("SandboxDeploy", () => {
  it("writes a preview site under /sandbox/sites/<id>/ and reports it ready", async () => {
    const root = await mkdtemp(join(tmpdir(), "north-deploy-"));
    const { events, sink } = recorder();
    const deploy = new SandboxDeploy(sink, root, "http://127.0.0.1:3101");
    const preview = await deploy.create({ companyId: "c1", name: "lumen-site", files });
    expect(preview.deployId).toMatch(/^sandbox:deploy:/);
    expect(preview.url).toMatch(/^http:\/\/127\.0\.0\.1:3101\/sandbox\/sites\/[0-9a-f-]{36}\/$/);
    expect(preview.target).toBe("preview");
    const id = preview.deployId.replace("sandbox:deploy:", "");
    expect(await readFile(join(root, "sites", id, "index.html"), "utf8")).toBe("<h1>Lumen</h1>");
    expect(await deploy.status("c1", preview.deployId)).toBe("ready");
    expect(await deploy.status("c1", "sandbox:deploy:missing")).toBe("error");
    expect(events[0]).toMatchObject({ provider: "deploy", op: "create", payload: { target: "preview", files: 2 } });
  });

  it("a production deploy also lands at the stable live-<name> URL", async () => {
    const root = await mkdtemp(join(tmpdir(), "north-deploy-"));
    const deploy = new SandboxDeploy(undefined, root, "http://127.0.0.1:3101");
    const live = await deploy.create({ companyId: "c1", name: "lumen-site", target: "production", files });
    expect(live.url).toBe(`http://127.0.0.1:3101/sandbox/sites/${liveSiteDir("lumen-site")}/`);
    expect(await readdir(join(root, "sites", liveSiteDir("lumen-site")))).toContain("index.html");
  });
});

describe("SandboxImages and the sandbox bundle", () => {
  it("returns a labelled SVG data URI", async () => {
    const images = new SandboxImages();
    const result = await images.generate({ prompt: "Hero: calm desk with a laptop", width: 800, height: 400 });
    expect(result.sandbox).toBe(true);
    expect(result.url.startsWith("data:image/svg+xml;base64,")).toBe(true);
    const svg = Buffer.from(result.url.split(",")[1] ?? "", "base64").toString("utf8");
    expect(svg).toContain('width="800"');
    expect(svg).toContain("Hero: calm desk");
    expect(placeholderSvg("<script>", 100, 100)).not.toContain("<script>");
  });

  it("createSandboxIntegrations wires code, deploy and images next to ads, mail and push", async () => {
    const root = await mkdtemp(join(tmpdir(), "north-bundle-"));
    const { events, sink } = recorder();
    const integrations = createSandboxIntegrations(sink, { root, siteBaseUrl: "http://127.0.0.1:3101" });
    expect(integrations.code(null)).toBe(integrations.code({ token: "ignored" }));
    await integrations.code(null).ensureRepo({ companyId: "c1", name: "x" });
    await integrations.deploy(null).create({ companyId: "c1", name: "x", files });
    await integrations.images.generate({ prompt: "p" });
    expect(events.map((e) => e.provider)).toEqual(["code", "deploy", "images"]);
  });
});
