import { randomBytes, timingSafeEqual } from "node:crypto";
import { z } from "zod";

/**
 * ONB-3 connection flows (ADR 0008). The web app knows only the public client
 * ids: it starts the provider's authorize flow and, on return, hands the
 * one-time code to the worker, which holds the client secret and stores the
 * token. CSRF protection is a random `state` kept in an httpOnly cookie and
 * compared on the callback.
 */

export const OAUTH_PROVIDERS = ["github", "vercel"] as const;
export type OauthProvider = (typeof OAUTH_PROVIDERS)[number];
export const OauthProviderSchema = z.enum(OAUTH_PROVIDERS);

export const STATE_COOKIE = "north_oauth_state";
export const STATE_TTL_SECONDS = 10 * 60;

export interface OauthProviderConfig {
  /** GitHub: the OAuth app's client id; Vercel: the integration's URL slug. */
  readonly publicId: string;
  readonly authorizeUrl: (state: string, redirectUri: string) => string;
}

/** Public config per provider, from the web env; null means the button falls back to a sandbox connection. */
export type EnvLike = Readonly<Record<string, string | undefined>>;

export function oauthConfig(provider: OauthProvider, env: EnvLike = process.env): OauthProviderConfig | null {
  if (provider === "github") {
    const id = env.GITHUB_CLIENT_ID;
    if (!id) return null;
    return {
      publicId: id,
      authorizeUrl: (state, redirectUri) => {
        const url = new URL("https://github.com/login/oauth/authorize");
        url.searchParams.set("client_id", id);
        url.searchParams.set("redirect_uri", redirectUri);
        url.searchParams.set("scope", "repo");
        url.searchParams.set("state", state);
        return url.toString();
      },
    };
  }
  const slug = env.VERCEL_INTEGRATION_SLUG;
  if (!slug) return null;
  return {
    publicId: slug,
    authorizeUrl: (state) => {
      const url = new URL(`https://vercel.com/integrations/${encodeURIComponent(slug)}/new`);
      url.searchParams.set("state", state);
      return url.toString();
    },
  };
}

/** 32 random bytes, URL-safe: the `state` value and the cookie that must match it. */
export const newState = (): string => randomBytes(32).toString("base64url");

/** Constant-time comparison of the returned `state` with the cookie; false on any shape mismatch. */
export function stateMatches(cookieValue: string | undefined, returned: string | null): boolean {
  if (!cookieValue || !returned) return false;
  const a = Buffer.from(cookieValue);
  const b = Buffer.from(returned);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** The state cookie carries the provider too, so a GitHub state cannot complete a Vercel callback. */
export const stateCookieValue = (provider: OauthProvider, state: string): string => `${provider}.${state}`;

export function parseStateCookie(value: string | undefined): { readonly provider: OauthProvider; readonly state: string } | null {
  if (!value) return null;
  const dot = value.indexOf(".");
  if (dot <= 0) return null;
  const provider = OauthProviderSchema.safeParse(value.slice(0, dot));
  const state = value.slice(dot + 1);
  return provider.success && state.length > 0 ? { provider: provider.data, state } : null;
}
