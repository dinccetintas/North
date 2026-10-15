import Link from "next/link";
import type { TaskStatus } from "@north/core/tasks/lifecycle";
import type { DispatchBlockReason } from "@north/core/billing/dispatch";
import { isHttpUrl } from "@north/core/url";
import { queuedBlockReason } from "@/lib/billing-view";
import { dispatchBlockLabel, formatUsd, roleTitle, TASK_STATUS_CLASS, TASK_STATUS_LABEL } from "@/lib/labels";

export interface TaskRowData {
  readonly id: string;
  readonly status: string;
  readonly role: string;
  /** The task's type (`build_site`, `fix_error`, `signal_research`, …), exposed as `data-task-type`. */
  readonly taskType: string;
  readonly title: string;
  readonly costUsd: number;
  readonly lastError?: string | null;
  /** What a done task can show (AGT-2); a URL becomes a "preview" / "live" link on the row. */
  readonly evidence?: { readonly kind: string; readonly ref: string } | null;
}

function EvidenceLink({ evidence, liveUrl }: { evidence: TaskRowData["evidence"]; liveUrl: string | null }) {
  if (!evidence || evidence.kind !== "url" || !isHttpUrl(evidence.ref)) return null;
  const label = evidence.ref === liveUrl ? "live" : "preview";
  return (
    <a href={evidence.ref} target="_blank" rel="noreferrer noopener" className="mono-label text-deep hover:underline" data-testid="task-evidence" data-evidence={label}>
      {label} ↗
    </a>
  );
}

const isKnownStatus = (status: string): status is TaskStatus => status in TASK_STATUS_CLASS;

/** Status badge: queued faint, running deep with pulse, waiting warning, done success, failed error. */
export function TaskStatusBadge({ status }: { status: string }) {
  const className = isKnownStatus(status) ? TASK_STATUS_CLASS[status] : "text-faint";
  const label = isKnownStatus(status) ? TASK_STATUS_LABEL[status] : status;
  return (
    <span className={`mono-label ${className}`} data-testid="task-status" data-status={status}>
      {label}
    </span>
  );
}

/** BIL-1 / BIL-2: why a queued task is not running although nobody pressed the kill switch, with the way out. */
function TaskBlocked({ reason }: { reason: DispatchBlockReason }) {
  return (
    <span className="col-span-3 mono-label text-warning sm:col-span-4" data-testid="task-blocked" data-reason={reason}>
      {dispatchBlockLabel(reason)}
      {reason === "credits_exhausted" || reason === "subscription_ended" ? (
        <>
          {" · "}
          <Link href="/settings/billing" className="underline">
            {reason === "credits_exhausted" ? "add credits" : "subscribe"}
          </Link>
        </>
      ) : null}
    </span>
  );
}

export interface TaskListProps {
  readonly tasks: readonly TaskRowData[];
  readonly testId: string;
  readonly emptyText: string;
  /** The company's live site URL; a done task whose evidence is this URL links as "live", any other URL as "preview". */
  readonly liveUrl?: string | null;
  /** The company's dispatch refusal right now (core `dispatchDecision`); shown on queued rows. */
  readonly blockReason?: DispatchBlockReason | null;
}

export function TaskList({ tasks, testId, emptyText, liveUrl = null, blockReason = null }: TaskListProps) {
  if (tasks.length === 0) {
    return (
      <p className="border border-surface-border bg-surface p-5 text-muted" data-testid={testId}>
        {emptyText}
      </p>
    );
  }
  return (
    <ul className="divide-y divide-surface-border border border-surface-border" data-testid={testId}>
      {tasks.map((task) => {
        const blocked = queuedBlockReason(task.status, blockReason);
        return (
          <li
            key={task.id}
            data-testid="task-row"
            data-task-id={task.id}
            data-task-type={task.taskType}
            data-status={task.status}
            className="grid grid-cols-[5rem_1fr_auto] items-baseline gap-x-3 gap-y-1 px-4 py-3 sm:grid-cols-[5rem_11rem_1fr_auto]"
          >
            <TaskStatusBadge status={task.status} />
            <span className="mono-label truncate text-muted">{roleTitle(task.role)}</span>
            <span className="col-span-3 sm:col-span-1">
              {task.title}
              {task.status === "done" && task.evidence ? (
                <>
                  {" "}
                  <EvidenceLink evidence={task.evidence} liveUrl={liveUrl} />
                </>
              ) : null}
            </span>
            <span className="col-start-3 row-start-1 mono-label text-faint sm:col-start-4">{formatUsd(task.costUsd)}</span>
            {task.status === "failed" && task.lastError ? (
              <span className="col-span-3 mono-label text-error sm:col-span-4">{task.lastError}</span>
            ) : null}
            {blocked ? <TaskBlocked reason={blocked} /> : null}
          </li>
        );
      })}
    </ul>
  );
}
