import { companyOwnerId, getCard, getCompanyById, getProfile, listPushSubscriptions, recordNotification } from "@north/db";
import type { WorkerDeps } from "../deps";

export interface NotifyResult {
  readonly push: number;
  readonly email: boolean;
}

/** Deep link to the card detail screen (WP-C2); the web app resolves the slug under RLS. */
export const cardUrl = (appUrl: string, slug: string, cardId: string): string => `${appUrl.replace(/\/$/, "")}/c/${slug}/decisions/${cardId}`;

/** DEC-2: a new card reaches the CEO by push (every subscription) and by email. */
export async function notifyDecision(deps: WorkerDeps, companyId: string, cardId: string, appUrl: string): Promise<NotifyResult> {
  const { db, integrations } = deps;
  const [card, company] = await Promise.all([getCard(db, cardId), getCompanyById(db, companyId)]);
  if (!card) throw new Error(`card ${cardId} not found`);
  if (!company) throw new Error(`company ${companyId} not found`);
  const ownerId = await companyOwnerId(db, companyId);
  const profile = await getProfile(db, ownerId);
  const url = cardUrl(appUrl, company.slug, cardId);
  const title = "North: a decision is waiting";
  const body = card.question;

  const subscriptions = await listPushSubscriptions(db, ownerId);
  let pushCount = 0;
  for (const subscription of subscriptions) {
    const sent = await integrations.push.send(subscription, { title, body, url });
    await recordNotification(db, { companyId, userId: ownerId, channel: "push", kind: "decision", cardId, payload: { endpoint: subscription.endpoint, error: sent.error ?? null }, status: sent.sandbox ? "sandbox" : sent.ok ? "sent" : "failed" });
    if (sent.ok) pushCount += 1;
  }

  let email = false;
  if (profile?.email) {
    try {
      const sent = await integrations.mail.send({ companyId, to: profile.email, subject: `${title}: ${card.question}`, text: `${card.rationale}\n\nDecide here: ${url}\nDue: ${card.dueAt}`, kind: "notification" });
      await recordNotification(db, { companyId, userId: ownerId, channel: "email", kind: "decision", cardId, payload: { messageId: sent.messageId }, status: sent.sandbox ? "sandbox" : "sent" });
      email = true;
    } catch (error) {
      await recordNotification(db, { companyId, userId: ownerId, channel: "email", kind: "decision", cardId, payload: { error: error instanceof Error ? error.message : String(error) }, status: "failed" });
    }
  }
  return { push: pushCount, email };
}
