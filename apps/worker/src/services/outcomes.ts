import { ActionSpecSchema, type ActionKind, type ActionSpec } from "@north/core";
import { markLeads, type DbClient } from "@north/db";
import type { WorkerDeps } from "../deps";
import { markCampaignActive, markCampaignPaused, registerCampaignFor, type PauseReason } from "./campaign-rows";

/** The pending row an action was recorded as, with its stored spec: what `performPending` runs and `completeAction` settles. */
export interface PendingRow {
  readonly id: string;
  readonly companyId: string;
  readonly taskId: string | null;
  readonly kind: ActionKind;
  readonly status: string;
  readonly spec: ActionSpec | null;
}

/** Loads an action row by id (any status); `spec` is null when the stored spec does not validate. */
export async function loadActionRow(db: DbClient, actionId: string): Promise<PendingRow | null> {
  const { data, error } = await db.from("actions").select("id, company_id, task_id, kind, payload, status").eq("id", actionId).single();
  if (error || !data) return null;
  const spec = ActionSpecSchema.safeParse((data.payload as { spec?: unknown } | null)?.spec);
  return Object.freeze({ id: data.id, companyId: data.company_id, taskId: data.task_id, kind: data.kind as ActionKind, status: data.status, spec: spec.success ? spec.data : null });
}

export interface ExecutedOutcome {
  readonly externalRef: string;
  readonly sandbox: boolean;
  readonly meta?: Readonly<Record<string, string>>;
}

const campaignIdsOf = (payload: Record<string, unknown>): readonly string[] =>
  Array.isArray(payload.campaignIds) ? payload.campaignIds.filter((id): id is string => typeof id === "string") : typeof payload.campaignId === "string" ? [payload.campaignId] : [];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * What an executed action leaves behind besides its audit row: the campaign
 * row for a start, the status for a pause or resume, the lead's status for a
 * first contact. Runs inside the same durable step as the `executed`
 * transition; every write here is idempotent, so a retried step is harmless.
 */
export async function applyOutcome(deps: WorkerDeps, row: PendingRow, outcome: ExecutedOutcome): Promise<void> {
  const spec = row.spec;
  if (!spec) return;
  const payload = (spec.payload ?? {}) as Record<string, unknown>;
  switch (row.kind) {
    case "ads.start":
      await registerCampaignFor(deps, { companyId: row.companyId, taskId: row.taskId, actionId: row.id, spec, providerCampaignId: outcome.externalRef, landingUrl: outcome.meta?.landingUrl ?? "", sandbox: outcome.sandbox });
      return;
    case "ads.pause": {
      const reason: PauseReason = payload.reason === "cap" ? "cap" : payload.reason === "kill_switch" ? "kill_switch" : "user";
      const day = typeof payload.day === "string" ? payload.day : undefined;
      for (const id of campaignIdsOf(payload).filter((c) => UUID.test(c))) await markCampaignPaused(deps, id, reason, day);
      return;
    }
    case "ads.resume":
      for (const id of campaignIdsOf(payload).filter((c) => UUID.test(c))) await markCampaignActive(deps, id);
      return;
    case "email.send.first_contact": {
      const leadId = typeof payload.leadId === "string" ? payload.leadId : null;
      const batchId = typeof payload.batchId === "string" ? payload.batchId : undefined;
      if (leadId && UUID.test(leadId)) await markLeads(deps.db, [leadId], "contacted", { messageId: outcome.externalRef, ...(batchId ? { batchId } : {}) });
      return;
    }
    default:
      return;
  }
}
