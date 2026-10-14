import { companyOwnerId, getCard, getCompanyById, getProfile, listPushSubscriptions, recordNotification, type CardRecord } from "@north/db";
import type { WorkerDeps } from "../deps";

/** Deep link to the card detail screen (WP-C2); the web app resolves the slug under RLS. */
export const cardUrl = (appUrl: string, slug: string, cardId: string): string => `${appUrl.replace(/\/$/, "")}/c/${slug}/decisions/${cardId}`;

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
