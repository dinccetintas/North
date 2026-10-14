import { randomUUID } from "node:crypto";
import { access } from "node:fs/promises";
import { join } from "node:path";
import { CreateDeploymentInputSchema, type CreateDeploymentInput, type DeployProvider, type DeploymentResult, type DeploymentState, type SandboxSink } from "../types";
import { defaultSandboxRoot, writeTree } from "./files";
import { recordSandboxEvent } from "./record";

export const SANDBOX_SITES_PATH = "/sandbox/sites";

/** Default public base for sandbox sites: the worker serves `<root>/sites` at `/sandbox/sites`. */
export function defaultSiteBaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  return env.SANDBOX_SITE_BASE_URL ?? `http://127.0.0.1:${env.WORKER_PORT ?? "3101"}`;
}

/** Folder name for a production site: stable per project so "going live" replaces the previous version. */
export const liveSiteDir = (name: string): string => `live-${name}`;

/**
 * Deployments as folders under `<root>/sites/<id>` that the worker serves over
 * HTTP, so the verifier's 200 check is a real request even in sandbox mode.
 * Production deploys also land in `live-<name>` (the stable live URL).
 */
export class SandboxDeploy implements DeployProvider {
  constructor(
    private readonly sink?: SandboxSink,
    private readonly root: string = defaultSandboxRoot(),
    private readonly baseUrl: string = defaultSiteBaseUrl(),
  ) {}

  async create(raw: CreateDeploymentInput): Promise<DeploymentResult> {
    const input = CreateDeploymentInputSchema.parse(raw);
    const id = randomUUID();
    const deployId = `sandbox:deploy:${id}`;
    await writeTree(join(this.root, "sites", id), input.files);
    let url = `${this.baseUrl}${SANDBOX_SITES_PATH}/${id}/`;
    if (input.target === "production") {
      await writeTree(join(this.root, "sites", liveSiteDir(input.name)), input.files);
      url = `${this.baseUrl}${SANDBOX_SITES_PATH}/${liveSiteDir(input.name)}/`;
    }
    await recordSandboxEvent(this.sink, { provider: "deploy", op: "create", companyId: input.companyId, ref: deployId, payload: { name: input.name, target: input.target, files: input.files.length, url } });
    return Object.freeze({ deployId, url, target: input.target, sandbox: true });
  }

  async status(_companyId: string, deployId: string): Promise<DeploymentState> {
    const id = deployId.replace(/^sandbox:deploy:/, "");
    try {
      await access(join(this.root, "sites", id));
      return "ready";
    } catch {
      return "error";
    }
  }
}
