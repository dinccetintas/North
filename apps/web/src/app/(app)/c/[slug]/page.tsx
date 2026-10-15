import { notFound } from "next/navigation";
import { getOnboardingStep, getProfile, latestMetric, latestPlan, listArtifacts, listGoals, listTasks, siteUrls } from "@north/db";
import { companyBySlug } from "@/lib/company";
import { createClient, currentUser } from "@/lib/supabase/server";
import { loadLatestBrief, loadRecentSignals } from "@/lib/brief-data";
import { ArtifactsStrip } from "@/components/artifacts-strip";
import { BriefPanel } from "@/components/brief-panel";
import { DecisionsSection } from "@/components/decisions-section";
import { GoalProgress } from "@/components/goal-progress";
import { MorningHeader, OnboardingCard, WebsiteLine, WeekPlan } from "@/components/home-sections";
import { LiveRefresh } from "@/components/live-refresh";
import { SignalsList } from "@/components/signals-list";
import { TaskList } from "@/components/task-list";

type Params = Promise<{ slug: string }>;

const PENDING_STATUSES: ReadonlySet<string> = new Set(["queued", "running"]);
/** Chief of Staff tasks that produce the plan itself; shown under "This week", not in the first-24-hours list. */
const PLANNING_TASK_TYPES: ReadonlySet<string> = new Set(["plan_week", "brief"]);
/** An unknown profile reads on UTC, as the database trigger falls back (ADR 0011). */
const FALLBACK_TIMEZONE = "UTC";

export async function generateMetadata({ params }: { params: Params }) {
  const { slug } = await params;
  return { title: slug };
}

/** The signed-in owner's zone for the brief's empty state; the server client never trusts a session, only claims. */
async function ownerTimezone(): Promise<string> {
  const user = await currentUser();
  if (!user) return FALLBACK_TIMEZONE;
  const profile = await getProfile(await createClient(), user.id);
  return profile?.timezone ?? FALLBACK_TIMEZONE;
}

/**
 * The morning screen (SPEC "home"): the brief, at most three cards, the goal,
 * then the website, this week's plan with its revisions, the first-24-hours
 * tasks and the artifacts. Nothing here is a chat.
 */
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

  const [goals, plan, tasks, artifacts, site, brief, signals, timezone] = await Promise.all([
    listGoals(db, company.id),
    latestPlan(db, company.id),
    listTasks(db, company.id, {}),
    listArtifacts(db, company.id),
    siteUrls(db, company.id),
    loadLatestBrief(db, company.id),
    loadRecentSignals(db, company.id),
    ownerTimezone(),
  ]);
  const goal = goals.find((g) => g.status === "active") ?? goals[0] ?? null;
  const metric = goal ? await latestMetric(db, company.id, goal.metricKey) : null;
  const onboardingTasks = tasks.filter((t) => t.planId === null && !PLANNING_TASK_TYPES.has(t.taskType));
  const planningTask = tasks.find((t) => PLANNING_TASK_TYPES.has(t.taskType) && PENDING_STATUSES.has(t.status));
  // Keep polling while agents work or a decision is open, so an answer's effect shows without a reload.
  const live = tasks.some((t) => PENDING_STATUSES.has(t.status) || t.status === "waiting_decision") || plan === null;

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6">
      <div className="flex items-start justify-between gap-4">
        <MorningHeader name={company.name} />
        <LiveRefresh active={live} />
      </div>

      <BriefPanel slug={slug} brief={brief} timezone={timezone} />

      <DecisionsSection slug={slug} companyId={company.id} stopped={company.killSwitchActive} />

      <SignalsList slug={slug} signals={signals} />

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

      <WebsiteLine live={site.live} preview={site.preview} />

      <WeekPlan
        plan={plan ? { weekStart: plan.weekStart, summary: plan.summary, tasks: plan.tasks, revisions: plan.revisions } : null}
        planningStatus={planningTask?.status ?? null}
        liveUrl={site.live}
      />

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
