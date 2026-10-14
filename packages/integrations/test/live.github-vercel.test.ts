import { describe, expect, it } from "vitest";
import { NotConfiguredError, ProviderError } from "../src/errors";
import { GitHubCodeHost, type FetchLike } from "../src/live/github";
import { VercelDeploy, mapReadyState } from "../src/live/vercel";
import { selectIntegrations } from "../src/select";

interface Call {
  readonly method: string;
  readonly url: string;
  readonly body: unknown;
  readonly auth: string | null;
}

/** Scripted fetch: answers by `METHOD path` and records every call. */
function scripted(routes: Record<string, (body: unknown) => { status: number; json?: unknown }>) {
  const calls: Call[] = [];
  const fetchImpl: FetchLike = async (url, init) => {
    const method = init?.method ?? "GET";
    const path = new URL(url).pathname;
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    const headers = init?.headers as Record<string, string> | undefined;
    calls.push({ method, url, body, auth: headers?.authorization ?? null });
    const handler = routes[`${method} ${path}`];
    if (!handler) return new Response(JSON.stringify({ message: `no route ${method} ${path}` }), { status: 404 });
    const { status, json } = handler(body);
    return new Response(json === undefined ? null : JSON.stringify(json), { status, headers: { "content-type": "application/json" } });
  };
  return { calls, fetchImpl };
}

const files = [{ path: "index.html", content: "<h1>hi</h1>" }];

describe("GitHubCodeHost", () => {
  it("refuses without a connection and never leaks the token in errors", async () => {
    await expect(new GitHubCodeHost(null).ensureRepo({ companyId: "c1", name: "site" })).rejects.toBeInstanceOf(NotConfiguredError);
    const { fetchImpl } = scripted({ "GET /user": () => ({ status: 401, json: { message: "Bad credentials" } }) });
    const failure = new GitHubCodeHost({ token: "gho_secret" }, fetchImpl).ensureRepo({ companyId: "c1", name: "site" });
    await expect(failure).rejects.toBeInstanceOf(ProviderError);
    await expect(failure).rejects.not.toThrow(/gho_secret/);
  });

  it("creates the repo under the user when missing, reuses it when present", async () => {
    let exists = false;
    const { calls, fetchImpl } = scripted({
      "GET /user": () => ({ status: 200, json: { login: "mara" } }),
      "GET /repos/mara/site": () => (exists ? { status: 200, json: { id: 7, full_name: "mara/site", html_url: "https://github.com/mara/site" } } : { status: 404, json: {} }),
      "POST /user/repos": () => {
        exists = true;
        return { status: 201, json: { id: 7, full_name: "mara/site", html_url: "https://github.com/mara/site" } };
      },
    });
    const code = new GitHubCodeHost({ token: "gho_x" }, fetchImpl);
    expect(await code.ensureRepo({ companyId: "c1", name: "site" })).toMatchObject({ repoId: "7", fullName: "mara/site", created: true, sandbox: false });
    expect(await code.ensureRepo({ companyId: "c1", name: "site" })).toMatchObject({ created: false });
    expect(calls.find((c) => c.method === "POST")?.body).toMatchObject({ name: "site", private: true, auto_init: true });
    expect(calls.every((c) => c.auth === "Bearer gho_x")).toBe(true);
  });

  it("pushes one commit through the Git Data API on top of the branch head", async () => {
    const { calls, fetchImpl } = scripted({
      "GET /repos/mara/site/git/ref/heads/main": () => ({ status: 200, json: { object: { sha: "parent" } } }),
      "GET /repos/mara/site/git/commits/parent": () => ({ status: 200, json: { tree: { sha: "basetree" } } }),
      "POST /repos/mara/site/git/blobs": () => ({ status: 201, json: { sha: "blob1" } }),
      "POST /repos/mara/site/git/trees": () => ({ status: 201, json: { sha: "tree1" } }),
      "POST /repos/mara/site/git/commits": () => ({ status: 201, json: { sha: "commit1", html_url: "https://github.com/mara/site/commit/commit1" } }),
      "PATCH /repos/mara/site/git/refs/heads/main": () => ({ status: 200, json: {} }),
    });
    const code = new GitHubCodeHost({ token: "gho_x" }, fetchImpl);
    const result = await code.pushTree({ companyId: "c1", fullName: "mara/site", message: "Initial site", files });
    expect(result).toEqual({ commitSha: "commit1", url: "https://github.com/mara/site/commit/commit1", sandbox: false });
    const tree = calls.find((c) => c.url.endsWith("/git/trees"))?.body as { tree: unknown[]; base_tree: string };
    expect(tree.base_tree).toBe("basetree");
    expect(tree.tree).toEqual([{ path: "index.html", mode: "100644", type: "blob", sha: "blob1" }]);
    const commit = calls.find((c) => c.url.endsWith("/git/commits") && c.method === "POST")?.body;
    expect(commit).toMatchObject({ message: "Initial site", parents: ["parent"] });
  });

  it("creates the branch ref on an empty repository", async () => {
    const { calls, fetchImpl } = scripted({
      "GET /repos/mara/site/git/ref/heads/main": () => ({ status: 404, json: {} }),
      "POST /repos/mara/site/git/blobs": () => ({ status: 201, json: { sha: "b" } }),
      "POST /repos/mara/site/git/trees": () => ({ status: 201, json: { sha: "t" } }),
      "POST /repos/mara/site/git/commits": () => ({ status: 201, json: { sha: "c", html_url: "u" } }),
      "POST /repos/mara/site/git/refs": () => ({ status: 201, json: {} }),
    });
    await new GitHubCodeHost({ token: "gho_x" }, fetchImpl).pushTree({ companyId: "c1", fullName: "mara/site", message: "m", files });
    expect(calls.find((c) => c.url.endsWith("/git/refs"))?.body).toEqual({ ref: "refs/heads/main", sha: "c" });
  });
});

describe("VercelDeploy", () => {
  it("uploads the files inline, previews by default and targets production on request", async () => {
    const { calls, fetchImpl } = scripted({
      "POST /v13/deployments": (body) => ({ status: 200, json: { id: "dpl_1", url: "site-abc.vercel.app", readyState: "QUEUED", target: (body as { target?: string }).target ?? null } }),
      "GET /v13/deployments/dpl_1": () => ({ status: 200, json: { id: "dpl_1", url: "site-abc.vercel.app", readyState: "READY" } }),
    });
    const deploy = new VercelDeploy({ token: "vc_x", scope: "team_9" }, fetchImpl);
    const preview = await deploy.create({ companyId: "c1", name: "site", files });
    expect(preview).toEqual({ deployId: "dpl_1", url: "https://site-abc.vercel.app", target: "preview", sandbox: false });
    const live = await deploy.create({ companyId: "c1", name: "site", target: "production", files });
    expect(live.target).toBe("production");
    expect(calls[0]?.url).toContain("teamId=team_9");
    expect(calls[0]?.body).toMatchObject({ name: "site", files: [{ file: "index.html", encoding: "base64" }], projectSettings: { framework: null } });
    expect((calls[0]?.body as { target?: string }).target).toBeUndefined();
    expect((calls[1]?.body as { target?: string }).target).toBe("production");
    expect(await deploy.status("c1", "dpl_1")).toBe("ready");
  });

  it("maps ready states and refuses without a connection", async () => {
    expect(mapReadyState("READY")).toBe("ready");
    expect(mapReadyState("ERROR")).toBe("error");
    expect(mapReadyState("BUILDING")).toBe("building");
    expect(mapReadyState(undefined)).toBe("building");
    await expect(new VercelDeploy(null).status("c1", "x")).rejects.toBeInstanceOf(NotConfiguredError);
  });
});

describe("selectIntegrations in live mode", () => {
  it("always hands out the live code and deploy adapters (credentials come from connections)", () => {
    const integrations = selectIntegrations({ INTEGRATIONS_MODE: "live" }, undefined, () => undefined);
    expect(integrations.code({ token: "t" })).toBeInstanceOf(GitHubCodeHost);
    expect(integrations.deploy({ token: "t" })).toBeInstanceOf(VercelDeploy);
    expect(integrations.images).toBeTruthy();
  });
});
