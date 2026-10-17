import { assertWorkerReplays } from "../src/lib/replay-health";

const WORKER_URL = process.env.E2E_WORKER_URL ?? "http://localhost:3101";

/**
 * TST-2: a replay run (`pnpm e2e:replay` sets `NORTH_CASSETTE_MODE=replay` in
 * this process) must run against a worker that replays. The worker is its own
 * process, started by `pnpm dev`, so this reads its `/health` and fails the run
 * unless it reports the SDK runtime and a replaying gateway; a mock worker would
 * pass every spec and prove nothing. Without the variable it does nothing.
 */
export default async function globalSetup(): Promise<void> {
  if (process.env.NORTH_CASSETTE_MODE !== "replay") return;
  const url = `${WORKER_URL}/health`;
  await assertWorkerReplays(async () => (await fetch(url, { signal: AbortSignal.timeout(3000) })).json(), { label: url });
  console.log(`replay: the worker at ${url} runs claude-agent-sdk with a replaying gateway`);
}
