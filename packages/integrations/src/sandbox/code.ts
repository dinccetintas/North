import { createHash } from "node:crypto";
import { appendFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { EnsureRepoInputSchema, PushTreeInputSchema, type CodeHostProvider, type EnsureRepoInput, type EnsureRepoResult, type PushTreeInput, type PushTreeResult, type SandboxSink } from "../types";
import { defaultSandboxRoot, writeTree } from "./files";
import { recordSandboxEvent, sandboxRef } from "./record";

const OWNER = "sandbox";

/**
 * File-backed stand-in for the user's GitHub: repos are folders under
 * `<root>/repos/sandbox/<name>`, every push rewrites the tree and appends a
 * line to `.north-commits.jsonl`, and the "commit sha" is the content hash.
 */
export class SandboxCodeHost implements CodeHostProvider {
  private repos: ReadonlyMap<string, string> = new Map();

  constructor(
    private readonly sink?: SandboxSink,
    private readonly root: string = defaultSandboxRoot(),
  ) {}

  async ensureRepo(raw: EnsureRepoInput): Promise<EnsureRepoResult> {
    const input = EnsureRepoInputSchema.parse(raw);
    const fullName = `${OWNER}/${input.name}`;
    const existing = this.repos.get(fullName);
    const repoId = existing ?? sandboxRef("repo");
    if (!existing) {
      this.repos = new Map([...this.repos, [fullName, repoId]]);
      await mkdir(join(this.root, "repos", OWNER, input.name), { recursive: true });
    }
    const url = `sandbox://repos/${fullName}`;
    await recordSandboxEvent(this.sink, { provider: "code", op: "ensureRepo", companyId: input.companyId, ref: repoId, payload: { fullName, created: !existing, private: input.private } });
    return Object.freeze({ repoId, fullName, url, created: !existing, sandbox: true });
  }

  async pushTree(raw: PushTreeInput): Promise<PushTreeResult> {
    const input = PushTreeInputSchema.parse(raw);
    const dir = join(this.root, "repos", ...input.fullName.split("/"));
    await writeTree(dir, input.files);
    const hash = createHash("sha1");
    for (const file of [...input.files].sort((a, b) => a.path.localeCompare(b.path))) hash.update(`${file.path}\0${file.content}\0`);
    const commitSha = hash.digest("hex");
    // The log lives next to the tree, not inside it, so a push never erases history.
    await appendFile(`${dir}.commits.jsonl`, `${JSON.stringify({ sha: commitSha, branch: input.branch, message: input.message, files: input.files.length, at: new Date().toISOString() })}\n`, "utf8");
    const url = `sandbox://repos/${input.fullName}/commit/${commitSha}`;
    await recordSandboxEvent(this.sink, { provider: "code", op: "pushTree", companyId: input.companyId, ref: url, payload: { fullName: input.fullName, branch: input.branch, files: input.files.length, commitSha } });
    return Object.freeze({ commitSha, url, sandbox: true });
  }
}
