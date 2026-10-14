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
