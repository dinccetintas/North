import { z } from "zod";
import type { ActionKind } from "./authority/action";

/** External accounts the user can connect (ONB-3). Tokens never leave the worker (ADR 0008). */
export const CONNECTION_PROVIDERS = ["github", "vercel", "gmail", "stripe", "meta_ads"] as const;
export type ConnectionProvider = (typeof CONNECTION_PROVIDERS)[number];

export const CONNECTION_STATUSES = ["connected", "revoked", "error"] as const;
export type ConnectionStatus = (typeof CONNECTION_STATUSES)[number];

export const ConnectionProviderSchema = z.enum(CONNECTION_PROVIDERS);

export const PROVIDER_TITLES: Readonly<Record<ConnectionProvider, string>> = Object.freeze({
  github: "GitHub",
  vercel: "Vercel",
  gmail: "Gmail",
  stripe: "Stripe",
  meta_ads: "Meta Ads",
});

/**
 * ONB-3 connect card: opened when a task needs an account the user has not
 * connected. It carries no action; "connected" resumes the task, "skip" (the
 * safe default) marks it not done. The web and the worker recognise it by its
 * option ids.
 */
export const CONNECT_CARD_OPTIONS = Object.freeze({ connected: "connected", skip: "skip" });

export const isConnectCard = (card: { readonly options: readonly { readonly id: string }[] }): boolean =>
  card.options.some((o) => o.id === CONNECT_CARD_OPTIONS.connected) && card.options.some((o) => o.id === CONNECT_CARD_OPTIONS.skip);

/** Which connection an external action needs; null for actions the platform performs with its own accounts. */
export function providerForAction(kind: ActionKind): ConnectionProvider | null {
  switch (kind) {
    case "repo.create":
    case "repo.push":
      return "github";
    case "deploy.preview":
    case "deploy.production":
      return "vercel";
    case "ads.start":
    case "ads.budget.change":
    case "ads.pause":
      return "meta_ads";
    case "email.send.first_contact":
    case "email.send.reply":
      return "gmail";
    default:
      return null;
  }
}
