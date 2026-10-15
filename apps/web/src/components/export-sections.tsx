import { EXPORT_KINDS } from "@north/core/export/types";
import { EXPORT_KIND_LABELS, type ExportRow, type RepoLink } from "@/lib/export-view";
import { exportDownloadAction, requestExportAction } from "@/app/(app)/settings/export/actions";
import { SubmitButton } from "@/components/submit-button";

const inputClass = "hairline bg-bg px-3 py-3 outline-none focus:border-deep";

/** EXP-1: what to export (everything, artifacts, data) and for which company. */
export function ExportRequestForm({ companies }: { companies: readonly { readonly id: string; readonly name: string }[] }) {
  return (
    <form action={requestExportAction} className="mt-3 flex flex-col gap-5 border border-surface-border bg-surface p-5" data-testid="export-request">
      <fieldset className="flex flex-col gap-2">
        <legend className="mono-label">What</legend>
        {EXPORT_KINDS.map((kind, i) => (
          <label key={kind} className="flex items-center gap-3">
            <input type="radio" name="kind" value={kind} defaultChecked={i === EXPORT_KINDS.indexOf("full")} data-testid={`export-kind-${kind}`} />
            <span>{EXPORT_KIND_LABELS[kind]}</span>
          </label>
        ))}
      </fieldset>
      <div className="flex flex-col gap-2">
        <label htmlFor="companyId" className="mono-label">
          Company
        </label>
        <select id="companyId" name="companyId" defaultValue="" className={inputClass} data-testid="export-company">
          <option value="">All companies</option>
          {companies.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </div>
      <div>
        <SubmitButton className="retro-button retro-button-primary" testId="export-submit">
          Request export
        </SubmitButton>
        <span className="mono-label ml-3 text-faint">A zip is built in the background; the link lives 7 days.</span>
      </div>
    </form>
  );
}

const STATUS_CLASS: Readonly<Record<ExportRow["status"], string>> = Object.freeze({
  requested: "text-faint",
  running: "text-deep animate-pulse motion-reduce:animate-none",
  ready: "text-success",
  failed: "text-error",
  expired: "text-faint",
});

/** Every export of the owner, newest first; a ready one downloads through a one-hour signed URL. */
export function ExportRows({ rows }: { rows: readonly ExportRow[] }) {
  if (rows.length === 0) return <p className="mt-3 border border-surface-border bg-surface p-5 text-muted">No export yet.</p>;
  return (
    <ul className="mt-3 divide-y divide-surface-border border border-surface-border" data-testid="export-list">
      {rows.map((row) => (
        <li key={row.id} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2 px-4 py-3" data-testid="export-row" data-export-id={row.id} data-status={row.status}>
          <span className="flex flex-wrap items-baseline gap-x-3">
            <span className={`mono-label ${STATUS_CLASS[row.status]}`} data-testid="export-status">
              {row.statusWord}
            </span>
            <span>{row.kindLabel}</span>
            <span className="mono-label text-muted">{row.scope}</span>
            <span className="mono-label text-faint">{row.requested}</span>
          </span>
          <span className="flex flex-wrap items-baseline gap-x-3">
            <span className="mono-label text-faint" data-testid="export-bytes">
              {row.bytes}
            </span>
            {row.expires ? (
              <span className="mono-label text-faint" data-testid="export-expires">
                {row.expires}
              </span>
            ) : null}
            {row.downloadable ? (
              <form action={exportDownloadAction.bind(null, row.id)}>
                <SubmitButton testId="export-download">Download</SubmitButton>
              </form>
            ) : null}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** EXP-1: the code was created in the owner's own GitHub from the first build; a sandbox reference is shown as text. */
export function RepoList({ repos }: { repos: readonly RepoLink[] }) {
  return (
    <div className="mt-3 border border-surface-border bg-surface p-5" data-testid="export-repos">
      <p>Your code is already in your GitHub.</p>
      <ul className="mt-3 flex flex-col gap-1">
        {repos.map((repo) => (
          <li key={repo.companyId} className="flex flex-wrap items-baseline gap-x-3" data-testid="export-repo" data-company-id={repo.companyId}>
            <span className="mono-label text-faint">{repo.name}</span>
            {repo.href ? (
              <a href={repo.href} target="_blank" rel="noreferrer noopener" className="text-link underline">
                {repo.ref}
              </a>
            ) : (
              <span className={repo.ref ? "" : "text-muted"}>{repo.ref ?? "no repository yet (created at the first build)"}</span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
