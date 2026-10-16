/**
 * EXP-1, M6 security review M4: what one export may write. Every entry
 * (artifact, render, data file) counts against `exportBytes`; each table's
 * files against `tableBytes` too. A cut is never silent: the README names it.
 */
const MiB = 1024 * 1024;

export interface ExportBudget {
  /** One table's files (JSON and CSV together). */
  readonly tableBytes: number;
  /** Every entry of one export (artifacts, renders, data), before compression. */
  readonly exportBytes: number;
}

/** 45 MiB of entries always zips under the storage upload limit (`file_size_limit`, 50 MiB in supabase/config.toml). */
export const EXPORT_BUDGET: ExportBudget = Object.freeze({ tableBytes: 16 * MiB, exportBytes: 45 * MiB });

/** One cut the README names: the entry and what happened to it. */
export interface Cut {
  readonly path: string;
  readonly reason: string;
}

/** What is left of the export's budget; shared by the steps of one export. */
export interface Meter {
  remaining(): number;
  spend(bytes: number): void;
}

export function meter(budget: ExportBudget, used = 0): Meter {
  let spent = used;
  return { remaining: () => Math.max(0, budget.exportBytes - spent), spend: (bytes) => void (spent += bytes) };
}

export const formatBytes = (n: number): string => (n % MiB === 0 ? `${n / MiB} MiB` : n >= 1000 ? `${Math.round(n / 1000)} kB` : `${n} bytes`);
export const spentReason = (budget: ExportBudget): string => `left out: the ${formatBytes(budget.exportBytes)} budget of this export is spent`;
