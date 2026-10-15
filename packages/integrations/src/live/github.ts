import { NotConfiguredError, ProviderError } from "../errors";
import {
  DEFAULT_BRANCH,
  EnsureRepoInputSchema,
  OpenPullRequestInputSchema,
  PushTreeInputSchema,
  type CodeHostProvider,
  type EnsureRepoInput,
  type EnsureRepoResult,
  type OpenPullRequestInput,
  type OpenPullRequestResult,
  type ProviderAuth,
  type PushTreeInput,
  type PushTreeResult,
} from "../types";

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

const API = "https://api.github.com";

interface GitHubRepo {
  readonly id: number;
  readonly full_name: string;
  readonly html_url: string;
  readonly default_branch?: string;
}

interface GitHubPull {
  readonly number: number;
  readonly html_url: string;
  readonly state?: string;
}

/**
 * The user's GitHub through their OAuth token (EXP-1): one repo per company
 * site, one commit per push via the Git Data API, a pull request per fix
 * branch (PRO-2). The token is only ever a request header here; errors never
 * echo it.
 */
export class GitHubCodeHost implements CodeHostProvider {
  constructor(
    private readonly auth: ProviderAuth | null,
    private readonly fetchImpl: FetchLike = (input, init) => fetch(input, init),
  ) {}

  private async api<T>(method: string, path: string, body?: unknown, okStatuses: readonly number[] = [200, 201]): Promise<{ status: number; data: T }> {
    if (!this.auth) throw new NotConfiguredError("GitHub is not connected for this user (connect it in Settings → Connections)");
    let response: Response;
    try {
      response = await this.fetchImpl(`${API}${path}`, {
        method,
        headers: { authorization: `Bearer ${this.auth.token}`, accept: "application/vnd.github+json", "content-type": "application/json", "x-github-api-version": "2022-11-28" },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    } catch (error) {
      throw new ProviderError("github", error instanceof Error ? error.message : "request failed", error);
    }
    if (!okStatuses.includes(response.status)) {
      const text = await response.text().catch(() => "");
      throw new ProviderError("github", `${method} ${path} → ${response.status} ${text.slice(0, 200)}`);
    }
    const data = response.status === 204 ? (undefined as T) : ((await response.json()) as T);
    return { status: response.status, data };
  }

  private async owner(): Promise<string> {
    if (this.auth?.scope) return this.auth.scope;
    const { data } = await this.api<{ login: string }>("GET", "/user");
    return data.login;
  }

  async ensureRepo(raw: EnsureRepoInput): Promise<EnsureRepoResult> {
    const input = EnsureRepoInputSchema.parse(raw);
    const owner = await this.owner();
    const existing = await this.api<GitHubRepo>("GET", `/repos/${owner}/${input.name}`, undefined, [200, 404]);
    if (existing.status === 200) {
      return Object.freeze({ repoId: String(existing.data.id), fullName: existing.data.full_name, url: existing.data.html_url, created: false, sandbox: false });
    }
    const path = this.auth?.scope ? `/orgs/${owner}/repos` : "/user/repos";
    const created = await this.api<GitHubRepo>("POST", path, { name: input.name, private: input.private, auto_init: true, description: "Built by North" });
    return Object.freeze({ repoId: String(created.data.id), fullName: created.data.full_name, url: created.data.html_url, created: true, sandbox: false });
  }

  /** The head sha of a branch, or null when the ref does not exist. */
  private async refSha(base: string, branch: string): Promise<string | null> {
    const ref = await this.api<{ object: { sha: string } }>("GET", `${base}/git/ref/heads/${branch}`, undefined, [200, 404]);
    return ref.status === 200 ? ref.data.object.sha : null;
  }

  /**
   * The commit to build on: the branch head; for a missing branch other than
   * main, the branch is created from main's head first (`createBranchIfMissing`);
   * null on an empty repository, where the first commit creates the ref.
   */
  private async parentFor(base: string, branch: string): Promise<string | null> {
    const head = await this.refSha(base, branch);
    if (head || branch === DEFAULT_BRANCH) return head;
    const main = await this.refSha(base, DEFAULT_BRANCH);
    if (!main) return null;
    await this.api("POST", `${base}/git/refs`, { ref: `refs/heads/${branch}`, sha: main });
    return main;
  }

  async pushTree(raw: PushTreeInput): Promise<PushTreeResult> {
    const input = PushTreeInputSchema.parse(raw);
    const base = `/repos/${input.fullName}`;
    const parentSha = await this.parentFor(base, input.branch);
    const baseTree = parentSha ? (await this.api<{ tree: { sha: string } }>("GET", `${base}/git/commits/${parentSha}`)).data.tree.sha : null;

    const tree = [];
    for (const file of input.files) {
      const blob = await this.api<{ sha: string }>("POST", `${base}/git/blobs`, { content: file.content, encoding: "utf-8" });
      tree.push({ path: file.path, mode: "100644", type: "blob", sha: blob.data.sha });
    }
    const newTree = await this.api<{ sha: string }>("POST", `${base}/git/trees`, { tree, ...(baseTree ? { base_tree: baseTree } : {}) });
    const commit = await this.api<{ sha: string; html_url: string }>("POST", `${base}/git/commits`, { message: input.message, tree: newTree.data.sha, parents: parentSha ? [parentSha] : [] });
    if (parentSha) await this.api("PATCH", `${base}/git/refs/heads/${input.branch}`, { sha: commit.data.sha, force: false });
    else await this.api("POST", `${base}/git/refs`, { ref: `refs/heads/${input.branch}`, sha: commit.data.sha });
    return Object.freeze({ commitSha: commit.data.sha, url: commit.data.html_url, sandbox: false });
  }

  /** `POST /repos/{full}/pulls`; GitHub answers 422 when one already exists for the head, in which case it is looked up and returned. */
  async openPullRequest(raw: OpenPullRequestInput): Promise<OpenPullRequestResult> {
    const input = OpenPullRequestInputSchema.parse(raw);
    const base = `/repos/${input.fullName}`;
    const created = await this.api<GitHubPull>("POST", `${base}/pulls`, { title: input.title, head: input.head, base: input.base, body: input.body }, [201, 422]);
    if (created.status === 201) return Object.freeze({ url: created.data.html_url, number: created.data.number, sandbox: false });
    const owner = input.fullName.split("/")[0] ?? "";
    const query = `state=open&head=${encodeURIComponent(`${owner}:${input.head}`)}&base=${encodeURIComponent(input.base)}`;
    const existing = await this.api<readonly GitHubPull[]>("GET", `${base}/pulls?${query}`);
    const pull = existing.data[0];
    if (!pull) throw new ProviderError("github", `POST ${base}/pulls → 422 and no open pull request from ${input.head} into ${input.base}`);
    return Object.freeze({ url: pull.html_url, number: pull.number, sandbox: false });
  }
}
