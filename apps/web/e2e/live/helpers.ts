/**
 * TST-3, TST-4: the browser-side helpers of the live journey on staging
 * (`journey.live.spec.ts`). The pure rules live in `staging-env.ts` (unit
 * tested); this file adds what needs Playwright: the skip or failure when the
 * staging env is absent, waiting on the home's onboarding rows, reload
 * polling, per-step screenshots and the journey's notes file. Everything
 * reads the real UI; nothing writes to the database.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { test, type Page } from "@playwright/test";
import { ONBOARDING_TASK_COUNT, onboardingRows } from "../flows";
import { describeRows, evidenceDir as evidenceDirUnder, shotFileName, stagingEnvVerdict, tasksSettled, type JourneyStep, type StagingEnv, type TaskRow } from "./staging-env";

export { assertWithin } from "./staging-env";

/** The repository root (this file is `apps/web/e2e/live/helpers.ts`). */
const REPO_ROOT = resolve(__dirname, "../../../..");
/** How often a wait reloads the page; the home refreshes itself too while agents work. */
const RELOAD_INTERVAL_MS = 15_000;

/** `docs/evidence/M7/acceptance/<date>` under the repository root. */
export function evidenceDir(date: string): string {
  return evidenceDirUnder(date, REPO_ROOT);
}

/**
 * Call in a `test.describe` body (or at the top of a test): without
 * `E2E_BASE_URL` it calls `test.skip(true, message)` with the dry-run reason
 * and every other missing variable, so the group is reported skipped and no
 * browser starts; with `E2E_BASE_URL` set but the env incomplete it throws,
 * naming each missing variable.
 */
export function requireStagingEnv(env: Readonly<Record<string, string | undefined>> = process.env): void {
  const verdict = stagingEnvVerdict(env);
  if (verdict.kind === "fail") throw new Error(verdict.message);
  if (verdict.kind === "skip") test.skip(true, verdict.message);
}

/** The staging values the journey uses; throws unless the env is complete (a test only runs when it is). */
export function stagingEnv(env: Readonly<Record<string, string | undefined>> = process.env): StagingEnv {
  const verdict = stagingEnvVerdict(env);
  if (verdict.kind !== "ok") throw new Error(verdict.message);
  return verdict.env;
}

/** A full-page screenshot as `<dir>/<nn>-<step>-<project>.png`; returns the file. */
export async function stepShot(page: Page, dir: string, name: JourneyStep): Promise<string> {
  const file = join(dir, shotFileName(name, test.info().project.name));
  await mkdir(dir, { recursive: true });
  await page.screenshot({ path: file, fullPage: true });
  return file;
}

/** The home's onboarding rows as rendered (`data-task-type`, `data-status`). */
export async function readOnboardingRows(page: Page): Promise<readonly TaskRow[]> {
  const rows = await onboardingRows(page).evaluateAll((elements) => elements.map((el) => ({ taskType: el.getAttribute("data-task-type") ?? "", status: el.getAttribute("data-status") ?? "" })));
  return Object.freeze(rows.map((row) => Object.freeze(row)));
}

export interface WaitForTasksOptions {
  readonly statuses: readonly string[];
  readonly timeoutMs: number;
  readonly intervalMs?: number;
}

/**
 * Opens the company home and reloads it until all six onboarding rows are in
 * one of `statuses`; returns them. Throws after `timeoutMs` with each row's
 * last status.
 */
export async function waitForTasks(page: Page, slug: string, { statuses, timeoutMs, intervalMs = RELOAD_INTERVAL_MS }: WaitForTasksOptions): Promise<readonly TaskRow[]> {
  const deadline = Date.now() + timeoutMs;
  await page.goto(`/c/${slug}`);
  for (;;) {
    const rows = await readOnboardingRows(page);
    if (tasksSettled(rows, statuses, ONBOARDING_TASK_COUNT)) return rows;
    if (Date.now() + intervalMs > deadline) {
      throw new Error(`waitForTasks: after ${Math.round(timeoutMs / 60_000)} min the ${ONBOARDING_TASK_COUNT} onboarding tasks are not all ${statuses.join(" or ")}: ${describeRows(rows)}`);
    }
    await page.waitForTimeout(intervalMs);
    await page.reload();
  }
}

export interface PollOptions {
  readonly timeoutMs: number;
  readonly label: string;
  readonly intervalMs?: number;
}

/** Reloads the current page until `probe` is true; throws `<label>: not within <n> min` after `timeoutMs`. */
export async function pollReload(page: Page, probe: () => Promise<boolean>, { timeoutMs, label, intervalMs = RELOAD_INTERVAL_MS }: PollOptions): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await probe()) return;
    if (Date.now() + intervalMs > deadline) throw new Error(`${label}: not within ${Math.round(timeoutMs / 60_000)} min`);
    await page.waitForTimeout(intervalMs);
    await page.reload();
  }
}

/**
 * What one journey records next to its screenshots: no id, no address, no
 * error text (the Playwright report holds that). `slug` is how
 * `pnpm evidence:costs -- --slug …` finds the company, also after a failure.
 */
export interface JourneyNotes {
  readonly variant: "nightly" | "acceptance";
  readonly slug: string;
  readonly outcome: "running" | "passed" | "failed";
  /** `planned: …` or `not planned`. */
  readonly build?: string;
  /** `absent`, `present: not answered (nightly)` or `answered: <option>`. */
  readonly campaign?: string;
  /** How long the paused state took to show after the kill switch was pressed. */
  readonly killSwitchMs?: number;
}

/** Writes (or rewrites) `<dir>/journey-<project>.json`; a passed journey's notes also go into the test's annotations (the JSON report carries them). */
export async function writeJourneyNotes(dir: string, notes: JourneyNotes): Promise<string> {
  const info = test.info();
  const project = info.project.name;
  const file = join(dir, `journey-${project}.json`);
  await mkdir(dir, { recursive: true });
  await writeFile(file, `${JSON.stringify({ project, ...notes, writtenAt: new Date().toISOString() }, null, 2)}\n`);
  if (notes.outcome === "passed") {
    info.annotations.push({ type: "build", description: notes.build ?? "" }, { type: "campaign", description: notes.campaign ?? "" }, { type: "kill-switch", description: `${notes.killSwitchMs ?? "?"} ms` });
  }
  return file;
}
