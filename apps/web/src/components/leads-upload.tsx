"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { z } from "zod";

const MAX_FILE_BYTES = 256 * 1024;

/** Fixed texts for the browser; the route's cause stays in the server log (M3 convention). */
const TEXT = Object.freeze({
  noFile: "Choose a CSV file first.",
  tooLarge: "The file is larger than 256 KB.",
  refused: "The import was refused: the header must be name,email,company,why and the file at most 500 rows.",
  unreachable: "Could not reach the server. Try again in a minute.",
});

const ImportResultSchema = z.object({ imported: z.number().int().nonnegative(), skipped: z.number().int().nonnegative() });

/**
 * Leads by CSV (M4 scope: owner upload, ≤ 500 rows, header name,email,company,why).
 * Posts the file to the import route as multipart; the route validates under
 * RLS and answers `{ imported, skipped }`. Nothing is contacted here: an
 * outreach batch still opens one card before any email goes out (SLS-K2).
 */
export function LeadsUpload({ companyId }: { companyId: string }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  const submit = () =>
    startTransition(async () => {
      const file = input.current?.files?.[0] ?? null;
      if (!file) return setResult({ ok: false, text: TEXT.noFile });
      if (file.size > MAX_FILE_BYTES) return setResult({ ok: false, text: TEXT.tooLarge });
      const body = new FormData();
      body.set("file", file);
      let response: Response;
      try {
        response = await fetch(`/api/companies/${encodeURIComponent(companyId)}/leads/import`, { method: "POST", body });
      } catch {
        return setResult({ ok: false, text: TEXT.unreachable });
      }
      const parsed = response.ok ? ImportResultSchema.safeParse(await response.json().catch(() => null)) : null;
      if (!parsed?.success) return setResult({ ok: false, text: TEXT.refused });
      setResult({ ok: true, text: `Imported ${parsed.data.imported}, skipped ${parsed.data.skipped}.` });
      if (input.current) input.current.value = "";
      router.refresh();
    });

  return (
    <div className="flex flex-col gap-3">
      <label htmlFor="leads-file" className="mono-label">
        CSV · name,email,company,why · up to 500 rows
      </label>
      <div className="flex flex-wrap items-center gap-3">
        <input id="leads-file" ref={input} type="file" accept=".csv,text/csv" className="mono-label max-w-full" data-testid="leads-upload" disabled={pending} />
        <button type="button" className="retro-button" disabled={pending} onClick={submit} data-testid="leads-upload-submit">
          {pending ? "…" : "Import leads"}
        </button>
      </div>
      {result ? (
        <p className={`mono-label ${result.ok ? "text-success" : "text-error"}`} role={result.ok ? "status" : "alert"} data-testid="leads-upload-result">
          {result.text}
        </p>
      ) : null}
    </div>
  );
}
