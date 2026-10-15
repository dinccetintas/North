import type { ExportKind, ExportStatus } from "@north/core/export/types";
import type { Entitlement } from "@north/core/billing/entitlements";

/**
 * EXP-1 / RET-1 view models for `/settings/export`. Pure: the worker builds
 * the zip, the web lists the rows and signs a one-hour URL on click.
 */

export const EXPORT_KIND_LABELS: Readonly<Record<ExportKind, string>> = Object.freeze({
  full: "Everything",
  artifacts: "Artifacts (MD, PDF, PPTX)",
  data: "Data (JSON and CSV)",
});

export const EXPORT_STATUS_WORDS: Readonly<Record<ExportStatus, string>> = Object.freeze({
  requested: "queued",
  running: "building",
  ready: "ready",
  failed: "failed",
  expired: "expired",
});

const UNITS = ["KB", "MB", "GB", "TB"] as const;

/** Binary steps, one decimal above a kilobyte; "—" before the worker has measured the zip. */
export function formatBytes(bytes: number | null): string {
  if (bytes === null || !Number.isFinite(bytes) || bytes < 0) return "—";
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(1)} ${UNITS[unit]}`;
}

const HOUR_MS = 3_600_000;

export function expiresLabel(expiresAt: string | null, now: Date): string {
  if (!expiresAt) return "";
  const ms = Date.parse(expiresAt) - now.getTime();
  if (!Number.isFinite(ms) || ms <= 0) return "expired";
  const hours = Math.floor(ms / HOUR_MS);
  if (hours < 1) return "expires within the hour";
  if (hours < 48) return `expires in ${hours} h`;
  return `expires in ${Math.round(hours / 24)} d`;
}

export interface ExportLike {
  readonly id: string;
  readonly kind: ExportKind;
  readonly companyId: string | null;
  readonly status: ExportStatus;
  readonly bytes: number | null;
  readonly expiresAt: string | null;
  readonly createdAt: string;
}

export interface ExportRow {
  readonly id: string;
  /** The row's status, `expired` once the zip's time passed even before the sweep says so. */
  readonly status: ExportStatus;
  readonly statusWord: string;
  readonly kindLabel: string;
  readonly scope: string;
  readonly bytes: string;
  readonly expires: string;
  readonly requested: string;
  readonly downloadable: boolean;
}

const isPast = (iso: string | null, now: Date): boolean => iso !== null && Date.parse(iso) <= now.getTime();

export function exportRows(records: readonly ExportLike[], companyNames: ReadonlyMap<string, string>, now: Date): readonly ExportRow[] {
  return Object.freeze(
    records.map((r) => {
      const status: ExportStatus = r.status === "ready" && isPast(r.expiresAt, now) ? "expired" : r.status;
      return Object.freeze({
        id: r.id,
        status,
        statusWord: EXPORT_STATUS_WORDS[status],
        kindLabel: EXPORT_KIND_LABELS[r.kind],
        scope: r.companyId === null ? "All companies" : (companyNames.get(r.companyId) ?? "A company"),
        bytes: formatBytes(r.bytes),
        expires: status === "ready" ? expiresLabel(r.expiresAt, now) : "",
        requested: r.createdAt.slice(0, 10),
        downloadable: status === "ready",
      });
    }),
  );
}

/** RET-1: exports work while `ended` until `retention_until`; after it the data is archived and waits for the purge. */
export function exportAccess(e: Pick<Entitlement, "status" | "retentionUntil" | "purgeDue"> | null, now: Date): "open" | "archived" {
  if (e === null || e.status !== "ended") return "open";
  return e.purgeDue || isPast(e.retentionUntil, now) ? "archived" : "open";
}

export interface RepoRef {
  readonly companyId: string;
  readonly name: string;
  /** The latest `repo.create` reference that reached the provider, as the worker recorded it. */
  readonly ref: string | null;
}

/** `repo.create` is K1: the worker records it `notified`; an auto-approved or older row may read `executed`. */
const REACHED_PROVIDER: ReadonlySet<string> = new Set(["notified", "executed"]);

/** The newest `repo.create` reference among rows listed newest first, or null before the first build. */
export function latestRepoRef(actions: readonly { readonly status: string; readonly externalRef: string | null }[]): string | null {
  return actions.find((a) => REACHED_PROVIDER.has(a.status) && a.externalRef !== null)?.externalRef ?? null;
}

export interface RepoLink extends RepoRef {
  /** Only an https reference becomes a link; a sandbox reference stays text. */
  readonly href: string | null;
}

const httpsOnly = (ref: string | null): string | null => {
  if (!ref) return null;
  try {
    return new URL(ref).protocol === "https:" ? ref : null;
  } catch {
    return null;
  }
};

export function repoLinks(refs: readonly RepoRef[]): readonly RepoLink[] {
  return Object.freeze(refs.map((r) => Object.freeze({ companyId: r.companyId, name: r.name, ref: r.ref, href: httpsOnly(r.ref) })));
}
