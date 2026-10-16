import { cron } from "inngest";
import { BillingEventPayloadSchema, BillingSessionRequestedSchema, EVENT } from "@north/core";
import { inngest } from "./client";
import { buildDeps } from "../deps";
import { applyBillingEvent, createBillingSession } from "../services/billing";
import { endExpiredTrials, type CompanyEvent } from "../services/entitlements";
import type { StepRunner } from "../services/steps";
import { notifyUsageAlert, usageTick } from "../services/usage";

/**
 * BIL-1 / BIL-2 (ADR 0014): the worker's billing functions. Sessions are
 * created on `billing/session_requested`; stored webhook events are applied
 * on `billing/event`, one at a time per user, and the kill-switch or resume
 * events they produce are sent from here; the hourly ticks share their
 * bodies with `billing/tick` and `usage/tick` so the harness can run "this
 * hour" on demand. None of these is cancelled by the kill switch: ending a
 * subscription must not cancel itself.
 */

const APP_URL = () => process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3100";
const SESSION_RETRIES = 2;

type Step = { run: <T>(id: string, fn: () => Promise<T>) => Promise<unknown> };
/** Inngest types step results as Jsonify<T>; the services' results are plain JSON, so the narrowing is sound. */
const runnerOf = (step: Step): StepRunner => ({ run: (id, fn) => step.run(id, fn) as unknown as ReturnType<typeof fn> });
const outgoing = (events: readonly CompanyEvent[]) => events.map((e) => ({ name: e.name, data: { companyId: e.data.companyId } }));

/** billing/session_requested → load → customer → session; one run per session; a provider refusal or the last failed attempt marks the row `failed`. */
export const createBillingSessionFn = inngest.createFunction(
  { id: "create-billing-session", triggers: [{ event: EVENT.billingSessionRequested }], retries: SESSION_RETRIES, concurrency: [{ key: "event.data.sessionId", limit: 1 }] },
  async ({ event, step, attempt }) => {
    const { sessionId, userId } = BillingSessionRequestedSchema.parse(event.data);
    const deps = await buildDeps();
    return createBillingSession(deps, runnerOf(step), sessionId, { appUrl: APP_URL(), finalAttempt: attempt >= SESSION_RETRIES, expectedUserId: userId });
  },
);

/** billing/event → project → credits → effects, one at a time per user (Stripe's events for one customer stay in order); sends the kill-switch or resume events. */
export const applyBillingEventFn = inngest.createFunction(
  { id: "apply-billing-event", triggers: [{ event: EVENT.billingEvent }], retries: 3, concurrency: [{ key: "event.data.userId", limit: 1 }] },
  async ({ event, step }) => {
    const { billingEventId } = BillingEventPayloadSchema.parse(event.data);
    const deps = await buildDeps();
    const result = await applyBillingEvent(deps, runnerOf(step), billingEventId, APP_URL());
    if (result.events.length > 0) await step.sendEvent("company-events", outgoing(result.events));
    return result;
  },
);

/** Hourly at :23 (and `billing/tick`): trials past their period end with no subscription end and stop their agents. */
export const entitlementsTick = inngest.createFunction(
  { id: "entitlements-tick", triggers: [cron("23 * * * *"), { event: EVENT.billingTick }], retries: 0 },
  async ({ step }) => {
    const deps = await buildDeps();
    const ended = await step.run("end-trials", () => endExpiredTrials(deps));
    if (ended.events.length > 0) await step.sendEvent("kill-switch", outgoing(ended.events));
    return { ended: ended.ended.length, users: ended.ended, companies: ended.events.length };
  },
);

/** Hourly at :41 (and `usage/tick`), one run at a time: one `usage_alert` per user per owner-local month at 40 % of the plan price (claimed before it is sent), and one when the credits ran out. */
export const usageTickFn = inngest.createFunction(
  { id: "usage-tick", triggers: [cron("41 * * * *"), { event: EVENT.usageTick }], retries: 1, concurrency: [{ limit: 1 }] },
  async ({ step }) => {
    const deps = await buildDeps();
    const due = await step.run("due", () => usageTick(deps));
    for (const alert of due) await step.run(`notify-${alert.reason}-${alert.userId}-${alert.period}`, () => notifyUsageAlert(deps, alert, APP_URL()));
    return { alerts: due.length, users: due.map((a) => a.userId) };
  },
);
