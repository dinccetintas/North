import { ActionSpecSchema, type ActionKind, type ActionSpec } from "@north/core";
import { markLeads, type DbClient } from "@north/db";
import type { WorkerDeps } from "../deps";
import { resolveCampaigns } from "./campaign-lookup";
import { markCampaignActive, markCampaignPaused, registerCampaignFor, type PauseReason } from "./campaign-rows";

/** The pending row an action was recorded as, with its stored spec: what `performPending` runs and `completeAction` settles. */
export interface PendingRow {
  readonly id: string;
  readonly companyId: string;
  readonly taskId: string | null;
  readonly kind: ActionKind;
  readonly status: string;
  /** The card that approved the row, when one did (a K1 or auto-rule row has none). */
  readonly decisionCardId: string | null;
  readonly spec: ActionSpec | null;
}

/** Loads an action row by id (any status); `spec` is null when the stored spec does not validate. */
export async function loadActionRow(db: DbClient, actionId: string): Promise<PendingRow | null> {
  const { data, error } = await db.from("actions").select("id, company_id, task_id, kind, payload, status, decision_card_id").eq("id", actionId).single();
  if (error || !data) return null;
  const spec = ActionSpecSchema.safeParse((data.payload as { spec?: unknown } | null)?.spec);
  return Object.freeze({ id: data.id, companyId: data.company_id, taskId: data.task_id, kind: data.kind as ActionKind, status: data.status, decisionCardId: data.decision_card_id ?? null, spec: spec.success ? spec.data : null });
}

export interface ExecutedOutcome {
  readonly externalRef: string;
  readonly sandbox: boolean;
  readonly meta?: Readonly<Record<string, string>>;
}

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
      // The same company-scoped resolution the perform step used (H1): provider ids map back to the company's rows.
      for (const campaign of await resolveCampaigns(deps, row.companyId, payload)) await markCampaignPaused(deps, campaign.id, reason, day);
      return;
    }
    case "ads.resume":
      for (const campaign of await resolveCampaigns(deps, row.companyId, payload)) await markCampaignActive(deps, campaign.id);
      return;
    case "email.send.first_contact": {
      const leadId = typeof payload.leadId === "string" ? payload.leadId : null;
      const batchId = typeof payload.batchId === "string" ? payload.batchId : undefined;
      if (leadId && UUID.test(leadId)) await markLeads(deps.db, row.companyId, [leadId], "contacted", { messageId: outcome.externalRef, ...(batchId ? { batchId } : {}) });
      return;
    }
    default:
      return;
  }
}
