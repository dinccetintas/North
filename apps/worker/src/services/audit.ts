// The agent tool-call audit trail (`audit_tool_calls`): every PreToolUse
// decision is written before the call may go ahead, with its input capped so a
// hostile tool input cannot bloat the log.
import type { ToolAuditEntry } from "@north/agents";
import type { DbClient, Json } from "@north/db";

/** Audit payloads are capped so a hostile tool input cannot bloat the log. */
export const AUDIT_INPUT_MAX_CHARS = 4000;

/** The input as JSON text, cut to `AUDIT_INPUT_MAX_CHARS`; an unserializable input becomes a marker. */
export function capAuditInput(input: unknown): { readonly json: string; readonly truncated: boolean } {
  let json: string;
  try {
    json = JSON.stringify(input ?? {}) ?? "{}";
  } catch {
    json = JSON.stringify({ unserializable: true });
  }
  return json.length > AUDIT_INPUT_MAX_CHARS ? { json: json.slice(0, AUDIT_INPUT_MAX_CHARS), truncated: true } : { json, truncated: false };
}

/** The `audit_tool_calls.input` of one call: the parsed input, or its cut text when it was capped (a cut JSON does not parse). Well inside the 0015 size check. */
export function auditInput(input: unknown): { readonly value: unknown; readonly truncated: boolean } {
  const capped = capAuditInput(input);
  return capped.truncated ? { value: capped.json, truncated: true } : { value: JSON.parse(capped.json) as unknown, truncated: false };
}

/** The runtime's `audit` callback over the worker's client: one row per decision; a failed insert throws, so the hook denies the call. */
export function auditToolCall(db: DbClient): (entry: ToolAuditEntry) => Promise<void> {
  return async (entry) => {
    const { error } = await db.from("audit_tool_calls").insert({
      company_id: entry.companyId,
      task_id: entry.taskId,
      tool_name: entry.toolName,
      // JSON.parse output or a string: valid JSON either way.
      input: auditInput(entry.input) as NonNullable<Json>,
      decision: entry.decision,
    });
    if (error) throw new Error(`audit insert failed: ${error.message}`);
  };
}
