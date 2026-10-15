import { z } from "zod";
import { getCompanyById, ledgerEntriesForReport } from "@north/db";
import { createClient, currentUser } from "@/lib/supabase/server";
import { LEDGER_EXPORT_DAYS, ledgerCsvResponse } from "../../ledger-csv";

const IdSchema = z.string().uuid();

const plain = (status: number, text: string) => new Response(text, { status, headers: { "Content-Type": "text/plain" } });

/**
 * OUT-1: the company's outcome ledger as a CSV download. Ownership is
 * enforced by RLS: the session client only sees the companies (and entries)
 * the signed-in user owns, so a stranger gets 404, not someone else's ledger.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!IdSchema.safeParse(id).success) return plain(404, "Not found");
  if (!(await currentUser())) return plain(401, "Sign in required");

  const db = await createClient();
  const company = await getCompanyById(db, id);
  if (!company) return plain(404, "Not found");
  const entries = await ledgerEntriesForReport(db, company.id, LEDGER_EXPORT_DAYS);
  return ledgerCsvResponse(entries, company.slug);
}
