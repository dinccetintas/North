/** ADR 0016 / STG-1: the smoke cleanup helper (`purge-smoke-user.ts`): the entitlement it writes passes the worker's own purge condition, and a failed cleanup is a warning, never an exception; no stack. */
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DbClient } from "@north/db";
import { purgeAllowed } from "../../apps/worker/src/services/purge";
import { purgeReadyPatch, purgeSmokeUser, purgeTestUser, RETENTION_PAST_MS } from "./purge-smoke-user";

const USER = "00000000-0000-4000-8000-0000000000aa";
const NOW = new Date("2026-10-17T12:00:00.000Z");

interface Call {
  readonly table: string;
  readonly patch: unknown;
  readonly column: string;
  readonly value: string;
}

/** A service client whose only answer is the entitlement update's: `error` or none. Every other call fails the test. */
function fakeDb(updateError: { message: string } | null): { readonly db: DbClient; readonly calls: Call[] } {
  const calls: Call[] = [];
  const db = {
    from: (table: string) => ({
      update: (patch: unknown) => ({
        eq: async (column: string, value: string) => {
          calls.push({ table, patch, column, value });
          return { error: updateError };
        },
      }),
    }),
  } as unknown as DbClient;
  return { db, calls };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("STG-1 / ADR 0016 purgeReadyPatch", () => {
  it("STG-1 ends the entitlement with retention_until behind the clock by more than the worker's margin, so purge_owner accepts it", () => {
    const patch = purgeReadyPatch(NOW);
    expect(patch.status).toBe("ended");
    expect(Date.parse(patch.retention_until)).toBe(NOW.getTime() - RETENTION_PAST_MS);
    expect(Date.parse(patch.ended_at)).toBeLessThanOrEqual(Date.parse(patch.retention_until));
    expect(purgeAllowed({ status: patch.status, retentionUntil: patch.retention_until }, NOW)).toBe(true);
    expect(Object.isFrozen(patch)).toBe(true);
  });
});

describe("STG-1 / ADR 0016 purgeTestUser", () => {
  it("STG-1 writes the patch to the user's entitlement first and stops with a message naming the user when the database refuses", async () => {
    const { db, calls } = fakeDb({ message: "permission denied for table entitlements" });
    await expect(purgeTestUser(db, USER, "e2e", { now: () => NOW })).rejects.toThrow(new RegExp(`${USER}.*permission denied`));
    expect(calls).toEqual([{ table: "entitlements", patch: purgeReadyPatch(NOW), column: "user_id", value: USER }]);
  });
});

describe("STG-1 / ADR 0016 purgeSmokeUser", () => {
  it("STG-1 never throws: a failed purge is a readable warning naming the user and the cause, and the result is false", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { db } = fakeDb({ message: "permission denied for table entitlements" });
    await expect(purgeSmokeUser(db, USER)).resolves.toBe(false);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toMatch(new RegExp(`could not purge the smoke user ${USER}.*permission denied.*stay`));
  });

  it("STG-1 refuses a reason that is not a purge_owner label before touching the database", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { db, calls } = fakeDb(null);
    await expect(purgeSmokeUser(db, USER, "Not A Label")).resolves.toBe(false);
    expect(calls).toHaveLength(0);
    expect(String(warn.mock.calls[0]?.[0])).toMatch(/lowercase label/);
  });
});
