// SEC-2: the environment of the agent subprocess. The subprocess never sees the
// worker's secrets (the model key stays behind the gateway), and each company
// gets its own HOME, CLAUDE_CONFIG_DIR and npm cache dir, pinned here.
//
// This file pins the environment and nothing more. What stops one company's run
// from reading another company's config dir or transcripts is that pinning plus
// two other layers: the PreToolUse hook refuses file-tool paths outside the task
// workspace (`path-scope.ts`, applied by `auditHook`), and the engineering
// sandbox denies its commands the config and workspace roots (`engineeringSandbox`
// in `claude-agent-sdk.ts`). Without those two, the env alone does not isolate.
import { dirname, join } from "node:path";
import { z } from "zod";
import { PathSegmentSchema } from "./path-scope";

/** Variables the agent subprocess may inherit from the worker. No credential, and no HOME: that one is pinned per company. */
export const SUBPROCESS_ENV_ALLOWLIST: readonly string[] = Object.freeze(["PATH", "TMPDIR", "LANG", "LC_ALL", "SHELL"]);

/** The key the subprocess carries when a gateway is configured; the gateway swaps in the real key outside the sandbox. */
export const GATEWAY_PLACEHOLDER_KEY = "north-gateway";

/** Logged (through `warn`) when a real key reaches the subprocess because no gateway is configured. */
export const NO_GATEWAY_WARNING = "no model gateway configured: the model key is exposed to the agent subprocess";

/** A company id that is safe as one path segment: a uuid or a short slug, never a separator or a dot. */
const CompanyIdSchema = PathSegmentSchema;
const GatewayUrlSchema = z.url();

/** Filters the host environment down to the allow-list; never includes an empty value. */
export function minimalSubprocessEnv(source: NodeJS.ProcessEnv): Readonly<Record<string, string>> {
  const picked: Record<string, string> = {};
  for (const key of SUBPROCESS_ENV_ALLOWLIST) {
    const value = source[key];
    if (value) picked[key] = value;
  }
  return Object.freeze(picked);
}

/** Where agent config lives when the host sets none: `agent-config` next to the task workspaces. */
export function defaultConfigRoot(workspaceRoot: string): string {
  return join(dirname(workspaceRoot), "agent-config");
}

/** `<configRoot>/<companyId>`; throws when the id could step outside the root. */
export function companyConfigDir(configRoot: string, companyId: string): string {
  if (!CompanyIdSchema.safeParse(companyId).success) {
    throw new Error(`Invalid company id for the agent config dir: ${JSON.stringify(companyId)}`);
  }
  return join(configRoot, companyId);
}

/** The npm cache of a company's engineering runs: the only place under the company dir a sandboxed command may write. */
export function npmCacheDir(companyDir: string): string {
  return join(companyDir, "npm-cache");
}

/** What `subprocessEnvFor` needs to know about the run. */
export interface SubprocessEnvOptions {
  readonly companyId: string;
  readonly configRoot: string;
  /** The model gateway (loopback URL). Absent: the host key passes through and `warn` is called (until the worker wires a gateway). */
  readonly gatewayBaseUrl?: string;
  /** The host's real key for the no-gateway case; defaults to `process.env.ANTHROPIC_API_KEY`. An empty string means none. */
  readonly hostKey?: string;
  readonly warn?: (message: string) => void;
}

/** Gateway mode: the placeholder key and the gateway URL. The real key never enters. */
function gatewayVars(gatewayBaseUrl: string): Record<string, string> {
  if (!GatewayUrlSchema.safeParse(gatewayBaseUrl).success) throw new Error(`Invalid model gateway URL: ${JSON.stringify(gatewayBaseUrl)}`);
  return { ANTHROPIC_BASE_URL: gatewayBaseUrl, ANTHROPIC_API_KEY: GATEWAY_PLACEHOLDER_KEY };
}

/** No gateway: today's behaviour, kept until the worker wires one. The key (if any) passes through and the exposure is warned. */
function withHostKey(env: Readonly<Record<string, string>>, opts: SubprocessEnvOptions): Record<string, string> {
  const key = opts.hostKey ?? env.ANTHROPIC_API_KEY ?? process.env.ANTHROPIC_API_KEY;
  if (!key) return { ...env };
  (opts.warn ?? ((message) => console.warn(message)))(NO_GATEWAY_WARNING);
  return { ...env, ANTHROPIC_API_KEY: key };
}

/**
 * The environment for one company's run: a per-company HOME, CLAUDE_CONFIG_DIR
 * and npm cache, no auto memory, no nested subagents beyond depth 1, and either
 * the gateway or, without one, the host key. With a gateway the base is cut
 * down to `SUBPROCESS_ENV_ALLOWLIST` first, so nothing a caller put in it (a
 * provider switch, custom headers, cloud secrets) can reach the model API
 * around the gateway; without one the base passes through. A gateway of
 * `""` is invalid, not absent. Returns a new frozen object.
 */
export function subprocessEnvFor(base: Readonly<Record<string, string>>, opts: SubprocessEnvOptions): Readonly<Record<string, string>> {
  const dir = companyConfigDir(opts.configRoot, opts.companyId);
  const pinned = {
    HOME: dir,
    CLAUDE_CONFIG_DIR: dir,
    CLAUDE_CODE_DISABLE_AUTO_MEMORY: "1",
    CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH: "1",
    npm_config_cache: npmCacheDir(dir),
  };
  if (opts.gatewayBaseUrl !== undefined) return Object.freeze({ ...minimalSubprocessEnv(base), ...pinned, ...gatewayVars(opts.gatewayBaseUrl) });
  return Object.freeze(withHostKey({ ...base, ...pinned }, opts));
}
