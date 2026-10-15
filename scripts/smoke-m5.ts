/**
 * M5 smoke: seven simulated days without a chat (docs/plans/M5.md "Acceptance
 * test"). The owner lives in Europe/Istanbul with a quota of 3; the harness
 * drives the worker's clock from Monday 2026-10-19 07:00 through the next
 * Monday 06:00: a brief every morning (push + email, < 60 s, ≤ 200 words),
 * signals that become cards only through the gate and only within the quota
 * and the weekly cap, a Sentry error that becomes a fix PR, a preview and one
 * go-live card, a metric drop declined, and the Monday plan rewrite that says
 * why every task type it cut was cut. Every day ends with the append-only
 * checkpoint and `max(cards per day) ≤ 3`.
 *
 * Usage: pnpm smoke:m5   (stack + `pnpm dev`; worker in sandbox mode with the mock runtime; SENTRY_CLIENT_SECRET unset or `sandbox-sentry-secret`)
 */
import { createCompany, createGoal, setKillSwitch, setOnboardingStep, updateProfile, upsertBudgets, upsertPushSubscription } from "@north/db";
import { day1, day2, day3, day4, day5, day6, day7 } from "./smoke-m5/days";
import { day8, wholeRun } from "./smoke-m5/days-late";
import { assert, avoidScanCron, counts, db, QUOTA, resetClock, TIMEZONE, type Ctx } from "./smoke-m5/harness";

const THESIS = "Bookkeeping for solo consultants that closes the month in one click.";

/** The owner (Europe/Istanbul, quota 3, notifications enabled on their phone) and an onboarded company with a $100/day / $300 ads budget (caps are not the subject here). */
async function createOwner(): Promise<Ctx> {
  const user = await db.auth.admin.createUser({ email: `smoke-m5-${Date.now()}@north.test`, password: `pw-${Date.now()}-Aa1!`, email_confirm: true });
  assert(user.data.user, `createUser failed: ${user.error?.message}`);
  const ownerId = user.data.user.id;
  await updateProfile(db, ownerId, { timezone: TIMEZONE, dailyDecisionQuota: QUOTA });
  // The brief's push goes to each of the owner's subscriptions (as decision cards do); the sandbox push adapter answers every endpoint.
  await upsertPushSubscription(db, { userId: ownerId, endpoint: `https://push.example.test/sandbox/${ownerId}`, p256dh: "sandbox-p256dh", auth: "sandbox-auth" });
  const company = await createCompany(db, { ownerId, name: `Seven Days Co ${Date.now().toString(36)}`, thesis: THESIS, targetCustomer: "solo consultants" });
  await createGoal(db, company.id, { metricKey: "signups", targetValue: 50, dueDate: "2026-12-31" });
  await upsertBudgets(db, company.id, [{ category: "ads", totalLimitUsd: 300, dailyLimitUsd: 100 }]);
  await setOnboardingStep(db, company.id, "done");
  return { companyId: company.id, ownerId, companyName: company.name, tally: [await counts(company.id)], briefMs: [] };
}

async function main(): Promise<void> {
  await avoidScanCron();
  const ctx0 = await createOwner();
  try {
    const d1 = await day1(ctx0);
    const c2 = await day2(d1.ctx, d1);
    const d3 = await day3(c2, d1.refs);
    const c4 = await day4(d3.ctx, d3);
    const c5 = await day5(c4, d1.refs);
    const c6 = await day6(c5);
    const c7 = await day7(c6);
    const d8 = await day8(c7, d1.plan1);
    console.log(await wholeRun(d8.ctx, d3, d8));
  } finally {
    // The rows stay (the owner cannot be deleted: the cascade into `actions` is refused by the append-only trigger);
    // the kill switch keeps the crons off this company, and the worker goes back on the wall clock.
    await setKillSwitch(db, ctx0.companyId, true).catch(() => undefined);
    await resetClock();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
