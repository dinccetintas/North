import Link from "next/link";
import { notFound } from "next/navigation";
import { getOnboardingStep, latestMetric, latestPlan, listArtifacts, listGoals, listTasks, siteUrls } from "@north/db";
import { companyBySlug } from "@/lib/company";
import { createClient } from "@/lib/supabase/server";
import { ArtifactsStrip } from "@/components/artifacts-strip";
import { DecisionsSection } from "@/components/decisions-section";
import { GoalProgress } from "@/components/goal-progress";
import { LiveRefresh } from "@/components/live-refresh";
import { TaskList, TaskStatusBadge } from "@/components/task-list";

type Params = Promise<{ slug: string }>;

const PENDING_STATUSES: ReadonlySet<string> = new Set(["queued", "running"]);
/** Chief of Staff tasks that produce the plan itself; shown under "This week", not in the first-24-hours list. */
const PLANNING_TASK_TYPES: ReadonlySet<string> = new Set(["plan_week", "brief"]);

export async function generateMetadata({ params }: { params: Params }) {
  const { slug } = await params;
  return { title: slug };
}

function MorningHeader({ name }: { name: string }) {
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
function WebsiteLine({ live, preview }: { live: string | null; preview: string | null }) {
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

function OnboardingCard({ slug }: { slug: string }) {
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

export default async function CompanyHomePage({ params }: { params: Params }) {
  const { slug } = await params;
  const company = await companyBySlug(slug);
  if (!company) notFound();

  const db = await createClient();
  const step = await getOnboardingStep(db, company.id);

  if (step !== "done") {
    return (
      <main className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6">
        <MorningHeader name={company.name} />
        <OnboardingCard slug={slug} />
        <DecisionsSection slug={slug} companyId={company.id} stopped={company.killSwitchActive} />
      </main>
    );
  }

  const [goals, plan, tasks, artifacts, site] = await Promise.all([
    listGoals(db, company.id),
    latestPlan(db, company.id),
    listTasks(db, company.id, {}),
    listArtifacts(db, company.id),
    siteUrls(db, company.id),
  ]);
  const goal = goals.find((g) => g.status === "active") ?? goals[0] ?? null;
  const metric = goal ? await latestMetric(db, company.id, goal.metricKey) : null;
  const onboardingTasks = tasks.filter((t) => t.planId === null && !PLANNING_TASK_TYPES.has(t.taskType));
  const planningTask = tasks.find((t) => PLANNING_TASK_TYPES.has(t.taskType) && PENDING_STATUSES.has(t.status));
  const weekTasks = plan ? plan.tasks : [];
  // Keep polling while agents work or a decision is open, so an answer's effect shows without a reload.
  const live = tasks.some((t) => PENDING_STATUSES.has(t.status) || t.status === "waiting_decision") || plan === null;

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6">
      <div className="flex items-start justify-between gap-4">
        <MorningHeader name={company.name} />
        <LiveRefresh active={live} />
      </div>

      <section className="mt-10">
        <h2 className="mono-label text-faint">Goal</h2>
        <div className="mt-3">
          {goal ? (
            <GoalProgress
              metricKey={goal.metricKey}
              targetValue={goal.targetValue}
              dueDate={goal.dueDate}
              current={metric?.value ?? null}
              measuredAt={metric?.measuredAt ?? null}
            />
          ) : (
            <p className="border border-surface-border bg-surface p-5 text-muted">No goal set.</p>
          )}
        </div>
      </section>

      <DecisionsSection slug={slug} companyId={company.id} stopped={company.killSwitchActive} />

      <WebsiteLine live={site.live} preview={site.preview} />

      <section className="mt-10">
        <div className="flex items-baseline justify-between gap-4">
          <h2 className="mono-label text-faint">This week</h2>
          {plan ? <span className="mono-label text-faint">week of {plan.weekStart}</span> : null}
        </div>
        {plan ? (
          <div className="mt-3" data-testid="week-plan">
            <p className="border border-surface-border bg-surface p-5">{plan.summary}</p>
            <div className="mt-3">
              <TaskList tasks={weekTasks} testId="week-tasks" emptyText="The plan has no tasks yet." liveUrl={site.live} />
            </div>
          </div>
        ) : (
          <p className="mt-3 border border-surface-border bg-surface p-5 text-muted" data-testid="week-plan">
            {planningTask ? (
              <>
                <TaskStatusBadge status={planningTask.status} /> The Chief of Staff is writing the first weekly plan.
              </>
            ) : (
              "The Chief of Staff writes the first weekly plan once the research is in."
            )}
          </p>
        )}
      </section>

      <section className="mt-10">
        <h2 className="mono-label text-faint">First 24 hours</h2>
        <div className="mt-3">
          <TaskList tasks={onboardingTasks} testId="onboarding-tasks" emptyText="Queueing the research tasks…" liveUrl={site.live} />
        </div>
      </section>

      <section className="mt-10">
        <h2 className="mono-label text-faint">Artifacts</h2>
        <div className="mt-3">
          <ArtifactsStrip slug={slug} artifacts={artifacts} />
        </div>
      </section>
    </main>
  );
}
