/**
 * TST-4: the live journey's cost evidence. After `pnpm e2e:staging` or
 * `pnpm e2e:live` the staging workflows run this with the staging service
 * key: it reads the journey company's tasks and `agent_runs` (costs are never
 * read through the UI) and writes `run.json` next to the screenshots:
 * `{ sha, profile, company: { slug, idHash }, tasks: [{ taskType, status,
 * model, inputTokens, outputTokens, costUsd, durationMs }], totalCostUsd,
 * redacted: true }`. No task id, company id (only the first 12 hex of its
 * SHA-256), account id or address is written; the schema refuses a file that
 * holds a uuid or an email. `profile` is the worker's `/health` profile when
 * `EVIDENCE_WORKER_URL` is set, else null.
 *
 * It refuses a database that is not this machine unless
 * `EVIDENCE_ALLOW_REMOTE_DB=1` (the smoke's rule) and prints no key.
 *
 * Usage: SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… [EVIDENCE_ALLOW_REMOTE_DB=1] [EVIDENCE_WORKER_URL=…] \
 *          pnpm evidence:costs -- --slug <company slug> [--out <dir>]
 *   env: EVIDENCE_COMPANY_SLUG (instead of --slug), E2E_EVIDENCE_DATE (the default --out's day),
 *        EVIDENCE_SHA (else GITHUB_SHA, else git)
 */
import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { z } from "zod";
import { createServiceClient, getCompanyBySlug, listRecentRuns, listTasks } from "@north/db";
import { evidenceCostsPlan, RunJsonSchema, summariseEvidence, type EvidenceCostsPlan } from "./evidence-costs-helpers";
import { messageOf } from "./smoke-llm-helpers";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const FETCH_TIMEOUT_MS = 10_000;
/** `listRecentRuns`' ceiling; a journey records a few dozen runs. */
const MAX_RUNS = 1000;
const HealthSchema = z.object({ profile: z.string().min(1) });

/** The worker's model profile from its `/health`; null (with a warning) when it cannot be read, so the costs are still written. */
async function readProfile(workerUrl: string | null): Promise<string | null> {
  if (workerUrl === null) return null;
  try {
    const res = await fetch(`${workerUrl}/health`, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    return HealthSchema.parse(await res.json()).profile;
  } catch (error) {
    console.warn(`evidence costs: the worker's /health at ${workerUrl} gave no profile (${messageOf(error)}); profile recorded as null`);
    return null;
  }
}

function commitSha(plan: EvidenceCostsPlan): string {
  if (plan.sha) return plan.sha;
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { cwd: REPO_ROOT, encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

async function main(): Promise<number> {
  const plan = evidenceCostsPlan(process.env, process.argv.slice(2), new Date());
  const db = createServiceClient({ url: plan.supabaseUrl, serviceRoleKey: (process.env.SUPABASE_SERVICE_ROLE_KEY ?? "").trim() });
  const company = await getCompanyBySlug(db, plan.slug);
  if (!company) throw new Error(`no company with the slug ${plan.slug} in that project`);
  const [tasks, runs, profile] = await Promise.all([listTasks(db, company.id), listRecentRuns(db, company.id, MAX_RUNS), readProfile(plan.workerUrl)]);
  if (runs.length === MAX_RUNS) console.warn(`evidence costs: ${MAX_RUNS} runs read, the most this script reads; older runs are not counted`);
  const summary = summariseEvidence(
    runs.map((r) => ({ taskId: r.taskId, model: r.model, runtime: r.runtime, inputTokens: r.inputTokens, outputTokens: r.outputTokens, costUsd: r.costUsd, durationMs: r.durationMs })),
    tasks.map((t) => ({ id: t.id, taskType: t.taskType, status: t.status })),
    commitSha(plan),
    profile,
    { slug: company.slug, id: company.id },
  );
  const json = RunJsonSchema.parse(summary);
  const path = resolve(REPO_ROOT, plan.outDir, "run.json");
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(json, null, 2)}\n`);
  const shown = path.startsWith(`${REPO_ROOT}${sep}`) ? relative(REPO_ROOT, path) : path;
  console.log(`evidence costs: ${json.tasks.length} task(s), ${runs.length} run(s), total $${json.totalCostUsd.toFixed(4)}, profile ${json.profile ?? "unknown"} → ${shown}`);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then(
    (code) => {
      process.exitCode = code;
    },
    (error: unknown) => {
      console.error(`evidence costs: FAIL\n- ${messageOf(error)}`);
      process.exitCode = 1;
    },
  );
}
