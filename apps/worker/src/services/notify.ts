import { briefMarkdown, type Brief } from "@north/core";
import { companyOwnerId, getCard, getCompanyById, getProfile, listCompaniesByOwner, listPushSubscriptions, recordNotification, type CardRecord } from "@north/db";
import type { WorkerDeps } from "../deps";

/** Deep link to the card detail screen (WP-C2); the web app resolves the slug under RLS. */
export const cardUrl = (appUrl: string, slug: string, cardId: string): string => `${appUrl.replace(/\/$/, "")}/c/${slug}/decisions/${cardId}`;

/** The company's home screen, where the brief panel lives (BRF-1). */
export const homeUrl = (appUrl: string, slug: string): string => `${appUrl.replace(/\/$/, "")}/c/${slug}`;

interface Target {
  readonly card: CardRecord;
  readonly ownerId: string;
  readonly url: string;
  readonly title: string;
}

async function target(deps: WorkerDeps, companyId: string, cardId: string, appUrl: string): Promise<Target> {
  const [card, company] = await Promise.all([getCard(deps.db, cardId), getCompanyById(deps.db, companyId)]);
  if (!card) throw new Error(`card ${cardId} not found`);
  if (!company) throw new Error(`company ${companyId} not found`);
  const ownerId = await companyOwnerId(deps.db, companyId);
  return { card, ownerId, url: cardUrl(appUrl, company.slug, cardId), title: "North: a decision is waiting" };
}

/** DEC-2 by push: every subscription of the owner; a dead subscription is logged, not fatal. Returns the count delivered. */
export async function notifyByPush(deps: WorkerDeps, companyId: string, cardId: string, appUrl: string): Promise<number> {
  const { db, integrations } = deps;
  const t = await target(deps, companyId, cardId, appUrl);
  let delivered = 0;
  for (const subscription of await listPushSubscriptions(db, t.ownerId)) {
    const sent = await integrations.push.send(subscription, { title: t.title, body: t.card.question, url: t.url });
    await recordNotification(db, { companyId, userId: t.ownerId, channel: "push", kind: "decision", cardId, payload: { endpoint: subscription.endpoint, error: sent.error ?? null }, status: sent.sandbox ? "sandbox" : sent.ok ? "sent" : "failed" });
    if (sent.ok) delivered += 1;
  }
  return delivered;
}

/** DEC-2 by email to the owner's address; the body carries the question, the rationale and the link, never the payload. */
export async function notifyByEmail(deps: WorkerDeps, companyId: string, cardId: string, appUrl: string): Promise<boolean> {
  const { db, integrations } = deps;
  const t = await target(deps, companyId, cardId, appUrl);
  const profile = await getProfile(db, t.ownerId);
  if (!profile?.email) return false;
  try {
    const sent = await integrations.mail.send({ companyId, to: profile.email, subject: `${t.title}: ${t.card.question}`, text: `${t.card.rationale}\n\nDecide here: ${t.url}\nDue: ${t.card.dueAt}`, kind: "notification" });
    await recordNotification(db, { companyId, userId: t.ownerId, channel: "email", kind: "decision", cardId, payload: { messageId: sent.messageId }, status: sent.sandbox ? "sandbox" : "sent" });
    return true;
  } catch (error) {
    await recordNotification(db, { companyId, userId: t.ownerId, channel: "email", kind: "decision", cardId, payload: { error: error instanceof Error ? error.message : String(error) }, status: "failed" });
    return false;
  }
}

/** Both channels in one call (tests and scripts); the Inngest function runs them as separate steps. */
export async function notifyDecision(deps: WorkerDeps, companyId: string, cardId: string, appUrl: string): Promise<{ readonly push: number; readonly email: boolean }> {
  const push = await notifyByPush(deps, companyId, cardId, appUrl);
  const email = await notifyByEmail(deps, companyId, cardId, appUrl);
  return { push, email };
}

/** The brief's subject line: "North: <company> morning brief <day>". */
export const briefSubject = (brief: Pick<Brief, "companyName" | "day">): string => `North: ${brief.companyName} morning brief ${brief.day}`;

const PUSH_BODY_MAX = 500;

/** BRF-1 by push (`kind: brief`): the brief's first line to every subscription of the owner, linking to the home screen. */
export async function notifyBriefPush(deps: WorkerDeps, companyId: string, brief: Brief, appUrl: string): Promise<number> {
  const { db, integrations } = deps;
  const company = await getCompanyById(db, companyId);
  if (!company) throw new Error(`company ${companyId} not found`);
  const ownerId = await companyOwnerId(db, companyId);
  const headline = briefMarkdown(brief).split("\n")[0] ?? briefSubject(brief);
  let delivered = 0;
  for (const subscription of await listPushSubscriptions(db, ownerId)) {
    const sent = await integrations.push.send(subscription, { title: briefSubject(brief).slice(0, 120), body: headline.slice(0, PUSH_BODY_MAX), url: homeUrl(appUrl, company.slug) });
    await recordNotification(db, { companyId, userId: ownerId, channel: "push", kind: "brief", payload: { day: brief.day, endpoint: subscription.endpoint, error: sent.error ?? null }, status: sent.sandbox ? "sandbox" : sent.ok ? "sent" : "failed" });
    if (sent.ok) delivered += 1;
  }
  return delivered;
}

/** BRF-1 by email (`kind: brief`): subject "North: <company> morning brief <day>", body = `briefMarkdown` (text, never HTML). */
export async function notifyBriefEmail(deps: WorkerDeps, companyId: string, brief: Brief, appUrl: string): Promise<boolean> {
  const { db, integrations } = deps;
  const company = await getCompanyById(db, companyId);
  if (!company) throw new Error(`company ${companyId} not found`);
  const ownerId = await companyOwnerId(db, companyId);
  const profile = await getProfile(db, ownerId);
  if (!profile?.email) return false;
  try {
    const sent = await integrations.mail.send({ companyId, to: profile.email, subject: briefSubject(brief), text: `${briefMarkdown(brief)}\n\nOpen North: ${homeUrl(appUrl, company.slug)}`, kind: "notification" });
    await recordNotification(db, { companyId, userId: ownerId, channel: "email", kind: "brief", payload: { day: brief.day, messageId: sent.messageId }, status: sent.sandbox ? "sandbox" : "sent" });
    return true;
  } catch (error) {
    await recordNotification(db, { companyId, userId: ownerId, channel: "email", kind: "brief", payload: { day: brief.day, error: error instanceof Error ? error.message : String(error) }, status: "failed" });
    return false;
  }
}

/** Push and email for one brief (tests and scripts); the Inngest function runs them as separate steps. */
export async function notifyBrief(deps: WorkerDeps, companyId: string, brief: Brief, appUrl: string): Promise<{ readonly push: number; readonly email: boolean }> {
  const push = await notifyBriefPush(deps, companyId, brief, appUrl);
  const email = await notifyBriefEmail(deps, companyId, brief, appUrl);
  return { push, email };
}

/** A billing message to the owner (BIL-1, BIL-2): not about a card or a brief, so it lands on the owner's first running company's log. */
export interface OwnerNotice {
  /** `usage_alert`, `billing_past_due`. */
  readonly kind: string;
  readonly title: string;
  readonly body: string;
  /** Where the link goes (`/settings/billing` on the app). */
  readonly url: string;
  readonly payload: Readonly<Record<string, unknown>>;
}

/**
 * Push to every subscription of the owner and one email, each recorded with
 * the notice's kind. `notifications.company_id` is required, so the row is
 * filed under the owner's oldest company that is not archived; an owner
 * without one gets nothing (there is nothing to run).
 */
export async function notifyOwner(deps: WorkerDeps, userId: string, notice: OwnerNotice): Promise<{ readonly push: number; readonly email: boolean }> {
  const { db, integrations } = deps;
  const company = (await listCompaniesByOwner(db, userId)).find((c) => c.status !== "archived");
  if (!company) return { push: 0, email: false };
  let push = 0;
  for (const subscription of await listPushSubscriptions(db, userId)) {
    const sent = await integrations.push.send(subscription, { title: notice.title.slice(0, 120), body: notice.body.slice(0, PUSH_BODY_MAX), url: notice.url });
    await recordNotification(db, { companyId: company.id, userId, channel: "push", kind: notice.kind, payload: { ...notice.payload, endpoint: subscription.endpoint, error: sent.error ?? null }, status: sent.sandbox ? "sandbox" : sent.ok ? "sent" : "failed" });
    if (sent.ok) push += 1;
  }
  const profile = await getProfile(db, userId);
  if (!profile?.email) return { push, email: false };
  try {
    const sent = await integrations.mail.send({ companyId: company.id, to: profile.email, subject: notice.title, text: `${notice.body}\n\n${notice.url}`, kind: "notification" });
    await recordNotification(db, { companyId: company.id, userId, channel: "email", kind: notice.kind, payload: { ...notice.payload, messageId: sent.messageId }, status: sent.sandbox ? "sandbox" : "sent" });
    return { push, email: true };
  } catch (error) {
    await recordNotification(db, { companyId: company.id, userId, channel: "email", kind: notice.kind, payload: { ...notice.payload, error: error instanceof Error ? error.message : String(error) }, status: "failed" });
    return { push, email: false };
  }
}
