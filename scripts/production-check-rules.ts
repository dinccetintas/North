/**
 * STG-1, TST-5: the env-dependent rules the worker's `/health` line must
 * satisfy, kept apart from `production-check.ts` so each rule is a small pure
 * value that can be tested alone. `healthRulesFor("production")` and
 * `healthRulesFor("staging")` are the whole difference between
 * `pnpm production:check` and `pnpm staging:check`; every other check runs
 * unchanged in both.
 *
 *   production: profile production, fence off, env production, a gateway that
 *               is off or live (never record or replay), a day's budget not spent
 *   staging:    fence on, env staging, a gateway that is off, live or record
 *               (never replay), any of the three model profiles, the gateway's
 *               budget on the line when the SDK runtime is on
 *   both:       a live worker verifies unsubscribe links (CMP-1)
 *
 * The line is untrusted JSON, so a rule compares what it was told with `===`
 * and a field the worker does not report fails, naming the worker as older
 * than this check. Nothing here reads the network or changes its input.
 */
import { MODEL_PROFILES } from "@north/core";

/** The two deployments the check knows. */
export const CHECK_ENVS = Object.freeze(["production", "staging"] as const);
/** One of {@link CHECK_ENVS}. */
export type CheckEnv = (typeof CHECK_ENVS)[number];

/** True for exactly `production` or `staging` (case matters: a usage error otherwise). */
export function isCheckEnv(value: string): value is CheckEnv {
  return (CHECK_ENVS as readonly string[]).includes(value);
}

/** The worker's health body, read as the untrusted object it is. */
export type HealthLine = Readonly<Record<string, unknown>>;

/** One assertion about the line: `holds` decides, `message` says what was found (the field and its value) and what to set. */
export interface HealthRule {
  readonly name: string;
  readonly holds: (health: HealthLine) => boolean;
  readonly message: (health: HealthLine) => string;
}

type Obj = Readonly<Record<string, unknown>>;
const isObj = (v: unknown): v is Obj => v !== null && typeof v === "object" && !Array.isArray(v);
const MAX_SHOWN = 80;

/** A reported value for a message: JSON, cut short, or `missing`. */
const shown = (v: unknown): string => (v === undefined ? "missing" : (JSON.stringify(v) ?? String(v)).slice(0, MAX_SHOWN));

/** `fence is true`, or `fence is missing (the worker is older than this check)`. */
const found = (health: HealthLine, field: string): string => (health[field] === undefined ? `${field} is missing (the worker is older than this check)` : `${field} is ${shown(health[field])}`);

/** The field must equal one value. */
const fieldIs = (field: string, expected: string | boolean, advice: string): HealthRule =>
  Object.freeze({ name: field, holds: (h: HealthLine) => h[field] === expected, message: (h: HealthLine) => `${found(h, field)}: ${advice}` });

/** The field must be one of a list of strings. */
const fieldIn = (field: string, allowed: readonly string[], advice: string): HealthRule =>
  Object.freeze({
    name: field,
    holds: (h: HealthLine) => {
      const value = h[field];
      return typeof value === "string" && allowed.includes(value);
    },
    message: (h: HealthLine) => `${found(h, field)}: ${advice}`,
  });

/** CMP-1: a live worker must be able to verify `/u/{token}`; a sandbox worker is not asked. */
const UNSUBSCRIBE: HealthRule = Object.freeze({
  name: "unsubscribe",
  holds: (h: HealthLine) => h.mode !== "live" || h.unsubscribe === true,
  message: (h: HealthLine) => `${found(h, "unsubscribe")} with mode "live": a live worker must verify unsubscribe links (set UNSUBSCRIBE_SECRET on Fly)`,
});

/** Production: no gateway (null) or a gateway whose day is still open. */
const PRODUCTION_BUDGET: HealthRule = Object.freeze({
  name: "budget",
  holds: (h: HealthLine) => h.budget === null || (isObj(h.budget) && h.budget.exhausted === false),
  message: (h: HealthLine) =>
    isObj(h.budget) ? `budget is ${shown(h.budget)}: exhausted is not false, so the model gateway has closed the day and agents cannot run (raise NORTH_DAILY_CAP_USD or wait for the next UTC day)` : `${found(h, "budget")}: expected null or the gateway's budget`,
});

/** Staging: with the SDK runtime on, the gateway runs and its budget is on the line. A spent day is read, not failed. */
const STAGING_BUDGET: HealthRule = Object.freeze({
  name: "budget",
  holds: (h: HealthLine) => h.runtime !== "claude-agent-sdk" || isObj(h.budget),
  message: (h: HealthLine) => `${found(h, "budget")} with runtime "claude-agent-sdk": the model gateway must report its day's budget (NORTH_DAILY_CAP_USD)`,
});

const PRODUCTION_RULES: readonly HealthRule[] = Object.freeze([
  fieldIs("profile", "production", "production runs the production model profile (unset NORTH_MODEL_PROFILE)"),
  fieldIs("fence", false, "the test-account fence is for staging (set NORTH_TEST_FENCE=0)"),
  fieldIs("env", "production", "this worker is not a production deployment (set NORTH_ENV=production)"),
  fieldIn("gateway", ["off", "live"], "production must not record or replay model calls (set NORTH_CASSETTE_MODE=off)"),
  UNSUBSCRIBE,
  PRODUCTION_BUDGET,
]);

const STAGING_RULES: readonly HealthRule[] = Object.freeze([
  fieldIs("fence", true, "staging runs behind the test-account fence (set NORTH_TEST_FENCE=1), so a live key cannot reach a real account"),
  fieldIs("env", "staging", "this worker is not a staging deployment (set NORTH_ENV=staging)"),
  fieldIn("gateway", ["off", "live", "record"], "a replaying gateway answers from tape, so staging would test nothing real (set NORTH_CASSETTE_MODE=off or record)"),
  fieldIn("profile", MODEL_PROFILES, `the model profile must be one of ${MODEL_PROFILES.join(", ")} (set NORTH_MODEL_PROFILE)`),
  UNSUBSCRIBE,
  STAGING_BUDGET,
]);

/** The rules for one env. The lists are frozen and shared; a caller cannot change them. */
export function healthRulesFor(env: CheckEnv): readonly HealthRule[] {
  return env === "production" ? PRODUCTION_RULES : STAGING_RULES;
}

/** The message of every rule of `env` that does not hold for `health`, in rule order; empty when the line is fine. */
export function failedHealthRules(env: CheckEnv, health: HealthLine): readonly string[] {
  return healthRulesFor(env)
    .filter((rule) => !rule.holds(health))
    .map((rule) => rule.message(health));
}

/** A short token (`smoke`, `record`) as reported; anything else, long or with a control character, prints as `?` (the rules' messages show it quoted). */
const word = (v: unknown): string => (typeof v === "string" && /^[A-Za-z0-9_.-]{1,40}$/.test(v) ? v : "?");

/** What the line says about the four env-dependent fields, for the check's detail line (`?` for a field not reported or not a short token). */
export function healthFacts(health: HealthLine): string {
  const fence = typeof health.fence === "boolean" ? (health.fence ? "on" : "off") : "?";
  return `profile ${word(health.profile)}, fence ${fence}, gateway ${word(health.gateway)}, env ${word(health.env)}`;
}

const dollars = (v: unknown): string => (typeof v === "number" && Number.isFinite(v) ? `$${v.toFixed(4)}` : "?");

/**
 * STG-1: the day's model budget for the check's detail line, e.g.
 * `, budget $0.4321 of $1.0000 (seeded $0.4000 at boot)`; empty without a
 * budget object, `(no cap)` for a cap of 0, and the seed left out when the
 * worker does not report one (older than the boot seed).
 */
export function budgetFacts(health: HealthLine): string {
  const b = health.budget;
  if (!isObj(b)) return "";
  const spent = `, budget ${dollars(b.spentUsd)}`;
  if (b.capUsd === 0) return `${spent} (no cap)`;
  const seeded = typeof b.seededUsd === "number" && Number.isFinite(b.seededUsd) ? ` (seeded ${dollars(b.seededUsd)} at boot)` : "";
  return `${spent} of ${dollars(b.capUsd)}${seeded}`;
}

