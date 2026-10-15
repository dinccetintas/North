import { isIP } from "node:net";
import { lookup } from "node:dns/promises";
import { isHttpUrl, type EvidenceCheck, type EvidenceKind } from "@north/core";
import { getArtifact, type DbClient } from "@north/db";

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/**
 * How URLs are verified (AGT-2) and what they may point at (M3 security
 * review M3): the preview is content an agent wrote, so the verifier never
 * follows redirects, and private or loopback hosts are allowed only for the
 * sandbox site server, whose origin is listed explicitly.
 */
export interface VerifierConfig {
  readonly fetchImpl?: FetchLike;
  readonly timeoutMs?: number;
  /** Origins that may be fetched even when private (the sandbox site server). Unset means any public host. */
  readonly allowedOrigins?: readonly string[];
  /** Loopback, link-local and RFC 1918 hosts: only the sandbox stack needs them. */
  readonly allowPrivate?: boolean;
}

export interface VerifierDeps extends VerifierConfig {
  readonly db: DbClient;
}

const DEFAULT_TIMEOUT_MS = 10_000;
const defaultFetch: FetchLike = (input, init) => fetch(input, init);

/** True for addresses the worker must never be pointed at from agent-written content. */
export function isPrivateAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) {
    const [a = 0, b = 0] = address.split(".").map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
  }
  if (family === 6) {
    const lower = address.toLowerCase();
    if (lower === "::1" || lower === "::") return true;
    if (lower.startsWith("::ffff:")) return isPrivateAddress(lower.slice(7));
    return /^f[cd]/.test(lower) || /^fe[89ab]/.test(lower);
  }
  return false;
}

/** Resolves the host (literal or DNS) and says whether any address is private. Unresolvable hosts count as private. */
export async function hostIsPrivate(hostname: string): Promise<boolean> {
  const host = hostname.replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".internal") || host.endsWith(".local")) return true;
  if (isIP(host)) return isPrivateAddress(host);
  try {
    const addresses = await lookup(host, { all: true });
    return addresses.length === 0 || addresses.some((a) => isPrivateAddress(a.address));
  } catch {
    return true;
  }
}

/** A URL is evidence when a direct GET answers 2xx within the timeout: no redirects, no private hosts unless the policy lists the origin. */
export async function verifyUrl(url: string, config: VerifierConfig = {}): Promise<EvidenceCheck> {
  if (!isHttpUrl(url)) return { kind: "url", ref: url, verified: false, detail: "not an http(s) URL" };
  const parsed = new URL(url);
  const listed = config.allowedOrigins?.includes(parsed.origin) ?? false;
  if (config.allowedOrigins && !listed) return { kind: "url", ref: url, verified: false, detail: `origin ${parsed.origin} is not the site server` };
  if (!listed && !config.allowPrivate && (await hostIsPrivate(parsed.hostname))) return { kind: "url", ref: url, verified: false, detail: `host ${parsed.hostname} is private` };
  const fetchImpl = config.fetchImpl ?? defaultFetch;
  try {
    const response = await fetchImpl(url, { method: "GET", redirect: "manual", signal: AbortSignal.timeout(config.timeoutMs ?? DEFAULT_TIMEOUT_MS), headers: { "user-agent": "north-verifier/1.0" } });
    const ok = response.status >= 200 && response.status < 300;
    const detail = response.status >= 300 && response.status < 400 ? `HTTP ${response.status} redirect to ${response.headers.get("location") ?? "?"} (not followed)` : `HTTP ${response.status}`;
    return { kind: "url", ref: url, verified: ok, detail };
  } catch (error) {
    return { kind: "url", ref: url, verified: false, detail: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * AGT-2: a reference becomes evidence only after a check that would fail if
 * the thing did not exist. URLs are fetched (sandbox sites are served by the
 * worker, so that check is real), artifact ids are looked up, provider ids
 * (deploys, messages) count as verified when the adapter returned them.
 */
export async function verifyEvidence(deps: VerifierDeps, kind: EvidenceKind, ref: string): Promise<EvidenceCheck> {
  switch (kind) {
    case "url":
      return verifyUrl(ref, deps);
    case "artifact_id": {
      const artifact = await getArtifact(deps.db, ref).catch(() => null);
      return { kind, ref, verified: artifact !== null, detail: artifact ? `artifact ${artifact.title} v${artifact.version}` : "artifact not found" };
    }
    case "deploy_id":
    case "message_id":
    case "test_report":
      return { kind, ref, verified: ref.length > 0 && !ref.startsWith("sandbox:noop:") && ref !== "internal", detail: "provider reference" };
  }
}
