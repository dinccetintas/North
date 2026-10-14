import type { EvidenceCheck, EvidenceKind } from "@north/core";
import { getArtifact, type DbClient } from "@north/db";

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface VerifierDeps {
  readonly db: DbClient;
  readonly fetchImpl?: FetchLike;
  readonly timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 10_000;

/** A URL is evidence when a GET answers 2xx within the timeout; redirects are followed. */
export async function verifyUrl(url: string, fetchImpl: FetchLike = (i, init) => fetch(i, init), timeoutMs = DEFAULT_TIMEOUT_MS): Promise<EvidenceCheck> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { kind: "url", ref: url, verified: false, detail: "not a URL" };
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return { kind: "url", ref: url, verified: false, detail: `unsupported scheme ${parsed.protocol}` };
  try {
    const response = await fetchImpl(url, { method: "GET", redirect: "follow", signal: AbortSignal.timeout(timeoutMs), headers: { "user-agent": "north-verifier/1.0" } });
    const ok = response.status >= 200 && response.status < 300;
    return { kind: "url", ref: url, verified: ok, detail: `HTTP ${response.status}` };
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
      return verifyUrl(ref, deps.fetchImpl, deps.timeoutMs);
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
