/**
 * OBS-1: what the web's Sentry may send. `sendDefaultPii: false` already
 * keeps IPs and cookies out; these hooks also drop the user, request
 * headers and bodies, typed input and URL queries (OAuth codes, checkout
 * ids), and console text. Pure and structural so both configs share them.
 */

/** The path of a URL without its query or fragment; relative URLs stay relative. */
export function stripQuery(url: string | undefined): string | undefined {
  if (url === undefined) return undefined;
  const cut = url.search(/[?#]/);
  return cut < 0 ? url : url.slice(0, cut);
}

interface EventLike {
  readonly user?: unknown;
  readonly request?: { readonly url?: string; readonly method?: string };
}

/** A new event without the user and with only the request's method and path. */
export function scrubEvent<E extends EventLike>(event: E): E {
  const { user: _user, request, ...rest } = event;
  void _user;
  if (!request) return rest as E;
  const url = stripQuery(request.url);
  return { ...rest, request: { ...(url === undefined ? {} : { url }), ...(request.method === undefined ? {} : { method: request.method }) } } as E;
}

interface BreadcrumbLike {
  readonly category?: string;
  readonly message?: string;
  readonly data?: Record<string, unknown>;
}

const URL_KEYS = ["url", "from", "to"] as const;

function scrubData(data: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(data).map(([key, value]) => [key, (URL_KEYS as readonly string[]).includes(key) && typeof value === "string" ? stripQuery(value) : value]));
}

/** Null drops the breadcrumb. */
export function scrubBreadcrumb<B extends BreadcrumbLike>(breadcrumb: B): B | null {
  if (breadcrumb.category === "ui.input") return null;
  if (breadcrumb.category === "console") return { category: "console", message: "[console]" } as B;
  return breadcrumb.data ? { ...breadcrumb, data: scrubData(breadcrumb.data) } : breadcrumb;
}
