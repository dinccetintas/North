// SEC-2: the environment of the agent subprocess. The subprocess never sees the
// worker's secrets; the model key stays behind the gateway, and each company
// gets its own HOME and CLAUDE_CONFIG_DIR so one company's config, memory files
// and local transcripts are never readable by another company's run.
import { dirname, join } from "node:path";
import { z } from "zod";

/** Variables the agent subprocess may inherit from the worker. No credential, and no HOME: that one is pinned per company. */
export const SUBPROCESS_ENV_ALLOWLIST: readonly string[] = Object.freeze(["PATH", "TMPDIR", "LANG", "LC_ALL", "SHELL"]);

/** The key the subprocess carries when a gateway is configured; the gateway swaps in the real key outside the sandbox. */
export const GATEWAY_PLACEHOLDER_KEY = "north-gateway";

/** Logged (through `warn`) when a real key reaches the subprocess because no gateway is configured. */
export const NO_GATEWAY_WARNING = "no model gateway configured: the model key is exposed to the agent subprocess";

/** Credentials that would let the subprocess reach the model API around the gateway. */
const CREDENTIAL_VARS: readonly string[] = Object.freeze(["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "CLAUDE_CODE_OAUTH_TOKEN"]);

/** A company id that is safe as one path segment: a uuid or a short slug, never a separator or a dot. */
const CompanyIdSchema = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);
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

const without = (env: Readonly<Record<string, string>>, names: readonly string[]): Record<string, string> =>
  Object.fromEntries(Object.entries(env).filter(([name]) => !names.includes(name)));

/** Gateway mode: every credential removed, the placeholder key and the gateway URL set. The real key never enters. */
function viaGateway(env: Readonly<Record<string, string>>, gatewayBaseUrl: string): Record<string, string> {
  if (!GatewayUrlSchema.safeParse(gatewayBaseUrl).success) throw new Error(`Invalid model gateway URL: ${JSON.stringify(gatewayBaseUrl)}`);
  return { ...without(env, CREDENTIAL_VARS), ANTHROPIC_BASE_URL: gatewayBaseUrl, ANTHROPIC_API_KEY: GATEWAY_PLACEHOLDER_KEY };
}

/** No gateway: today's behaviour, kept until the worker wires one. The key (if any) passes through and the exposure is warned. */
function withHostKey(env: Readonly<Record<string, string>>, opts: SubprocessEnvOptions): Record<string, string> {
  const key = opts.hostKey ?? env.ANTHROPIC_API_KEY ?? process.env.ANTHROPIC_API_KEY;
  if (!key) return { ...env };
  (opts.warn ?? ((message) => console.warn(message)))(NO_GATEWAY_WARNING);
  return { ...env, ANTHROPIC_API_KEY: key };
}

/**
 * The environment for one company's run: the base (the allow-listed host
 * variables) plus a per-company HOME and CLAUDE_CONFIG_DIR, no auto memory, no
 * nested subagents beyond depth 1, and either the gateway (placeholder key) or,
 * without one, the host key. Returns a new frozen object.
 */
export function subprocessEnvFor(base: Readonly<Record<string, string>>, opts: SubprocessEnvOptions): Readonly<Record<string, string>> {
  const dir = companyConfigDir(opts.configRoot, opts.companyId);
  const isolated = {
    ...base,
    HOME: dir,
    CLAUDE_CONFIG_DIR: dir,
    CLAUDE_CODE_DISABLE_AUTO_MEMORY: "1",
    CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH: "1",
  };
  return Object.freeze(opts.gatewayBaseUrl ? viaGateway(isolated, opts.gatewayBaseUrl) : withHostKey(isolated, opts));
}
