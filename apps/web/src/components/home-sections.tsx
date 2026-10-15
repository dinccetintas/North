import Link from "next/link";
import { PlanRevisions, type PlanRevisionRow } from "@/components/plan-revisions";
import { TaskList, TaskStatusBadge, type TaskRowData } from "@/components/task-list";

/** The morning header: the day and the company name. */
export function MorningHeader({ name }: { name: string }) {
  return (
    <div>
      <p className="mono-label text-faint">
        Morning · {new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" })}
      </p>
      <h1 className="mt-1 text-4xl" data-testid="company-name">
        {name}
      </h1>
    </div>
  );
}

/** M3: the company's website as the action log knows it; hidden until a preview exists. */
export function WebsiteLine({ live, preview }: { live: string | null; preview: string | null }) {
  if (!live && !preview) return null;
  const url = live ?? preview;
  return (
    <section className="mt-10" data-testid="website">
      <h2 className="mono-label text-faint">Website</h2>
      <p className="mt-3 flex flex-wrap items-baseline gap-x-3 border border-surface-border bg-surface p-5">
        <span className={`mono-label ${live ? "text-success" : "text-warning"}`} data-testid="website-status">
          {live ? "live" : "preview"}
        </span>
        <a href={url ?? "#"} target="_blank" rel="noreferrer noopener" className="truncate hover:underline" data-testid="website-link">
          {url}
        </a>
        {live && preview && preview !== live ? (
          <a href={preview} target="_blank" rel="noreferrer noopener" className="mono-label text-faint hover:underline" data-testid="website-preview">
            latest preview ↗
          </a>
        ) : null}
      </p>
    </section>
  );
}

export function OnboardingCard({ slug }: { slug: string }) {
  return (
    <section className="mt-10" data-testid="onboarding-card">
      <h2 className="mono-label text-faint">Before the first plan</h2>
      <div className="mt-3 border border-surface-border bg-surface p-5">
        <p className="text-muted">
          The agents are waiting on your answers, a goal and a budget. Four short steps; the research agent starts the
          moment you approve.
        </p>
        <Link href={`/c/${slug}/onboarding`} className="retro-button retro-button-primary mt-5 inline-block">
          Continue onboarding
        </Link>
      </div>
    </section>
  );
}

export interface WeekPlanData {
  readonly weekStart: string;
  readonly summary: string;
  readonly tasks: readonly TaskRowData[];
  readonly revisions: readonly PlanRevisionRow[];
}

/** PLN-1/PLN-2: this week's plan, its tasks and, from the second plan on, why task types were cut. */
export function WeekPlan({ plan, planningStatus, liveUrl }: { plan: WeekPlanData | null; planningStatus: string | null; liveUrl: string | null }) {
  return (
    <section className="mt-10">
      <div className="flex items-baseline justify-between gap-4">
        <h2 className="mono-label text-faint">This week</h2>
        {plan ? <span className="mono-label text-faint">week of {plan.weekStart}</span> : null}
      </div>
      {plan ? (
        <div className="mt-3" data-testid="week-plan">
          <p className="border border-surface-border bg-surface p-5">{plan.summary}</p>
          <PlanRevisions revisions={plan.revisions} />
          <div className="mt-3">
            <TaskList tasks={plan.tasks} testId="week-tasks" emptyText="The plan has no tasks yet." liveUrl={liveUrl} />
          </div>
        </div>
      ) : (
        <p className="mt-3 border border-surface-border bg-surface p-5 text-muted" data-testid="week-plan">
          {planningStatus ? (
            <>
              <TaskStatusBadge status={planningStatus} /> The Chief of Staff is writing the first weekly plan.
            </>
          ) : (
            "The Chief of Staff writes the first weekly plan once the research is in."
          )}
        </p>
      )}
    </section>
  );
}
