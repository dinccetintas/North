/**
 * TST-3, TST-4: the pure rules of the live journey on staging, shared by
 * `playwright.staging.config.ts`, `helpers.ts` and `journey.live.spec.ts`
 * and unit-tested in `staging-env.test.ts`. No Playwright import here, no
 * network, no file system; nothing changes its input.
 *
 * A staging run needs `E2E_BASE_URL`, `VERCEL_AUTOMATION_BYPASS_SECRET` (for
 * an https base URL), `E2E_SUPABASE_URL` (or `NEXT_PUBLIC_SUPABASE_URL`: the
 * magic link must point there), `E2E_MAIL_PROVIDER=resend`, `E2E_RESEND_KEY`
 * and `E2E_MAIL_DOMAIN` (docs/runbooks/staging.md §15). Without
 * `E2E_BASE_URL` the run is a dry run: every journey is skipped with
 * {@link DRY_RUN_REASON}, never passed. With `E2E_BASE_URL` set and anything
 * else missing the run fails, naming each variable: a half-configured nightly
 * must go red, not skip to green. No message and no returned value ever
 * carries a secret.
 */
import { join } from "node:path";
import { z } from "zod";

type Env = Readonly<Record<string, string | undefined>>;

/** The skip reason of a run without staging. */
export const DRY_RUN_REASON = "E2E_BASE_URL not set: the live journey runs against staging only (docs/runbooks/staging.md §15)";
/** The variables a staging run needs, in the order a message lists them. */
export const STAGING_VARIABLES = Object.freeze(["E2E_BASE_URL", "VERCEL_AUTOMATION_BYPASS_SECRET", "E2E_SUPABASE_URL", "E2E_MAIL_PROVIDER=resend", "E2E_RESEND_KEY", "E2E_MAIL_DOMAIN"] as const);
/** Agents may only touch Vercel projects with this prefix (the staging fence, `NORTH_FENCE_VERCEL_PREFIX`); a preview's host starts with the project name. */
export const FENCE_PREFIX = "e2e-";
/** The onboarding task types the journey requires `done`, each with an artifact that opens. */
export const REQUIRED_DONE = Object.freeze(["market_report", "personas", "competitor_map", "prd"] as const);

/** One journey's test timeout (`playwright.staging.config.ts`). */
export const JOURNEY_TIMEOUT_MS = 30 * 60_000;
/**
 * The longest each wait may take. With {@link OTHER_STEPS_MS} they sum below
 * {@link JOURNEY_TIMEOUT_MS}, so a slow step fails with its own name before
 * the test timeout does. `plannedCards` is one deadline shared by the go-live
 * and the campaign card (both come from the first plan's tasks).
 */
export const STEP_BUDGET_MS = Object.freeze({ tasks: 17 * 60_000, plan: 4 * 60_000, plannedCards: 4 * 60_000 });
/** Sign-in (up to 90 s for the mail), the wizard, the artifacts and the kill switch together. */
export const OTHER_STEPS_MS = 4 * 60_000;

/**
 * Every step that takes a screenshot, in journey order; a file's number is
 * its place here, so both variants number the same step the same way.
 */
export const JOURNEY_STEPS = Object.freeze([
  "signed-in",
  "company-created",
  "wizard-summary",
  "home-approved",
  "tasks-settled",
  "artifact",
  "weekly-plan",
  "go-live-card",
  "campaign-card",
  "campaign-answered",
  "kill-switch",
] as const);
export type JourneyStep = (typeof JOURNEY_STEPS)[number];

/** What a staging run reads from its env once {@link stagingEnvVerdict} says ok; never a secret (the bypass secret and the Resend key are read where they are used). */
export interface StagingEnv {
  readonly baseUrl: string;
  readonly mailDomain: string;
  readonly supabaseUrl: string;
}

export type StagingEnvVerdict =
  | { readonly kind: "ok"; readonly env: StagingEnv }
  | { readonly kind: "skip"; readonly message: string }
  | { readonly kind: "fail"; readonly message: string };

const valueOf = (env: Env, name: string): string => (env[name] ?? "").trim();
/** `E2E_SUPABASE_URL`, else `NEXT_PUBLIC_SUPABASE_URL`; blank when neither is set. */
const supabaseUrlOf = (env: Env): string => valueOf(env, "E2E_SUPABASE_URL") || valueOf(env, "NEXT_PUBLIC_SUPABASE_URL");

/** The {@link STAGING_VARIABLES} this env lacks (blank counts as unset; any provider but resend counts as missing; the bypass secret only for an https or unset base URL). */
export function missingStagingEnv(env: Env): readonly string[] {
  const base = valueOf(env, "E2E_BASE_URL");
  const needsBypass = base === "" || base.toLowerCase().startsWith("https:");
  const present: Readonly<Record<(typeof STAGING_VARIABLES)[number], boolean>> = {
    E2E_BASE_URL: base !== "",
    VERCEL_AUTOMATION_BYPASS_SECRET: !needsBypass || valueOf(env, "VERCEL_AUTOMATION_BYPASS_SECRET") !== "",
    E2E_SUPABASE_URL: supabaseUrlOf(env) !== "",
    "E2E_MAIL_PROVIDER=resend": valueOf(env, "E2E_MAIL_PROVIDER").toLowerCase() === "resend",
    E2E_RESEND_KEY: valueOf(env, "E2E_RESEND_KEY") !== "",
    E2E_MAIL_DOMAIN: valueOf(env, "E2E_MAIL_DOMAIN") !== "",
  };
  return Object.freeze(STAGING_VARIABLES.filter((name) => !present[name]));
}

const HttpUrlSchema = z.url({ protocol: /^https?$/ });
const HOSTNAME = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const withoutTrailingSlash = (url: string): string => url.replace(/\/+$/, "");

/** Skip (no `E2E_BASE_URL`), fail (staging asked for but incomplete or malformed) or ok with the values the journey uses. */
export function stagingEnvVerdict(env: Env): StagingEnvVerdict {
  const missing = missingStagingEnv(env);
  if (missing.includes("E2E_BASE_URL")) {
    const others = missing.filter((name) => name !== "E2E_BASE_URL");
    return { kind: "skip", message: others.length > 0 ? `${DRY_RUN_REASON}; also missing: ${others.join(", ")}` : DRY_RUN_REASON };
  }
  if (missing.length > 0) return { kind: "fail", message: `E2E_BASE_URL is set, so the live journey runs against staging, but it is missing ${missing.join(", ")} (docs/runbooks/staging.md §15)` };
  const baseUrl = valueOf(env, "E2E_BASE_URL");
  if (!HttpUrlSchema.safeParse(baseUrl).success) return { kind: "fail", message: "E2E_BASE_URL must be an http(s) URL such as https://staging.<web>" };
  const supabaseUrl = supabaseUrlOf(env);
  if (!HttpUrlSchema.safeParse(supabaseUrl).success) return { kind: "fail", message: "E2E_SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL) must be an http(s) URL such as https://<ref>.supabase.co" };
  const mailDomain = valueOf(env, "E2E_MAIL_DOMAIN").toLowerCase();
  if (!HOSTNAME.test(mailDomain)) return { kind: "fail", message: "E2E_MAIL_DOMAIN must be a domain such as staging.<domain>" };
  return { kind: "ok", env: { baseUrl: withoutTrailingSlash(baseUrl), mailDomain, supabaseUrl: withoutTrailingSlash(supabaseUrl) } };
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const isCalendarDay = (day: string): boolean => {
  if (!DAY.test(day)) return false;
  const parsed = new Date(`${day}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === day;
};

/** `E2E_EVIDENCE_DATE` (`YYYY-MM-DD`, so the spec and `evidence:costs` share one directory), else the UTC day of `now`. */
export function evidenceDate(env: Env, now: Date): string {
  const raw = valueOf(env, "E2E_EVIDENCE_DATE");
  if (raw === "") return now.toISOString().slice(0, 10);
  if (!isCalendarDay(raw)) throw new Error("E2E_EVIDENCE_DATE must be a calendar day as YYYY-MM-DD");
  return raw;
}

/** `<root>/docs/evidence/M7/acceptance/<date>`; a date that is not `YYYY-MM-DD` is refused, so nothing lands outside it. */
export function evidenceDir(date: string, root: string): string {
  if (!isCalendarDay(date)) throw new Error(`evidence date "${date}" is not a calendar day as YYYY-MM-DD`);
  return join(root, "docs", "evidence", "M7", "acceptance", date);
}

/** `<nn>-<step>-<project>.png`, `nn` the step's place in {@link JOURNEY_STEPS}; an unknown step is refused. */
export function shotFileName(step: string, project: string): string {
  const index = (JOURNEY_STEPS as readonly string[]).indexOf(step);
  if (index < 0) throw new Error(`unknown journey step "${step}"`);
  const safeProject = project.toLowerCase().replace(/[^a-z0-9-]+/g, "-");
  return `${String(index + 1).padStart(2, "0")}-${step}-${safeProject}.png`;
}

/** The run's fresh user, `e2e-<stamp>-<project>@<domain>` in lowercase: the shape `pnpm staging:purge-e2e` removes. */
export function e2eAddress(stamp: string, project: string, domain: string): string {
  return `e2e-${stamp}-${project}@${domain.trim()}`.toLowerCase();
}

/** True for an https URL whose host starts with the fence prefix (the Vercel test project's deployments). */
export function isFencedPreview(url: string, prefix: string = FENCE_PREFIX): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" && parsed.hostname.startsWith(prefix);
  } catch {
    return false;
  }
}

/** One onboarding row as the home renders it (`data-task-type`, `data-status`). */
export interface TaskRow {
  readonly taskType: string;
  readonly status: string;
}

/** True when there are `count` rows and every one is in `statuses`. */
export function tasksSettled(rows: readonly TaskRow[], statuses: readonly string[], count: number): boolean {
  return rows.length === count && rows.every((row) => statuses.includes(row.status));
}

/** `market_report done, personas running, …`: the rows for an error message. */
export const describeRows = (rows: readonly TaskRow[]): string => (rows.length === 0 ? "no onboarding rows" : rows.map((r) => `${r.taskType} ${r.status}`).join(", "));

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/**
 * Runs `assertion` and resolves with the milliseconds it took; rejects when it
 * throws (`<label>: <its message>`) or has not held within `ms`
 * (`<label> did not hold within <ms> ms`).
 */
export async function assertWithin(ms: number, assertion: () => Promise<unknown>, label = "the assertion"): Promise<number> {
  const started = performance.now();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} did not hold within ${ms} ms`)), ms);
  });
  const held = assertion().then(
    () => undefined,
    (error: unknown) => {
      throw new Error(`${label}: ${messageOf(error)}`, { cause: error });
    },
  );
  // When the limit wins, the assertion may still fail later: that rejection is expected and must not surface as unhandled.
  held.catch(() => undefined);
  try {
    await Promise.race([held, late]);
  } finally {
    clearTimeout(timer);
  }
  const elapsed = Math.round(performance.now() - started);
  if (elapsed > ms) throw new Error(`${label} did not hold within ${ms} ms (took ${elapsed} ms)`);
  return elapsed;
}
