import { z } from "zod";
import { DbError, getCompanyById, importLeads, LeadsCsvError, parseLeadsCsv } from "@north/db";
import { createClient, currentUser } from "@/lib/supabase/server";
import { CsvBodyError, readCsvBody } from "../../../leads-import";

const IdSchema = z.string().uuid();

const json = (status: number, body: Record<string, unknown>) => Response.json(body, { status });

/**
 * Leads CSV upload (`name,email,company,why`, ≤ 500 rows, ≤ 256 KB) for the
 * Sales role. The owner's session client writes `upload` rows under RLS (the
 * worker alone may change a lead's status later). Answers `{ imported,
 * skipped }`; a bad file is refused as a whole with the offending line.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!IdSchema.safeParse(id).success) return json(404, { error: "Not found" });
  if (!(await currentUser())) return json(401, { error: "Sign in required" });

  const db = await createClient();
  const company = await getCompanyById(db, id);
  if (!company) return json(404, { error: "Not found" });

  try {
    const rows = parseLeadsCsv(await readCsvBody(request));
    const result = await importLeads(db, company.id, rows, "upload");
    return json(200, { imported: result.imported, skipped: result.skipped });
  } catch (error) {
    if (error instanceof CsvBodyError) return json(error.status, { error: error.message });
    if (error instanceof LeadsCsvError) return json(400, { error: error.message });
    if (error instanceof DbError) return json(400, { error: "The leads could not be saved" });
    throw error;
  }
}
