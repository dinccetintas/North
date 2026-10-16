import { EVENT, ExportRequestedSchema } from "@north/core";
import { inngest } from "./client";
import { buildDeps } from "../deps";
import { buildExport, failExport } from "../services/export/bundle";
import type { StepRunner } from "../services/steps";

/**
 * EXP-1 / MEM-2 (ADR 0016): `export/requested { exportId, userId }` → the
 * zip in the private `exports` bucket and a `ready` row. One export per user
 * at a time, one retry, and no `cancelOn`: the kill switch stops agents, not
 * the owner's way out (an `ended` owner exports until `retention_until`).
 * After the last retry the owner's row becomes `failed` with a fixed message.
 */
export const buildExportFn = inngest.createFunction(
  {
    id: "build-export",
    triggers: [{ event: EVENT.exportRequested }],
    retries: 1,
    concurrency: [{ key: "event.data.userId", limit: 1 }],
    onFailure: async ({ event, step }) => {
      const parsed = ExportRequestedSchema.safeParse(event.data.event.data);
      if (!parsed.success) return { failed: false };
      const deps = await buildDeps();
      return step.run("mark-failed", () => failExport(deps, parsed.data.exportId, parsed.data.userId));
    },
  },
  async ({ event, step }) => {
    const { exportId, userId } = ExportRequestedSchema.parse(event.data);
    const deps = await buildDeps();
    // Inngest types step results as Jsonify<T>; the export's results are plain JSON, so the narrowing is sound.
    const runner: StepRunner = { run: (id, fn) => step.run(id, fn) as unknown as ReturnType<typeof fn> };
    return buildExport(deps, runner, exportId, userId);
  },
);
