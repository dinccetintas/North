import { randomUUID } from "node:crypto";
import type { Provider, SandboxEvent, SandboxSink } from "../types";

/** Builds a `sandbox:<kind>:<uuid>` reference so sandbox evidence is never mistaken for a live id. */
export function sandboxRef(kind: string): string {
  return `sandbox:${kind}:${randomUUID()}`;
}

/** Records one sandbox event through the sink (when there is one) and returns it. */
export async function recordSandboxEvent(
  sink: SandboxSink | undefined,
  input: { readonly provider: Provider; readonly op: string; readonly companyId: string | null; readonly ref: string; readonly payload: Record<string, unknown> },
): Promise<SandboxEvent> {
  const event: SandboxEvent = Object.freeze({ ...input, payload: Object.freeze({ ...input.payload }), at: new Date().toISOString() });
  if (sink) await sink(event);
  return event;
}
