import { NotConfiguredError, ProviderError } from "../errors";
import { CreateDeploymentInputSchema, type CreateDeploymentInput, type DeployProvider, type DeploymentResult, type DeploymentState, type ProviderAuth } from "../types";
import type { FetchLike } from "./github";

const API = "https://api.vercel.com";

interface VercelDeployment {
  readonly id: string;
  readonly url: string;
  readonly readyState?: string;
  readonly target?: string | null;
}

/** Maps Vercel's readyState onto North's three states. */
export function mapReadyState(state: string | undefined): DeploymentState {
  switch ((state ?? "").toUpperCase()) {
    case "READY":
      return "ready";
    case "ERROR":
    case "CANCELED":
      return "error";
    default:
      return "building";
  }
}

/**
 * Vercel through the user's token: static files are uploaded inline with the
 * deployment request (no git integration needed), previews by default,
 * `target: production` when the CEO approved going live.
 */
export class VercelDeploy implements DeployProvider {
  constructor(
    private readonly auth: ProviderAuth | null,
    private readonly fetchImpl: FetchLike = (input, init) => fetch(input, init),
  ) {}

  private async api<T>(method: string, path: string, body?: unknown): Promise<T> {
    if (!this.auth) throw new NotConfiguredError("Vercel is not connected for this user (connect it in Settings → Connections)");
    const query = this.auth.scope ? `${path.includes("?") ? "&" : "?"}teamId=${encodeURIComponent(this.auth.scope)}` : "";
    let response: Response;
    try {
      response = await this.fetchImpl(`${API}${path}${query}`, {
        method,
        headers: { authorization: `Bearer ${this.auth.token}`, "content-type": "application/json" },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    } catch (error) {
      throw new ProviderError("vercel", error instanceof Error ? error.message : "request failed", error);
    }
    if (response.status < 200 || response.status >= 300) {
      const text = await response.text().catch(() => "");
      throw new ProviderError("vercel", `${method} ${path} → ${response.status} ${text.slice(0, 200)}`);
    }
    return (await response.json()) as T;
  }

  async create(raw: CreateDeploymentInput): Promise<DeploymentResult> {
    const input = CreateDeploymentInputSchema.parse(raw);
    const deployment = await this.api<VercelDeployment>("POST", "/v13/deployments", {
      name: input.name,
      files: input.files.map((f) => ({ file: f.path, data: Buffer.from(f.content, "utf8").toString("base64"), encoding: "base64" })),
      projectSettings: { framework: null },
      ...(input.target === "production" ? { target: "production" } : {}),
    });
    return Object.freeze({ deployId: deployment.id, url: `https://${deployment.url}`, target: input.target, sandbox: false });
  }

  async status(_companyId: string, deployId: string): Promise<DeploymentState> {
    const deployment = await this.api<VercelDeployment>("GET", `/v13/deployments/${encodeURIComponent(deployId)}`);
    return mapReadyState(deployment.readyState);
  }
}
