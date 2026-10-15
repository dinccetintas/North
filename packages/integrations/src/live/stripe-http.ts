import type { FetchLike } from "./github";

/** Stripe's REST API. Both Stripe adapters (the platform's billing, the user's read) go through `stripeCall`. */
export const STRIPE_API = "https://api.stripe.com/v1";

export type FormValue = string | number | boolean | null | undefined | readonly FormValue[] | { readonly [key: string]: FormValue };

function flatten(prefix: string, value: FormValue): readonly (readonly [string, string])[] {
  if (value === null || value === undefined) return [];
  if (Array.isArray(value)) return value.flatMap((item, index) => flatten(`${prefix}[${index}]`, item as FormValue));
  if (typeof value === "object") return Object.entries(value as Record<string, FormValue>).flatMap(([key, item]) => flatten(`${prefix}[${key}]`, item));
  return [[prefix, String(value)]];
}

/** Stripe's form encoding: nested keys in brackets (`line_items[0][price]`), booleans as `true`/`false`, null and undefined left out. */
export function stripeForm(params: Readonly<Record<string, FormValue>>): string {
  const pairs = Object.entries(params).flatMap(([key, value]) => flatten(key, value));
  return new URLSearchParams(pairs.map(([k, v]) => [k, v])).toString();
}

export interface StripeRequest {
  readonly method: "GET" | "POST";
  /** Path under `/v1`, starting with `/`. */
  readonly path: string;
  /** Ordered pairs, so repeated and bracketed keys (`lookup_keys[]`, `created[gte]`) survive. */
  readonly query?: readonly (readonly [string, string])[];
  readonly form?: Readonly<Record<string, FormValue>>;
  readonly idempotencyKey?: string;
  /** Stripe Connect: act on this connected account (`Stripe-Account: acct_…`). */
  readonly account?: string;
}

export type StripeResponse = { readonly ok: true; readonly status: number; readonly json: unknown } | { readonly ok: false; readonly status: number | null; readonly code: string };

const CODE = /^[a-z0-9_]{1,80}$/;

/** The machine code of a Stripe error body (`error.code`), else `http_<status>`; nothing else of the body is ever kept. */
function errorCode(status: number, text: string): string {
  try {
    const code = (JSON.parse(text) as { error?: { code?: unknown } }).error?.code;
    if (typeof code === "string" && CODE.test(code)) return code;
  } catch {
    // not JSON: only the status is reported
  }
  return `http_${status}`;
}

function headersFor(token: string, request: StripeRequest): Record<string, string> {
  return {
    authorization: `Bearer ${token}`,
    accept: "application/json",
    ...(request.form ? { "content-type": "application/x-www-form-urlencoded" } : {}),
    ...(request.idempotencyKey ? { "idempotency-key": request.idempotencyKey } : {}),
    ...(request.account ? { "stripe-account": request.account } : {}),
  };
}

/**
 * One Stripe request. The key travels only as the bearer header (never in a
 * URL, never in an error); a failure is reduced to the status and Stripe's
 * `error.code`. Network failures are `network_error`, a success that is not
 * JSON `invalid_response`.
 */
export async function stripeCall(fetchImpl: FetchLike, token: string, request: StripeRequest): Promise<StripeResponse> {
  const query = request.query && request.query.length > 0 ? `?${new URLSearchParams(request.query.map(([k, v]) => [k, v])).toString()}` : "";
  let response: Response;
  try {
    response = await fetchImpl(`${STRIPE_API}${request.path}${query}`, {
      method: request.method,
      headers: headersFor(token, request),
      ...(request.form ? { body: stripeForm(request.form) } : {}),
    });
  } catch {
    return Object.freeze({ ok: false, status: null, code: "network_error" });
  }
  const text = await response.text().catch(() => "");
  if (response.status < 200 || response.status >= 300) return Object.freeze({ ok: false, status: response.status, code: errorCode(response.status, text) });
  try {
    return Object.freeze({ ok: true, status: response.status, json: JSON.parse(text) as unknown });
  } catch {
    return Object.freeze({ ok: false, status: response.status, code: "invalid_response" });
  }
}
