import { randomBytes, timingSafeEqual } from "node:crypto";
import { z } from "zod";

/**
 * ONB-3 connection flows (ADR 0008, ADR 0010). The web app knows only the
 * public client ids: it starts the provider's authorize flow and, on return,
 * hands the one-time code to the worker, which holds the client secret and
 * stores the token. CSRF protection is a random `state` kept in an httpOnly
 * cookie, bound to the provider and the signed-in user, and compared on the
 * callback.
 */

export const OAUTH_PROVIDERS = ["github", "vercel", "meta_ads", "gmail"] as const;
export type OauthProvider = (typeof OAUTH_PROVIDERS)[number];
export const OauthProviderSchema = z.enum(OAUTH_PROVIDERS);

export const STATE_COOKIE = "north_oauth_state";
export const STATE_TTL_SECONDS = 10 * 60;
/** `repo` is needed to create private repositories; `public_repo` is the narrower choice when public sites are fine (.env.example). */
const DEFAULT_GITHUB_SCOPE = "repo";
/** M4 (BUD-2): manage and read the user's own ad account; list pages for the ad's page id. */
const META_SCOPE = "ads_management,ads_read,pages_show_list";
const META_DIALOG_URL = "https://www.facebook.com/v21.0/dialog/oauth";
/** M4 (SLS-K2): send from the user's mailbox and read threads for replies; nothing broader. */
const GMAIL_SCOPE = "https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/gmail.readonly";
const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";

export type EnvLike = Readonly<Record<string, string | undefined>>;

export interface OauthProviderConfig {
  /** GitHub: the OAuth app's client id; Vercel: the integration's URL slug; Meta: the app id; Google: the client id. */
  readonly publicId: string;
  readonly authorizeUrl: (state: string, redirectUri: string) => string;
}

const withParams = (base: string, params: Readonly<Record<string, string>>): string => {
  const url = new URL(base);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return url.toString();
};

/** Which env name carries each provider's public id, and how its authorize URL is built from it. */
const PROVIDERS: Readonly<Record<OauthProvider, { readonly envKey: string; readonly build: (id: string, env: EnvLike) => OauthProviderConfig["authorizeUrl"] }>> = Object.freeze({
  github: {
    envKey: "GITHUB_CLIENT_ID",
    build: (id, env) => (state, redirectUri) =>
      withParams("https://github.com/login/oauth/authorize", { client_id: id, redirect_uri: redirectUri, scope: env.GITHUB_OAUTH_SCOPE?.trim() || DEFAULT_GITHUB_SCOPE, state }),
  },
  vercel: {
    envKey: "VERCEL_INTEGRATION_SLUG",
    build: (slug) => (state) => withParams(`https://vercel.com/integrations/${encodeURIComponent(slug)}/new`, { state }),
  },
  meta_ads: {
    envKey: "META_APP_ID",
    build: (id) => (state, redirectUri) => withParams(META_DIALOG_URL, { client_id: id, redirect_uri: redirectUri, scope: META_SCOPE, response_type: "code", state }),
  },
  gmail: {
    envKey: "GOOGLE_CLIENT_ID",
    build: (id) => (state, redirectUri) =>
      withParams(GOOGLE_AUTH_URL, { client_id: id, redirect_uri: redirectUri, response_type: "code", scope: GMAIL_SCOPE, access_type: "offline", prompt: "consent", state }),
  },
});

/** Public config per provider, from the web env; null means the button falls back to a sandbox connection. */
export function oauthConfig(provider: OauthProvider, env: EnvLike = process.env): OauthProviderConfig | null {
  const entry = PROVIDERS[provider];
  const id = env[entry.envKey]?.trim();
  if (!id) return null;
  return { publicId: id, authorizeUrl: entry.build(id, env) };
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

/** The cookie carries provider and user too, so a GitHub state cannot complete a Gmail callback, nor another session's. */
export const stateCookieValue = (provider: OauthProvider, userId: string, state: string): string => `${provider}.${userId}.${state}`;

export function parseStateCookie(value: string | undefined): StateCookie | null {
  if (!value) return null;
  const [rawProvider, userId, ...rest] = value.split(".");
  const state = rest.join(".");
  const provider = OauthProviderSchema.safeParse(rawProvider);
  if (!provider.success || !userId || !z.string().uuid().safeParse(userId).success || state.length === 0) return null;
  return { provider: provider.data, userId, state };
}
