import { isHttpUrl, type EvidenceCheck, type EvidenceKind } from "@north/core";
import { getArtifact, type DbClient } from "@north/db";
import type { CampaignProviderStatus, MessageStatus } from "@north/integrations";
import type { WorkerDeps } from "../deps";
import { createPinnedFetch, vetHost, type FetchLike } from "./pinned-fetch";
import { providerAuthFor } from "./provider-auth";

export type { FetchLike } from "./pinned-fetch";
export { isPrivateAddress } from "./pinned-fetch";

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

/** Provider look-ups for campaign and message ids (M4): the adapter is asked whether the reference exists. */
export interface ProviderChecks {
  readonly campaignStatus?: (ref: string) => Promise<CampaignProviderStatus>;
  readonly messageStatus?: (ref: string) => Promise<MessageStatus>;
}

export interface VerifierDeps extends VerifierConfig, ProviderChecks {
  readonly db: DbClient;
}

const DEFAULT_TIMEOUT_MS = 10_000;

/** Resolves the host (literal or DNS) and says whether any address is private; unresolvable hosts count as private. The pinned fetch's rules (`vetHost`). */
export async function hostIsPrivate(hostname: string): Promise<boolean> {
  try {
    await vetHost(hostname);
    return false;
  } catch {
    return true;
  }
}

/**
 * A URL is evidence when a direct GET answers 2xx within the timeout: no
 * redirects, no private hosts unless the policy lists the origin. By default
 * the GET goes through the pinned fetch (D6-11), which vets the host and
 * connects only to the address it vetted; an injected fetch (tests) is
 * preceded by the same host check.
 */
export async function verifyUrl(url: string, config: VerifierConfig = {}): Promise<EvidenceCheck> {
  if (!isHttpUrl(url)) return { kind: "url", ref: url, verified: false, detail: "not an http(s) URL" };
  const parsed = new URL(url);
  const listed = config.allowedOrigins?.includes(parsed.origin) ?? false;
  if (config.allowedOrigins && !listed) return { kind: "url", ref: url, verified: false, detail: `origin ${parsed.origin} is not the site server` };
  const allowPrivate = listed || (config.allowPrivate ?? false);
  if (config.fetchImpl && !allowPrivate && (await hostIsPrivate(parsed.hostname))) return { kind: "url", ref: url, verified: false, detail: `host ${parsed.hostname} is private` };
  const fetchImpl = config.fetchImpl ?? createPinnedFetch({ allowPrivate });
  try {
    const response = await fetchImpl(url, { method: "GET", redirect: "manual", signal: AbortSignal.timeout(config.timeoutMs ?? DEFAULT_TIMEOUT_MS), headers: { "user-agent": "north-verifier/1.0" } });
    // Only the status matters: release the connection now.
    await response.body?.cancel().catch(() => undefined);
    const ok = response.status >= 200 && response.status < 300;
    const detail = response.status >= 300 && response.status < 400 ? `HTTP ${response.status} redirect to ${response.headers.get("location") ?? "?"} (not followed)` : `HTTP ${response.status}`;
    return { kind: "url", ref: url, verified: ok, detail };
  } catch (error) {
    // A refused host (`HostRefusedError`: "host … is private") lands here before any connection.
    return { kind: "url", ref: url, verified: false, detail: error instanceof Error ? error.message : String(error) };
  }
}

const plausibleRef = (ref: string): boolean => ref.length > 0 && !ref.startsWith("sandbox:noop:") && ref !== "internal";

/** Asks the provider; a reference it does not know, or a provider that cannot be reached, is not evidence. */
async function checkWithProvider(kind: EvidenceKind, ref: string, ask: (() => Promise<boolean>) | null): Promise<EvidenceCheck> {
  if (!plausibleRef(ref)) return { kind, ref, verified: false, detail: "not a provider reference" };
  if (!ask) return { kind, ref, verified: true, detail: "provider reference" };
  try {
    const known = await ask();
    return { kind, ref, verified: known, detail: known ? "confirmed by the provider" : "unknown to the provider" };
  } catch (error) {
    return { kind, ref, verified: false, detail: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * AGT-2: a reference becomes evidence only after a check that would fail if
 * the thing did not exist. URLs are fetched (sandbox sites are served by the
 * worker, so that check is real), artifact ids are looked up, campaign and
 * message ids are asked of the provider when a check is wired, other provider
 * ids count as verified when the adapter returned them.
 */
export async function verifyEvidence(deps: VerifierDeps, kind: EvidenceKind, ref: string): Promise<EvidenceCheck> {
  switch (kind) {
    case "url":
      return verifyUrl(ref, deps);
    case "artifact_id": {
      const artifact = await getArtifact(deps.db, ref).catch(() => null);
      return { kind, ref, verified: artifact !== null, detail: artifact ? `artifact ${artifact.title} v${artifact.version}` : "artifact not found" };
    }
    case "campaign_id":
      return checkWithProvider(kind, ref, deps.campaignStatus ? async () => (await deps.campaignStatus!(ref)) !== "unknown" : null);
    case "message_id":
      return checkWithProvider(kind, ref, deps.messageStatus ? async () => (await deps.messageStatus!(ref)) === "sent" : null);
    case "deploy_id":
    case "test_report":
      return { kind, ref, verified: plausibleRef(ref), detail: "provider reference" };
  }
}

/** The provider checks for one company: `ads.status` and `outreach.status` on the user's own connections. */
export function providerChecks(deps: WorkerDeps, companyId: string): ProviderChecks {
  return Object.freeze({
    campaignStatus: async (ref: string) => deps.integrations.ads(await providerAuthFor(deps, companyId, "ads.start")).status(companyId, ref),
    messageStatus: async (ref: string) => deps.integrations.outreach(await providerAuthFor(deps, companyId, "email.send.first_contact")).status(ref),
  });
}
