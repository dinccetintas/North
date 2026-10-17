import { rm } from "node:fs/promises";
import { resolve } from "node:path";
import { storageStatePath } from "./live/bypass-cookie";

/**
 * TST-3: removes the staging storage state the global setup primed (the
 * `_vercel_jwt` bypass cookie), so the cookie does not outlive the run in
 * `test-results/`. A no-op when there is none (local runs, the dry run).
 */
export default async function globalTeardown(): Promise<void> {
  await rm(storageStatePath(resolve(__dirname, "..")), { force: true });
}
