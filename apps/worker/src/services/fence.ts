// TST-5, CMP-1: what the gate is told before it decides: the outside targets the test fence checks, and the company's suppressions and sender identity.
import { addressesOf, fenceVerdict, providerForAction, suppressedAddressOf, type ActionKind, type ActionSpec, type ConnectionProvider, type FencePolicy, type FenceTarget, type OutreachContext, type OutreachRefusal } from "@north/core";
import { companyOwnerId, getConnection, getSenderIdentity, listSuppressed, SANDBOX_SCOPE } from "@north/db";
import type { WorkerDeps } from "../deps";
import { fenceTargetsOf, type ConnectionFacts } from "./fence-targets";

/** The marker of an action the test fence blocked; `blocked_reason` names the target. */
export const TEST_FENCE = "test_fence";
/** The marker of an action the outreach rules blocked; `blocked_reason` names the address or the missing identity. */
export const OUTREACH_POLICY = "outreach_policy";

/** Providers whose target the fence reads from the connection (Meta's ad account, GitHub's login); every other target comes from the payload. */
const CONNECTION_TARGETS: ReadonlySet<ConnectionProvider> = new Set(["meta_ads", "github"]);

/** The kinds that write to a person: only these get an outreach context. */
const OUTREACH_KINDS: ReadonlySet<ActionKind> = new Set(["email.send.first_contact", "email.send.reply"]);

/**
 * Live mode only: the scopes and label of the owner's connection the action's
 * adapter would run under, or null when there is none usable (absent, not
 * `connected`, or sandbox-scoped, as `providerAuthFor` counts it). Reads the
 * row, never the token: the gate needs to know whose account, not to use it.
 */
async function connectionFactsFor(deps: WorkerDeps, companyId: string, kind: ActionKind): Promise<ConnectionFacts | null> {
  const provider = providerForAction(kind);
  if (deps.integrations.mode === "sandbox" || !provider || !CONNECTION_TARGETS.has(provider)) return null;
  const connection = await getConnection(deps.db, await companyOwnerId(deps.db, companyId), provider);
  if (!connection || connection.status !== "connected" || connection.scopes.includes(SANDBOX_SCOPE)) return null;
  return Object.freeze({ scopes: Object.freeze([...connection.scopes]), accountLabel: connection.accountLabel });
}

/** TST-5: the outside targets of an action (`fenceTargetsOf`), with the connection read in live mode; an `unknown` target when one cannot be named. */
export async function fenceTargetsFor(deps: WorkerDeps, companyId: string, spec: ActionSpec): Promise<readonly FenceTarget[]> {
  const connection = await connectionFactsFor(deps, companyId, spec.kind);
  return fenceTargetsOf(spec, { mode: deps.integrations.mode, connection });
}

/** The fence context the gate gets, and the verdict's reason when the fence refuses (null when every target is inside). */
export interface FenceCheck {
  readonly context: { readonly policy: FencePolicy; readonly targets: readonly FenceTarget[] };
  readonly refusal: string | null;
}

/**
 * TST-5: null while the fence is off (nothing is read). Otherwise the targets
 * and `fenceVerdict`'s reason, so the row can name the target outside the
 * fence (`gate()` keeps only the `test_fence` token) while `gate()` decides on
 * the very same context.
 */
export async function fenceCheckFor(deps: WorkerDeps, companyId: string, spec: ActionSpec): Promise<FenceCheck | null> {
  if (!deps.fence.enabled) return null;
  const targets = await fenceTargetsFor(deps, companyId, spec);
  const verdict = fenceVerdict(targets, deps.fence);
  return Object.freeze({ context: Object.freeze({ policy: deps.fence, targets }), refusal: verdict.allowed ? null : verdict.reason });
}

/**
 * CMP-1: for a first contact or a reply, which of its addresses (core's
 * `addressesOf`: list, `to`, `cc`, `bcc`) the company has suppressed, and
 * its sender identity; undefined for every other kind. `listSuppressed`
 * fails closed (an address it cannot look up comes back suppressed).
 */
export async function outreachContextFor(deps: WorkerDeps, companyId: string, spec: ActionSpec): Promise<OutreachContext | undefined> {
  if (!OUTREACH_KINDS.has(spec.kind)) return undefined;
  const [suppressed, senderIdentity] = await Promise.all([listSuppressed(deps.db, companyId, addressesOf(spec)), getSenderIdentity(deps.db, companyId)]);
  return Object.freeze({ suppressed: Object.freeze([...suppressed]), senderIdentity });
}

/** The row's reason for an outreach block: `suppressed: <address>` or `no_sender_identity: no sender identity`. */
export function outreachBlockReason(spec: ActionSpec, outreach: OutreachContext, refusal: OutreachRefusal): string {
  if (refusal === "no_sender_identity") return "no_sender_identity: no sender identity";
  return `suppressed: ${suppressedAddressOf(spec, outreach.suppressed) ?? "a recipient"}`;
}
