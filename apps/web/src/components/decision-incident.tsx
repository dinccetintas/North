import { isHttpUrl } from "@north/core/url";
import type { IncidentData } from "@/lib/brief-view";
import { signalStatusLabel } from "@/lib/labels";

/** The sandbox code host answers PR URLs as `sandbox://repos/<owner>/<name>/pull/<n>`; shown as a reference, never opened. */
const SANDBOX_PR_PREFIX = "sandbox://repos/";

const LEVEL_CLASS: Readonly<Record<string, string>> = Object.freeze({ fatal: "text-error", error: "text-error", warning: "text-warning" });

/** A pull request reference: a real link for http(s) only; the sandbox scheme (or anything else) is text with the ref in `data-ref`, never an anchor (M5 review L2). */
function PullRequestRef({ url }: { url: string | null }) {
  if (!url) return <span className="text-muted">No pull request yet.</span>;
  const ref: string = url;
  if (isHttpUrl(ref)) {
    return (
      <a href={ref} target="_blank" rel="noreferrer noopener" className="break-all hover:underline" data-testid="decision-pr">
        {ref} ↗
      </a>
    );
  }
  const sandbox = url.startsWith(SANDBOX_PR_PREFIX);
  return (
    <span className="break-all" data-testid="decision-pr" data-sandbox={sandbox ? "true" : "false"} data-ref={url}>
      {url}
      {sandbox ? " (sandbox)" : ""}
    </span>
  );
}

/**
 * PRO-2: the Sentry issue a fix card is about. The title and culprit are the
 * sanitised data the webhook stored (text, never HTML); the pull request is
 * the engineering agent's, open in the user's repository for them to merge.
 */
export function DecisionIncident({ incident, pullRequestUrl }: { incident: IncidentData; pullRequestUrl: string | null }) {
  const cells: readonly (readonly [string, string])[] = [
    ["Issue", incident.shortId ?? "—"],
    ["Level", incident.level ?? "error"],
    ["Signal", signalStatusLabel(incident.status)],
  ];
  return (
    <section className="mt-10">
      <h2 className="mono-label text-faint">Incident</h2>
      <div className="mt-3 border border-surface-border bg-surface p-5" data-testid="decision-incident" data-signal-id={incident.signalId} data-level={incident.level ?? ""}>
        <p className="font-display text-xl leading-tight" data-testid="incident-title">
          {incident.title}
        </p>
        {incident.culprit ? (
          <p className="mono-label mt-2 text-muted" data-testid="incident-culprit">
            {incident.culprit}
          </p>
        ) : null}
        <dl className="mt-4 grid grid-cols-3 gap-x-4 gap-y-2">
          {cells.map(([label, value]) => (
            <div key={label}>
              <dt className="mono-label text-faint">{label}</dt>
              <dd className={`mt-0.5 ${label === "Level" ? (LEVEL_CLASS[value] ?? "") : ""}`}>{value}</dd>
            </div>
          ))}
        </dl>
        <dl className="mt-4 flex flex-col gap-2">
          <div className="flex flex-wrap items-baseline gap-x-3">
            <dt className="mono-label text-faint">Pull request</dt>
            <dd>
              <PullRequestRef url={pullRequestUrl} />
            </dd>
          </div>
          <div className="flex flex-wrap items-baseline gap-x-3">
            <dt className="mono-label text-faint">Sentry</dt>
            <dd>
              {incident.permalink ? (
                <a href={incident.permalink} target="_blank" rel="noreferrer noopener" className="break-all hover:underline" data-testid="incident-permalink">
                  {incident.permalink} ↗
                </a>
              ) : (
                <span className="text-muted">No issue link.</span>
              )}
            </dd>
          </div>
        </dl>
        <p className="mt-4 text-muted">The fix was pushed on its own branch and previewed; approve deploys it, the pull request stays yours to merge.</p>
      </div>
    </section>
  );
}
