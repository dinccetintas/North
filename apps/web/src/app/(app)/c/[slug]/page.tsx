import { notFound } from "next/navigation";
import { getOnboardingStep, latestMetric, latestPlan, listArtifacts, listGoals, listTasks, siteUrls } from "@north/db";
import { dispatchDecision, type DispatchBlockReason } from "@north/core/billing/dispatch";
import type { PausedReason } from "@north/core/companies";
import { BRIEF_HOUR } from "@north/core/time";
import { companyBySlug } from "@/lib/company";
import { createClient, currentUser } from "@/lib/supabase/server";
import { ownerProfile } from "@/lib/account";
import { loadPlanSnapshot } from "@/lib/billing-data";
import { loadLatestBrief, loadRecentSignals } from "@/lib/brief-data";
import { answerRefusal } from "@/lib/kill-switch-guard";
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

interface OwnerContext {
  /** The signed-in owner's id (claims): the key of the offline brief copy. */
  readonly userId: string | null;
  readonly timezone: string;
  readonly briefHour: number;
  /** BIL-1 / BIL-2: what `dispatchDecision` says for this company right now; null when agents may run. */
  readonly blockReason: DispatchBlockReason | null;
}

/** The signed-in owner's zone and brief hour for the brief's empty state and the dispatch refusal for queued tasks; claims only, never a session. */
async function ownerContext(company: { readonly killSwitchActive: boolean; readonly pausedReason?: PausedReason | null }): Promise<OwnerContext> {
  const user = await currentUser();
  if (!user) return { userId: null, timezone: FALLBACK_TIMEZONE, briefHour: BRIEF_HOUR, blockReason: null };
  const [profile, plan] = await Promise.all([ownerProfile(user.id), loadPlanSnapshot(await createClient(), user.id)]);
  const decision = dispatchDecision({ killSwitchActive: company.killSwitchActive, pausedReason: company.pausedReason ?? null, entitlement: plan.entitlement, balance: plan.balance, now: new Date() });
  return { userId: user.id, timezone: profile?.timezone ?? FALLBACK_TIMEZONE, briefHour: profile?.briefHour ?? BRIEF_HOUR, blockReason: decision.ok ? null : decision.reason };
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
        <DecisionsSection slug={slug} companyId={company.id} stopped={company.killSwitchActive} stoppedMessage={answerRefusal(company)} />
      </main>
    );
  }

  const [goals, plan, tasks, artifacts, site, brief, signals, owner] = await Promise.all([
    listGoals(db, company.id),
    latestPlan(db, company.id),
    listTasks(db, company.id, {}),
    listArtifacts(db, company.id),
    siteUrls(db, company.id),
    loadLatestBrief(db, company.id),
    loadRecentSignals(db, company.id),
    ownerContext(company),
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

      <BriefPanel userId={owner.userId} slug={slug} brief={brief} timezone={owner.timezone} briefHour={owner.briefHour} />

      <DecisionsSection slug={slug} companyId={company.id} stopped={company.killSwitchActive} stoppedMessage={answerRefusal(company)} />

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
        blockReason={owner.blockReason}
      />

      <section className="mt-10">
        <h2 className="mono-label text-faint">First 24 hours</h2>
        <div className="mt-3">
          <TaskList tasks={onboardingTasks} testId="onboarding-tasks" emptyText="Queueing the research tasks…" liveUrl={site.live} blockReason={owner.blockReason} />
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
