import { randomBytes, timingSafeEqual } from "node:crypto";
import { z } from "zod";

/**
 * ONB-3 connection flows (ADR 0008). The web app knows only the public client
 * ids: it starts the provider's authorize flow and, on return, hands the
 * one-time code to the worker, which holds the client secret and stores the
 * token. CSRF protection is a random `state` kept in an httpOnly cookie,
 * bound to the provider and the signed-in user, and compared on the callback.
 */

export const OAUTH_PROVIDERS = ["github", "vercel"] as const;
export type OauthProvider = (typeof OAUTH_PROVIDERS)[number];
export const OauthProviderSchema = z.enum(OAUTH_PROVIDERS);

export const STATE_COOKIE = "north_oauth_state";
export const STATE_TTL_SECONDS = 10 * 60;
/** `repo` is needed to create private repositories; `public_repo` is the narrower choice when public sites are fine (.env.example). */
const DEFAULT_GITHUB_SCOPE = "repo";

export type EnvLike = Readonly<Record<string, string | undefined>>;

export interface OauthProviderConfig {
  /** GitHub: the OAuth app's client id; Vercel: the integration's URL slug. */
  readonly publicId: string;
  readonly authorizeUrl: (state: string, redirectUri: string) => string;
}

/** Public config per provider, from the web env; null means the button falls back to a sandbox connection. */
export function oauthConfig(provider: OauthProvider, env: EnvLike = process.env): OauthProviderConfig | null {
  if (provider === "github") {
    const id = env.GITHUB_CLIENT_ID;
    if (!id) return null;
    const scope = env.GITHUB_OAUTH_SCOPE?.trim() || DEFAULT_GITHUB_SCOPE;
    return {
      publicId: id,
      authorizeUrl: (state, redirectUri) => {
        const url = new URL("https://github.com/login/oauth/authorize");
        url.searchParams.set("client_id", id);
        url.searchParams.set("redirect_uri", redirectUri);
        url.searchParams.set("scope", scope);
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

export interface StateCookie {
  readonly provider: OauthProvider;
  readonly userId: string;
  readonly state: string;
}

/** The cookie carries provider and user too, so a GitHub state cannot complete a Vercel callback, nor another session's. */
export const stateCookieValue = (provider: OauthProvider, userId: string, state: string): string => `${provider}.${userId}.${state}`;

export function parseStateCookie(value: string | undefined): StateCookie | null {
  if (!value) return null;
  const [rawProvider, userId, ...rest] = value.split(".");
  const state = rest.join(".");
  const provider = OauthProviderSchema.safeParse(rawProvider);
  if (!provider.success || !userId || !z.string().uuid().safeParse(userId).success || state.length === 0) return null;
  return { provider: provider.data, userId, state };
}
