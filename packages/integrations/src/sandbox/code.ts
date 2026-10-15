import { createHash } from "node:crypto";
import { appendFile, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
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
  type PushTreeInput,
  type PushTreeResult,
  type SandboxSink,
} from "../types";
import { defaultSandboxRoot, safeJoin, writeTree } from "./files";
import { recordSandboxEvent, sandboxRef } from "./record";

const OWNER = "sandbox";
/** Where branches other than main live inside a sandbox repo, and where pull requests are recorded. */
export const BRANCHES_DIR = ".branches";
export const PULLS_DIR = "pulls";

/** What the sandbox keeps of a pull request: enough for the PR page and for the "already exists" lookup. */
export const SandboxPullRequestSchema = z.object({
  number: z.number().int().positive(),
  companyId: z.string().min(1),
  fullName: z.string().min(3),
  head: z.string().min(1),
  base: z.string().min(1),
  title: z.string().min(1),
  body: z.string(),
  state: z.enum(["open", "closed"]),
  url: z.string().min(1),
  openedAt: z.string(),
});
export type SandboxPullRequest = z.infer<typeof SandboxPullRequestSchema>;

/**
 * File-backed stand-in for the user's GitHub: repos are folders under
 * `<root>/repos/sandbox/<name>`, every push rewrites the tree (main at the
 * root, other branches under `.branches/<branch>/`) and appends a line to
 * `.north-commits.jsonl`; the "commit sha" is the content hash. Pull requests
 * are numbered per repo and written to `pulls/<n>.json`.
 */
export class SandboxCodeHost implements CodeHostProvider {
  private repos: ReadonlyMap<string, string> = new Map();

  constructor(
    private readonly sink?: SandboxSink,
    private readonly root: string = defaultSandboxRoot(),
    private readonly clock: () => Date = () => new Date(),
  ) {}

  private repoDir(fullName: string): string {
    return join(this.root, "repos", ...fullName.split("/"));
  }

  async ensureRepo(raw: EnsureRepoInput): Promise<EnsureRepoResult> {
    const input = EnsureRepoInputSchema.parse(raw);
    const fullName = `${OWNER}/${input.name}`;
    const existing = this.repos.get(fullName);
    const repoId = existing ?? sandboxRef("repo");
    if (!existing) {
      this.repos = new Map([...this.repos, [fullName, repoId]]);
      await mkdir(this.repoDir(fullName), { recursive: true });
    }
    const url = `sandbox://repos/${fullName}`;
    await recordSandboxEvent(this.sink, { provider: "code", op: "ensureRepo", companyId: input.companyId, ref: repoId, payload: { fullName, created: !existing, private: input.private } });
    return Object.freeze({ repoId, fullName, url, created: !existing, sandbox: true });
  }

  async pushTree(raw: PushTreeInput): Promise<PushTreeResult> {
    const input = PushTreeInputSchema.parse(raw);
    const dir = this.repoDir(input.fullName);
    if (input.branch === DEFAULT_BRANCH) await writeTree(dir, input.files, [BRANCHES_DIR, PULLS_DIR]);
    else await writeTree(safeJoin(join(dir, BRANCHES_DIR), input.branch), input.files);
    const hash = createHash("sha1");
    for (const file of [...input.files].sort((a, b) => a.path.localeCompare(b.path))) hash.update(`${file.path}\0${file.content}\0`);
    const commitSha = hash.digest("hex");
    // The log lives next to the tree, not inside it, so a push never erases history.
    await appendFile(`${dir}.commits.jsonl`, `${JSON.stringify({ sha: commitSha, branch: input.branch, message: input.message, files: input.files.length, at: this.clock().toISOString() })}\n`, "utf8");
    const url = `sandbox://repos/${input.fullName}/commit/${commitSha}`;
    await recordSandboxEvent(this.sink, { provider: "code", op: "pushTree", companyId: input.companyId, ref: url, payload: { fullName: input.fullName, branch: input.branch, files: input.files.length, commitSha } });
    return Object.freeze({ commitSha, url, sandbox: true });
  }

  private async listPulls(fullName: string): Promise<readonly SandboxPullRequest[]> {
    const dir = join(this.repoDir(fullName), PULLS_DIR);
    let names: string[];
    try {
      names = await readdir(dir);
    } catch {
      return Object.freeze([]);
    }
    const pulls: SandboxPullRequest[] = [];
    for (const name of names.filter((n) => n.endsWith(".json"))) {
      try {
        const parsed = SandboxPullRequestSchema.safeParse(JSON.parse(await readFile(join(dir, name), "utf8")));
        if (parsed.success) pulls.push(Object.freeze(parsed.data));
      } catch {
        // an unreadable record is not a pull request
      }
    }
    return Object.freeze(pulls.sort((a, b) => a.number - b.number));
  }

  /** One PR per (head, base) while it is open: a retry of the fix pipeline gets the same number and URL. */
  async openPullRequest(raw: OpenPullRequestInput): Promise<OpenPullRequestResult> {
    const input = OpenPullRequestInputSchema.parse(raw);
    const pulls = await this.listPulls(input.fullName);
    const existing = pulls.find((p) => p.state === "open" && p.head === input.head && p.base === input.base);
    if (existing) return Object.freeze({ url: existing.url, number: existing.number, sandbox: true });
    const number = (pulls.at(-1)?.number ?? 0) + 1;
    const url = `sandbox://repos/${input.fullName}/pull/${number}`;
    const record: SandboxPullRequest = Object.freeze({ number, companyId: input.companyId, fullName: input.fullName, head: input.head, base: input.base, title: input.title, body: input.body, state: "open", url, openedAt: this.clock().toISOString() });
    const dir = join(this.repoDir(input.fullName), PULLS_DIR);
    await mkdir(dir, { recursive: true });
    await writeFile(safeJoin(dir, `${number}.json`), JSON.stringify(record, null, 2), "utf8");
    await recordSandboxEvent(this.sink, { provider: "code", op: "openPullRequest", companyId: input.companyId, ref: url, payload: { fullName: input.fullName, head: input.head, base: input.base, number, title: input.title } });
    return Object.freeze({ url, number, sandbox: true });
  }
}
