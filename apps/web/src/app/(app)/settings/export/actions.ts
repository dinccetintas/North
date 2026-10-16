"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getExport, requestExport, signExportUrl } from "@north/db";
import { EVENT } from "@north/core/events";
import { ExportRequestSchema } from "@north/core/export/types";
import { createClient, currentUser } from "@/lib/supabase/server";
import { inngest } from "@/inngest/client";
import { withError, type ErrorCode } from "@/lib/page-errors";
import { exportRequestError } from "@/lib/export-errors";

/**
 * EXP-1 (ADR 0016): the owner inserts a `requested` export under RLS and the
 * worker builds the zip; the download is a one-hour signed URL created with
 * the owner's own client (the storage policy is keyed on the owner's id), so
 * the web process never streams the file.
 */

/** RET-1 / EXP-1: the signed download link lives one hour. */
const SIGNED_URL_TTL_SEC = 3600;

/** M6 review L8: an error is a code the page maps to its fixed line. */
const exportUrl = (outcome: { requested?: true; error?: ErrorCode<"export"> }): string =>
  outcome.error ? withError("/settings/export", "export", outcome.error) : outcome.requested ? "/settings/export?requested=1" : "/settings/export";

const FormSchema = z.object({
  kind: z.string(),
  companyId: z
    .string()
    .transform((value) => (value === "" || value === "all" ? null : value))
    .pipe(z.uuid().nullable()),
});

export async function requestExportAction(formData: FormData): Promise<void> {
  const user = await currentUser();
  if (!user) redirect("/login");
  const form = FormSchema.safeParse({ kind: String(formData.get("kind") ?? ""), companyId: String(formData.get("companyId") ?? "") });
  const parsed = form.success ? ExportRequestSchema.safeParse({ kind: form.data.kind, companyId: form.data.companyId }) : null;
  if (!parsed?.success) redirect(exportUrl({ error: "choose-kind" }));
  let error: ErrorCode<"export"> | null = null;
  try {
    const record = await requestExport(await createClient(), { userId: user.id, companyId: parsed.data.companyId, kind: parsed.data.kind });
    await inngest.send({ name: EVENT.exportRequested, data: { exportId: record.id, userId: user.id } });
  } catch (cause) {
    error = exportRequestError(cause);
    if (error === "request-failed") console.error("[export] request failed", cause);
  }
  revalidatePath("/settings/export");
  redirect(exportUrl(error ? { error } : { requested: true }));
}

/** Signs a one-hour URL for the owner's own ready export and sends the browser to it; a stranger's id finds nothing. */
export async function exportDownloadAction(exportId: string): Promise<void> {
  const user = await currentUser();
  if (!user) redirect("/login");
  const id = z.uuid().safeParse(exportId);
  if (!id.success) redirect(exportUrl({ error: "unknown-export" }));
  const db = await createClient();
  const record = await getExport(db, id.data);
  const url = record && record.status === "ready" ? await signExportUrl(db, record, SIGNED_URL_TTL_SEC) : null;
  if (!url) redirect(exportUrl({ error: "unavailable" }));
  redirect(url);
}
