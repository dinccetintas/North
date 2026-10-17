import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { assertWorkerReplays } from "../src/lib/replay-health";
import { BYPASS_HEADER, bypassCookieFrom, SET_BYPASS_COOKIE_HEADER, storageStateFor, storageStatePath } from "./live/bypass-cookie";

const WORKER_URL = process.env.E2E_WORKER_URL ?? "http://localhost:3101";
/** `apps/web`, where the staging config's `use.storageState` points (`test-results/staging-storage-state.json`). */
const WEB_ROOT = resolve(__dirname, "..");
const PRIME_TIMEOUT_MS = 15_000;

type Env = Readonly<Record<string, string | undefined>>;

/**
 * TST-2: a replay run (`pnpm e2e:replay` sets `NORTH_CASSETTE_MODE=replay` in
 * this process) must run against a worker that replays. The worker is its own
 * process, started by `pnpm dev`, so this reads its `/health` and fails the run
 * unless it reports the SDK runtime and a replaying gateway; a mock worker would
 * pass every spec and prove nothing. Without the variable it does nothing.
 */
async function replayGate(env: Env): Promise<void> {
  if (env.NORTH_CASSETTE_MODE !== "replay") return;
  const url = `${WORKER_URL}/health`;
  await assertWorkerReplays(async () => (await fetch(url, { signal: AbortSignal.timeout(3000) })).json(), { label: url });
  console.log(`replay: the worker at ${url} runs claude-agent-sdk with a replaying gateway`);
}

/**
 * TST-3: with an https `E2E_BASE_URL` and `VERCEL_AUTOMATION_BYPASS_SECRET`
 * (the live journey on staging), sends the secret once, from Node, with
 * `x-vercel-set-bypass-cookie: samesitenone`, and writes the `_vercel_jwt`
 * cookie Vercel answers with (scoped to the staging host) as the storage state
 * both staging projects start from. The browser never sees the secret: no
 * header, route or context option holds it, so neither another origin nor a
 * trace can. Fails naming the host and status, never the secret, when no
 * cookie comes back. Otherwise (local runs, the dry run) it does nothing.
 */
async function primeStagingBypass(env: Env): Promise<void> {
  const base = (env.E2E_BASE_URL ?? "").trim();
  const secret = (env.VERCEL_AUTOMATION_BYPASS_SECRET ?? "").trim();
  if (!base.toLowerCase().startsWith("https:") || secret === "") return;
  const host = new URL(base).hostname;
  const res = await fetch(base, { redirect: "manual", headers: { [BYPASS_HEADER]: secret, [SET_BYPASS_COOKIE_HEADER]: "samesitenone" }, signal: AbortSignal.timeout(PRIME_TIMEOUT_MS) }).catch((error: unknown) => {
    throw new Error(`staging bypass: ${host} did not answer (${error instanceof Error ? error.message : "network error"})`);
  });
  const cookie = bypassCookieFrom(res.headers.getSetCookie(), host, new Date());
  if (!cookie) {
    throw new Error(`staging bypass: ${host} answered ${res.status} without a _vercel_jwt cookie; check Deployment Protection → Protection Bypass for Automation is enabled and VERCEL_AUTOMATION_BYPASS_SECRET is its current secret (docs/runbooks/staging.md §15)`);
  }
  const file = storageStatePath(WEB_ROOT);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(storageStateFor(cookie), null, 2)}\n`, { mode: 0o600 });
  console.log(`staging bypass: cookie primed for ${host} until ${new Date(cookie.expires * 1000).toISOString()}`);
}

/** Global setup of the local suites (replay gate) and the staging journey (bypass cookie); each part acts only when its env asks for it. */
export default async function globalSetup(): Promise<void> {
  await replayGate(process.env);
  await primeStagingBypass(process.env);
}
