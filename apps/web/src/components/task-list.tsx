import type { TaskStatus } from "@north/core/tasks/lifecycle";
import { formatUsd, roleTitle, TASK_STATUS_CLASS, TASK_STATUS_LABEL } from "@/lib/labels";

export interface TaskRowData {
  readonly id: string;
  readonly status: string;
  readonly role: string;
  readonly title: string;
  readonly costUsd: number;
  readonly lastError?: string | null;
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

export function TaskList({ tasks, testId, emptyText }: { tasks: readonly TaskRowData[]; testId: string; emptyText: string }) {
  if (tasks.length === 0) {
    return (
      <p className="border border-surface-border bg-surface p-5 text-muted" data-testid={testId}>
        {emptyText}
      </p>
    );
  }
  return (
    <ul className="divide-y divide-surface-border border border-surface-border" data-testid={testId}>
      {tasks.map((task) => (
        <li
          key={task.id}
          data-testid="task-row"
          data-status={task.status}
          className="grid grid-cols-[5rem_1fr_auto] items-baseline gap-x-3 gap-y-1 px-4 py-3 sm:grid-cols-[5rem_11rem_1fr_auto]"
        >
          <TaskStatusBadge status={task.status} />
          <span className="mono-label truncate text-muted">{roleTitle(task.role)}</span>
          <span className="col-span-3 sm:col-span-1">{task.title}</span>
          <span className="col-start-3 row-start-1 mono-label text-faint sm:col-start-4">{formatUsd(task.costUsd)}</span>
          {task.status === "failed" && task.lastError ? (
            <span className="col-span-3 mono-label text-error sm:col-span-4">{task.lastError}</span>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
