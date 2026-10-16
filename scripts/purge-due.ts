/**
 * RET-1 (ADR 0016): the founder's purge, on request. Lists every owner the
 * daily `retention-sweep` marked `purge_due` (ended, `retention_until`
 * passed, companies archived) and, with `--yes`, purges each through the
 * worker's one delete path: the purge mark (`purge_begin`; the entitlement
 * then stays ended), storage objects, task workspaces, then `purge_owner`
 * (refused before `retention_until`; writes `purge_log`), then
 * `auth.admin.deleteUser`. Without `--yes` it only prints the list. Service
 * role only: run it with the worker's `SUPABASE_URL` and
 * `SUPABASE_SERVICE_ROLE_KEY` in the shell. The task workspaces live on the
 * worker's disk: run it there (`fly ssh console`) with `WORKSPACE_ROOT` set,
 * or the sweep's purge removes them; elsewhere they are left alone.
 *
 * Usage: npx tsx scripts/purge-due.ts [--yes] [--reason <label>]
 *   --reason   a lowercase label for `purge_log` (default `retention`; e.g. `erasure` for a legal request after the date was moved, runbook)
 */
import { listRetentionDue, PurgeReasonSchema, PurgeRefusedError, serviceClientFromEnv } from "@north/db";
import { purgeOwner } from "../apps/worker/src/services/purge";

const argValue = (flag: string): string | undefined => {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
};

async function main(): Promise<void> {
  const yes = process.argv.includes("--yes");
  const reason = PurgeReasonSchema.parse(argValue("--reason") ?? "retention");
  const db = serviceClientFromEnv();
  const env = process.env.WORKSPACE_ROOT ? { WORKSPACE_ROOT: process.env.WORKSPACE_ROOT } : undefined;
  const due = (await listRetentionDue(db, new Date())).filter((e) => e.purgeDue);
  console.log(`[purge-due] ${due.length} owner(s) marked purge_due`);
  for (const e of due) console.log(`  ${e.userId}  ended ${e.endedAt ?? "?"}  retention_until ${e.retentionUntil ?? "?"}  plan ${e.planId}`);
  if (!yes) {
    console.log("[purge-due] dry run: nothing was deleted. Pass --yes to purge the owners above.");
    return;
  }
  let failures = 0;
  for (const e of due) {
    try {
      const result = await purgeOwner(env ? { db, env } : { db }, e.userId, reason);
      const total = Object.values(result.counts).reduce((sum, n) => sum + n, 0);
      console.log(`[purge-due] purged ${e.userId}: ${result.objectsRemoved} object(s), ${env ? `${result.workspacesRemoved} workspace(s)` : "workspaces left (no WORKSPACE_ROOT)"}, ${total} row(s) ${JSON.stringify(result.counts)}, auth user ${result.authUserDeleted ? "deleted" : "already gone"}`);
    } catch (error) {
      if (error instanceof PurgeRefusedError) {
        console.log(`[purge-due] skipped ${e.userId}: ${error.message}`);
        continue;
      }
      failures += 1;
      console.error(`[purge-due] FAILED ${e.userId}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (failures > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
