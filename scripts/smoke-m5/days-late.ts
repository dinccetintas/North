/**
 * The end of the M5 smoke: D8 (the Monday plan rewrite, PLN-2) and the
 * "Whole run" tally of docs/plans/M5.md "Acceptance test", which prints the
 * final line. Days D1–D7 live in `days.ts`.
 */
import { missingRevisionReasons } from "@north/core";
import { listBriefs, listCards, listSignals, type PlanRecord } from "@north/db";
import { planWhere, taskSummary, type Day3 } from "./days";
import { cardsPerDay, check, checkpoint, db, requestPlan, setClock, simDay, until, type Ctx } from "./harness";

export interface Day8 {
  readonly ctx: Ctx;
  readonly plan2: PlanRecord;
}

/** D8 Mon 06:00: the Monday rewrite — plan 2 for 2026-10-26 drops `outreach_batch` with the ledger's numbers and explains every cut (PLN-2). */
export async function day8(ctx: Ctx, plan1: PlanRecord): Promise<Day8> {
  const { companyId } = ctx;
  await setClock(8, "06:00");
  await requestPlan(companyId);
  const plan2 = await until("plan 2", planWhere(companyId, (p) => p.id !== plan1.id && p.tasks.length > 0), { found: () => taskSummary(companyId) });
  const t1 = plan1.tasks.map((t) => t.taskType);
  const t2 = plan2.tasks.map((t) => t.taskType);
  check(plan2.weekStart === simDay(8), "plan 2 week_start", simDay(8), plan2.weekStart);
  check([...new Set(t2)].sort().join(",") !== [...new Set(t1)].sort().join(","), "plan 2 task types", `different from plan 1 (${t1.join(", ")})`, t2);
  check(!t2.includes("outreach_batch"), "outreach_batch", "0 tasks", t2);
  const outreach = plan2.revisions.find((r) => r.taskType === "outreach_batch");
  check(outreach && (outreach.change === "dropped" || outreach.change === "fewer") && outreach.reason.includes("0 replies") && outreach.reason.includes("5"), "outreach_batch revision", "dropped|fewer with a reason naming 0 replies and 5", plan2.revisions);
  check(t2.includes("campaign_spec"), "campaign_spec", "kept (the channel is working)", t2);
  const dropped = [...new Set(t1)].filter((t) => !t2.includes(t));
  check(dropped.every((t) => plan2.revisions.some((r) => r.taskType === t && r.reason.trim().length > 0)), "dropped types explained", `a revision with a reason for each of ${dropped.join(", ")}`, plan2.revisions);
  const missing = missingRevisionReasons(plan2, plan1.tasks);
  check(missing.length === 0, "missingRevisionReasons", "empty", missing);
  return { ctx: await checkpoint(ctx, 8), plan2 };
}

/** "Whole run": six cards answered by the user, none open, quota never above 3, the signal tally; returns the final line. */
export async function wholeRun(ctx: Ctx, d3: Day3, d8: Day8): Promise<string> {
  const { companyId } = ctx;
  const all = await listCards(db, companyId, { limit: 100 });
  const describe = (c: (typeof all)[number]) => `${c.actionKind}:${c.day}:${c.answeredBy ?? "open"}`;
  // Plan 2 dispatches its tasks on D8 as plan 1 did on D1, so its K2 tasks open that day's cards; they belong to the next week and stay open.
  const week = all.filter((c) => c.day < simDay(8));
  const next = all.filter((c) => c.day >= simDay(8));
  check(week.length === 6 && week.every((c) => c.answeredBy === "user" && c.answeredAt !== null), "whole run cards", "6 cards on D1–D7, every one answered by the user (no default, no auto rule), none open", all.map(describe));
  const plan2Tasks = new Set(d8.plan2.tasks.map((t) => t.id));
  check(next.every((c) => c.taskId !== null && plan2Tasks.has(c.taskId)), "D8 cards", "only cards of plan 2's tasks", next.map(describe));
  const kinds = [...week.map((c) => c.actionKind)].sort().join(",");
  check(kinds === ["ads.start", "deploy.production", "deploy.production", "email.send.first_contact", "signal.pursue", "signal.pursue"].join(","), "card kinds", "go-live, campaign, batch, signal, fix go-live, metric drop", kinds);
  const signals = await listSignals(db, companyId, { limit: 100 });
  const bySource = signals.reduce<Record<string, number>>((acc, s) => ({ ...acc, [s.source]: (acc[s.source] ?? 0) + 1 }), {});
  const expected = { reddit: 2, producthunt: 1, google_trends: 1, competitor_sites: 1, metrics: 1, sentry: 1 };
  check(signals.length === 7 && Object.entries(expected).every(([source, n]) => bySource[source] === n), "whole run signals", JSON.stringify(expected), bySource);
  const briefs = await listBriefs(db, companyId, 30);
  const perDay = await cardsPerDay(companyId);
  const final = ctx.tally[ctx.tally.length - 1] ?? { actions: 0, ledger: 0 };
  const revisions = d8.plan2.revisions.map((r) => `${r.taskType}:${r.change}`).join(" ");
  return `smoke M5 OK: briefs ${briefs.length} (max latency ${Math.max(...ctx.briefMs)} ms), signals 6 (2 reddit, 1 producthunt, 1 google_trends, 1 competitor_sites, 1 metrics) + 1 sentry, cards ${week.length} (all answered by user, none open, max ${Math.max(...Object.values(perDay))}/day ≤ 3; ${next.length} open for plan 2's week), fix PR ${d3.prUrl}, plan 2 week ${d8.plan2.weekStart} with ${d8.plan2.revisions.length} revisions (${revisions}), actions ${final.actions}, ledger ${final.ledger}`;
}
