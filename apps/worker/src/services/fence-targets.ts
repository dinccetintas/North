// TST-5: the outside accounts and addresses an action would touch, read from its spec and the connection its adapter would run under. Pure.
import { ACTION_PROFILES, addressesOf, providerForAction, type ActionKind, type ActionSpec, type FenceTarget } from "@north/core";

/** What the fence reads from the owner's connection: its scopes (Meta's `act:<id>`) and its account label (the GitHub login). Never the token. */
export interface ConnectionFacts {
  readonly scopes: readonly string[];
  readonly accountLabel: string;
}

/** The adapters' mode and the connection the action's adapter would use: null in sandbox mode, and in live mode when there is none usable. */
export interface TargetSource {
  readonly mode: "sandbox" | "live";
  readonly connection: ConnectionFacts | null;
}

/** Kinds that change North's own rows only, although classified as outside effects: a cap raise writes the budget row; the resume it allows is gated (and fenced) itself. */
const OWN_ROWS_ONLY: ReadonlySet<ActionKind> = new Set(["budget.cap.raise"]);

const NONE: readonly FenceTarget[] = Object.freeze([]);
const ACT_SCOPE = "act:";

const targets = (list: readonly FenceTarget[]): readonly FenceTarget[] => Object.freeze(list.map((target) => Object.freeze({ ...target })));

/** The action's target could not be determined: the fence must refuse it, never pass it by omission. */
const unknown = (action: ActionKind): readonly FenceTarget[] => targets([{ kind: "unknown", action }]);

/**
 * A Meta ad account id in the one form the fence compares: `act_<id>`.
 * `123` and `act_123` are the same account (a leading `act_` is stripped,
 * then put back), so the env list and the connection scope always agree.
 */
export function metaAdAccountId(value: string): string {
  return `act_${value.trim().replace(/^act_/, "")}`;
}

/** `ads.*`: every `act:<id>` scope of the Meta connection (the adapter acts on the first; the fence wants all). Sandbox: no target. */
function metaTargets(kind: ActionKind, source: TargetSource): readonly FenceTarget[] {
  if (source.mode === "sandbox") return NONE;
  const ids = (source.connection?.scopes ?? [])
    .filter((scope) => scope.startsWith(ACT_SCOPE))
    .map((scope) => scope.slice(ACT_SCOPE.length).trim())
    .filter((id) => id !== "");
  return ids.length > 0 ? targets(ids.map((id): FenceTarget => ({ kind: "meta_ad_account", id: metaAdAccountId(id) }))) : unknown(kind);
}

/** The owner part of a payload's `fullName` (`owner/repo`), or "" when it has none. */
function ownerOf(payload: ActionSpec["payload"]): string {
  const fullName = payload?.fullName;
  return typeof fullName === "string" ? (fullName.split("/")[0] ?? "").trim() : "";
}

/**
 * `repo.*`: the GitHub connection's login (the account the adapter creates
 * repositories under); a push or pull request also names the owner of the
 * repository it writes to (`payload.fullName`). Sandbox: no target.
 */
function githubTargets(spec: ActionSpec, source: TargetSource): readonly FenceTarget[] {
  if (source.mode === "sandbox") return NONE;
  const login = source.connection?.accountLabel.trim() ?? "";
  if (login === "") return unknown(spec.kind);
  if (spec.kind === "repo.create") return targets([{ kind: "github_owner", login }]);
  const owner = ownerOf(spec.payload);
  return owner === "" ? unknown(spec.kind) : targets([{ kind: "github_owner", login }, { kind: "github_owner", login: owner }]);
}

/** `deploy.*`: the Vercel project the payload names, exactly as the adapter will get it; in both modes. */
function vercelTargets(spec: ActionSpec): readonly FenceTarget[] {
  const name = spec.payload?.name;
  return typeof name === "string" && name.trim() !== "" ? targets([{ kind: "vercel_project", name }]) : unknown(spec.kind);
}

/** `email.send.*`: one recipient per address the send could reach (core's `addressesOf`: list, `to`, `cc`, `bcc`); in both modes. */
function recipientTargets(spec: ActionSpec): readonly FenceTarget[] {
  const addresses = addressesOf(spec);
  return addresses.length > 0 ? targets(addresses.map((email): FenceTarget => ({ kind: "recipient", email }))) : unknown(spec.kind);
}

/**
 * The outside targets the fence checks for an action (TST-5). Kinds without
 * an outside effect (K0 internal work, a signal card) and a cap raise have
 * none. Payload-derived targets (Vercel project, recipients) are read in both
 * modes; provider-derived ones (Meta ad account, GitHub owner) only in live
 * mode, where an adapter reaches out: in sandbox nothing does, so they are no
 * target. Whatever cannot be determined (no usable connection, no name, no
 * recipient, a kind with no target reading) is one `unknown` target, which
 * no fence lets through; in sandbox mode only payload-derived reads produce it.
 */
export function fenceTargetsOf(spec: ActionSpec, source: TargetSource): readonly FenceTarget[] {
  if (!ACTION_PROFILES[spec.kind].externalEffect || OWN_ROWS_ONLY.has(spec.kind)) return NONE;
  switch (providerForAction(spec.kind)) {
    case "meta_ads":
      return metaTargets(spec.kind, source);
    case "github":
      return githubTargets(spec, source);
    case "vercel":
      return vercelTargets(spec);
    case "gmail":
      return recipientTargets(spec);
    default:
      return source.mode === "sandbox" ? NONE : unknown(spec.kind);
  }
}
