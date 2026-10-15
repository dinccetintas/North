import { ActionSpecSchema, type ActionSpec } from "@north/core";
import type { ActionRecord, DbClient } from "@north/db";

const parseSpec = (payload: unknown): ActionSpec | null => {
  const parsed = ActionSpecSchema.safeParse((payload as { spec?: unknown } | null)?.spec);
  return parsed.success ? parsed.data : null;
};

/** How far back a chain is followed for its spec: pending → answered/executed is one hop; a retried deferral adds one more. */
const MAX_HOPS = 3;

/**
 * The stored spec behind each chain head. The original row carries it; a
 * transition row (executed, declined, failed, retried) carries only
 * `supersedes` and a note, so the chain is followed back until a spec is
 * found. Heads whose chain has no spec are absent from the map.
 */
export async function specsByHead(db: DbClient, heads: readonly ActionRecord[]): Promise<ReadonlyMap<string, ActionSpec>> {
  const out = new Map<string, ActionSpec>();
  let pending = new Map<string, string>();
  for (const head of heads) {
    const own = parseSpec(head.payload);
    if (own) out.set(head.id, own);
    else if (head.supersedes) pending.set(head.supersedes, head.id);
  }
  for (let hop = 0; hop < MAX_HOPS && pending.size > 0; hop += 1) {
    const { data, error } = await db.from("actions").select("id, payload, supersedes").in("id", [...pending.keys()]);
    if (error) throw new Error(`could not load action chain: ${error.message}`);
    const next = new Map<string, string>();
    for (const row of data ?? []) {
      const headId = pending.get(row.id);
      if (!headId) continue;
      const spec = parseSpec(row.payload);
      if (spec) out.set(headId, spec);
      else if (row.supersedes) next.set(row.supersedes, headId);
    }
    pending = next;
  }
  return out;
}
