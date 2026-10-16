import { dbError } from "./errors";

/**
 * PostgREST returns at most `max_rows` (1000 in `supabase/config.toml`, the
 * hosted default) per request and says nothing when it cuts. A read that
 * must be complete (the purge, the export) pages with `.range()` instead.
 */
export const PAGE_ROWS = 1000;

interface PageResult<T> {
  readonly data: readonly T[] | null;
  readonly error: unknown;
}

/**
 * Every row of a read, `size` rows per request. The query must be ordered by
 * a unique key. It stops on an empty page (not a short one), so a server cap
 * below `size` still reads everything.
 */
export async function readAllPages<T>(page: (from: number, to: number) => PromiseLike<PageResult<T>>, what: string, size: number = PAGE_ROWS): Promise<readonly T[]> {
  const rows: T[] = [];
  for (;;) {
    const { data, error } = await page(rows.length, rows.length + size - 1);
    if (error) throw dbError(what, error);
    if (!data || data.length === 0) return Object.freeze(rows);
    rows.push(...data);
  }
}
