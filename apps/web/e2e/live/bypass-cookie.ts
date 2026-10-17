/**
 * TST-3: Vercel's Deployment Protection bypass for the live journey, kept out
 * of the browser. `e2e/global-setup.ts` sends `VERCEL_AUTOMATION_BYPASS_SECRET`
 * once, from Node, to `E2E_BASE_URL` with `x-vercel-set-bypass-cookie:
 * samesitenone`; this module turns the `Set-Cookie` lines of that answer into
 * the `_vercel_jwt` cookie for the staging host and a Playwright storage state
 * (`test-results/staging-storage-state.json`, removed by the global teardown).
 * The browser then holds only that cookie, scoped to the staging host; the
 * secret is never a header, a route or a context option, so no request to
 * another origin and no trace carries it. Pure: no network, no file system.
 */
import { join } from "node:path";

/** The cookie Vercel sets when the bypass header asks for it. */
export const BYPASS_COOKIE = "_vercel_jwt";
/** The protection bypass header; sent once, from Node, by the global setup. */
export const BYPASS_HEADER = "x-vercel-protection-bypass";
/** Asks Vercel to answer with the bypass cookie; `samesitenone` so it also rides the redirect back from Supabase's verify link. */
export const SET_BYPASS_COOKIE_HEADER = "x-vercel-set-bypass-cookie";
/** A cookie without Expires or Max-Age is kept for a day (one run). */
const DEFAULT_LIFETIME_S = 86_400;

/** A cookie as Playwright's `storageState` holds it (`expires` in Unix seconds). */
export interface StateCookie {
  readonly name: string;
  readonly value: string;
  readonly domain: string;
  readonly path: string;
  readonly expires: number;
  readonly httpOnly: boolean;
  readonly secure: boolean;
  readonly sameSite: "Strict" | "Lax" | "None";
}

/** A Playwright storage state holding only cookies. */
export interface StorageState {
  readonly cookies: readonly StateCookie[];
  readonly origins: readonly [];
}

interface ParsedCookie {
  readonly name: string;
  readonly value: string;
  readonly attributes: ReadonlyMap<string, string>;
}

/** `name=value; Attr=x; Flag` → the name, the value (split at the first `=`) and the attributes by lowercase name. */
function parseSetCookie(line: string): ParsedCookie {
  const [pair = "", ...rest] = line.split(";");
  const eq = pair.indexOf("=");
  const name = (eq < 0 ? pair : pair.slice(0, eq)).trim();
  const value = eq < 0 ? "" : pair.slice(eq + 1).trim();
  const attributes = new Map(
    rest.map((part) => {
      const at = part.indexOf("=");
      return [(at < 0 ? part : part.slice(0, at)).trim().toLowerCase(), at < 0 ? "" : part.slice(at + 1).trim()] as const;
    }),
  );
  return { name, value, attributes };
}

/** True when the cookie's `Domain` (if any) covers `host`: the host itself or a parent domain of it. */
function domainCovers(domain: string | undefined, host: string): boolean {
  if (domain === undefined || domain === "") return true;
  const bare = domain.replace(/^\./, "").toLowerCase();
  const target = host.toLowerCase();
  return target === bare || target.endsWith(`.${bare}`);
}

/** Unix seconds the cookie expires at: `Max-Age` over `Expires`, else a day from `now`. */
function expiresAt(attributes: ReadonlyMap<string, string>, now: Date): number {
  const nowSeconds = Math.floor(now.getTime() / 1000);
  const maxAge = attributes.get("max-age");
  if (maxAge !== undefined && /^-?\d+$/.test(maxAge)) return nowSeconds + Number(maxAge);
  const expires = Date.parse(attributes.get("expires") ?? "");
  return Number.isFinite(expires) ? Math.floor(expires / 1000) : nowSeconds + DEFAULT_LIFETIME_S;
}

/**
 * The last `_vercel_jwt` among the `Set-Cookie` lines whose `Domain` covers
 * `host`, as a storage-state cookie for `host` on `/` (secure, SameSite=None);
 * null when there is none, it is empty, or it has already expired.
 */
export function bypassCookieFrom(setCookieLines: readonly string[], host: string, now: Date): StateCookie | null {
  const found = setCookieLines
    .map(parseSetCookie)
    .filter((c) => c.name === BYPASS_COOKIE && c.value !== "" && domainCovers(c.attributes.get("domain"), host))
    .at(-1);
  if (!found) return null;
  const expires = expiresAt(found.attributes, now);
  if (expires <= Math.floor(now.getTime() / 1000)) return null;
  return Object.freeze({ name: BYPASS_COOKIE, value: found.value, domain: host.toLowerCase(), path: "/", expires, httpOnly: found.attributes.has("httponly"), secure: true, sameSite: "None" });
}

/** The storage state the staging projects start from: the bypass cookie and nothing else. */
export function storageStateFor(cookie: StateCookie): StorageState {
  return Object.freeze({ cookies: Object.freeze([cookie]), origins: Object.freeze([]) as readonly [] });
}

/** `<web root>/test-results/staging-storage-state.json`: git-ignored, scanned by the evidence guard, removed by the global teardown. */
export function storageStatePath(webRoot: string): string {
  return join(webRoot, "test-results", "staging-storage-state.json");
}
