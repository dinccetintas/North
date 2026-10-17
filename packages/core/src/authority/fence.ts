// TST-5: the test-account fence. Staging runs real adapters, so every outside target must be a test account, or it is blocked.
import { z } from "zod";
import { normaliseEmail, singleAddress } from "../outreach/policy";
import { ACTION_KINDS } from "./action";

/**
 * Which outside accounts a fenced run may touch. While `enabled`, anything not
 * allowed here is blocked (default deny): the lists start empty, so an
 * unconfigured fence lets nothing through except Vercel projects named
 * `e2e-*` and Stripe test keys.
 */
export const FencePolicySchema = z.object({
  enabled: z.boolean(),
  metaAdAccounts: z.array(z.string()).default([]),
  githubOwners: z.array(z.string()).default([]),
  vercelProjectPrefix: z.string().default("e2e-"),
  recipientDomains: z.array(z.string()).default([]),
  /** What a `stripe_key` target must start with to be inside the fence; it matches that target only. Whether a key is a Stripe test key at all is {@link isStripeTestKey}. */
  stripeKeyPrefix: z.literal("sk_test_").default("sk_test_"),
});
export type FencePolicy = z.infer<typeof FencePolicySchema>;

/**
 * One outside account or address an action is about to touch. `unknown`
 * stands for a target the caller could not determine for an action of that
 * kind: it is never inside a fence, so an action cannot pass by omission.
 */
export const FenceTargetSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("meta_ad_account"), id: z.string() }),
  z.object({ kind: z.literal("github_owner"), login: z.string() }),
  z.object({ kind: z.literal("vercel_project"), name: z.string() }),
  z.object({ kind: z.literal("recipient"), email: z.string() }),
  z.object({ kind: z.literal("stripe_key"), prefix: z.string() }),
  z.object({ kind: z.literal("unknown"), action: z.enum(ACTION_KINDS) }),
]);
export type FenceTarget = z.infer<typeof FenceTargetSchema>;

export type FenceVerdict = { readonly allowed: true } | { readonly allowed: false; readonly reason: string };

const ALLOWED: FenceVerdict = Object.freeze({ allowed: true });

/** How much of a Stripe key a reason may show: `sk_live_` and no more, so a full key never reaches a log. */
const STRIPE_PREFIX_SHOWN = 8;

/** How much of any other raw value a reason may show. */
const RAW_VALUE_SHOWN = 80;

/**
 * True when the recipient is exactly one readable address at an allowed domain
 * or a subdomain of one. Anything else (none, several, text the rules cannot
 * read) is not allowed: a list with one test address in it could still reach a
 * real person.
 */
function domainAllowed(email: string, domains: readonly string[]): boolean {
  const address = singleAddress(email);
  if (address === null) return false;
  const domain = address.slice(address.lastIndexOf("@") + 1);
  return domains.some((entry) => {
    const allowed = normaliseEmail(entry);
    return allowed !== "" && (domain === allowed || domain.endsWith(`.${allowed}`));
  });
}

/** True when the target is on the policy's allow-list for its kind. */
function isInside(target: FenceTarget, policy: FencePolicy): boolean {
  switch (target.kind) {
    case "meta_ad_account":
      return policy.metaAdAccounts.includes(target.id);
    case "github_owner":
      return policy.githubOwners.some((login) => login.toLowerCase() === target.login.toLowerCase());
    case "vercel_project":
      return policy.vercelProjectPrefix !== "" && target.name.startsWith(policy.vercelProjectPrefix);
    case "recipient":
      return domainAllowed(target.email, policy.recipientDomains);
    case "stripe_key":
      return target.prefix.startsWith(policy.stripeKeyPrefix);
    case "unknown":
      return false;
  }
}

/** A raw value as a reason shows it: on one line and cut short, however much an agent put in it. */
function shown(raw: string): string {
  return raw.replace(/\s+/g, " ").slice(0, RAW_VALUE_SHOWN);
}

/** The value a verdict names for the target. */
function targetValue(target: FenceTarget): string {
  switch (target.kind) {
    case "meta_ad_account":
      return shown(target.id);
    case "github_owner":
      return shown(target.login);
    case "vercel_project":
      return shown(target.name);
    case "recipient":
      return shown(target.email);
    case "stripe_key":
      return target.prefix.slice(0, STRIPE_PREFIX_SHOWN);
    case "unknown":
      return target.action;
  }
}

/**
 * Whether an action may touch these targets. A disabled fence allows
 * everything. An enabled one allows the action only when every target is on
 * its allow-list (recipients by domain, one address each; Vercel projects by
 * prefix); otherwise the reason names the first target that is outside, by
 * kind and raw value (one line, cut to 80 characters), or says
 * `unknown target for <kind>` for a target the caller could not determine.
 */
export function fenceVerdict(targets: readonly FenceTarget[], policy: FencePolicy): FenceVerdict {
  if (!policy.enabled) return ALLOWED;
  const outside = targets.find((target) => !isInside(target, policy));
  if (!outside) return ALLOWED;
  const reason = outside.kind === "unknown" ? `unknown target for ${targetValue(outside)}` : `${outside.kind} ${targetValue(outside)} is outside the test fence`;
  return Object.freeze({ allowed: false, reason });
}

/** Stripe test-mode keys: a secret key (`sk_test_`) or a restricted key (`rk_test_`). */
const STRIPE_TEST_KEY = /^(sk|rk)_test_/;

/** True when the key is a Stripe test-mode key (`sk_test_…` or `rk_test_…`); the one definition the fence and the billing config share. */
export function isStripeTestKey(key: string): boolean {
  return STRIPE_TEST_KEY.test(key);
}

/**
 * A Meta ad account id in the one form the fence compares: `act_<id>`.
 * `123` and `act_123` are the same account (a leading `act_` is stripped,
 * then put back), so the env list and the connection's `act:` scope agree.
 */
export function metaAdAccountId(value: string): string {
  return `act_${value.trim().replace(/^act_/, "")}`;
}

/** `owner/repo` as GitHub names them: a login (letters, digits, `-`, up to 39) and a repository name (letters, digits, `.`, `_`, `-`, up to 100). */
const REPO_FULL_NAME = /^[A-Za-z0-9-]{1,39}\/([A-Za-z0-9._-]{1,100})$/;

/**
 * True when the value is exactly `owner/repo` with nothing that could move an
 * API path: no third segment, no `%` encoding, and a repository part that is
 * not `.` or `..`. The fence reads the owner only from such a name, and the
 * code-host adapters refuse any other (a `fullName` is interpolated into
 * `/repos/<fullName>/…`, where `allowed/../victim/repo` would land in
 * `victim/repo`).
 */
export function isRepoFullName(value: string): boolean {
  const repo = REPO_FULL_NAME.exec(value)?.[1];
  return repo !== undefined && repo !== "." && repo !== "..";
}

/** A comma-separated env value as a list: trimmed, empties dropped. */
function list(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item !== "");
}

/**
 * The fence policy a process runs under, read from its environment. The fence
 * is on only when `NORTH_TEST_FENCE` is exactly `1`; the allow-lists come from
 * `NORTH_FENCE_META_AD_ACCOUNTS`, `NORTH_FENCE_GITHUB_OWNERS` and
 * `NORTH_FENCE_RECIPIENT_DOMAINS` (comma-separated); a blank
 * `NORTH_FENCE_VERCEL_PREFIX` keeps the `e2e-` default.
 */
export function fencePolicyFromEnv(env: Readonly<Record<string, string | undefined>>): FencePolicy {
  const prefix = env.NORTH_FENCE_VERCEL_PREFIX?.trim();
  return Object.freeze(
    FencePolicySchema.parse({
      enabled: env.NORTH_TEST_FENCE === "1",
      metaAdAccounts: list(env.NORTH_FENCE_META_AD_ACCOUNTS),
      githubOwners: list(env.NORTH_FENCE_GITHUB_OWNERS),
      recipientDomains: list(env.NORTH_FENCE_RECIPIENT_DOMAINS),
      ...(prefix ? { vercelProjectPrefix: prefix } : {}),
    }),
  );
}
