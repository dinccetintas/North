/**
 * What the home's artifacts strip shows (M5 error-to-fix): the newest
 * artifacts, with an incident report from the last week pinned in front so
 * a Sentry error the agents fixed stays in view while the weekly plan keeps
 * producing documents. Pure: the page passes the artifacts newest first.
 */

export const ARTIFACT_STRIP_LIMIT = 6;
export const INCIDENT_PIN_DAYS = 7;
/** Pinned incidents never take more than this many of the strip's places. */
const MAX_PINNED = 2;

export interface StripCandidate {
  readonly id: string;
  readonly kind: string;
  readonly createdAt: string;
}

/** The strip's items, pinned incident reports first, then the newest of the rest; never more than `ARTIFACT_STRIP_LIMIT`. */
export function stripArtifacts<T extends StripCandidate>(artifacts: readonly T[], now: Date): readonly T[] {
  const since = now.getTime() - INCIDENT_PIN_DAYS * 24 * 3_600_000;
  const pinned = artifacts.filter((a) => a.kind === "incident_report" && Date.parse(a.createdAt) >= since).slice(0, MAX_PINNED);
  const pinnedIds = new Set(pinned.map((a) => a.id));
  const rest = artifacts.filter((a) => !pinnedIds.has(a.id));
  return Object.freeze([...pinned, ...rest].slice(0, ARTIFACT_STRIP_LIMIT));
}
