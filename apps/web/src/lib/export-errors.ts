import { ExportRefusedError, type ExportRefusal } from "@north/db";
import type { ErrorCode } from "./page-errors";

const REFUSAL_CODES: Readonly<Record<ExportRefusal, ErrorCode<"export">>> = Object.freeze({ in_progress: "in-progress", daily_cap: "daily-cap" });

/**
 * EXP-1 (M6 review M4, L8): the error code for a failed export request. The
 * database's two refusals (one export at a time, `EXPORT_DAILY_CAP` a day)
 * get their own fixed lines; anything else is `request-failed`. The
 * database's message, which may name ids, never reaches the URL.
 */
export function exportRequestError(cause: unknown): ErrorCode<"export"> {
  return cause instanceof ExportRefusedError ? (REFUSAL_CODES[cause.reason] ?? "request-failed") : "request-failed";
}
