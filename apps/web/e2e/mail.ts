/**
 * Reads the sign-in magic link a test user was sent (TST-3).
 *
 * `E2E_MAIL_PROVIDER` picks the inbox: `mailpit` (default) is the local
 * Supabase mail catcher (`E2E_MAIL_API`, port 54324); `resend` is Resend's
 * receiving API for the staging domain, read with `E2E_RESEND_KEY` (a
 * full-access key, docs/runbooks/staging.md §7). Resend has no recipient
 * filter: the reader lists the newest 100 received mails, keeps those whose
 * `to` holds the address (any case) and, with `E2E_MAIL_FROM_DOMAIN`, whose
 * `from` is at that sender domain, retrieves the newest and takes the first
 * magic-link URL from its `text`, else its `html`. The link is used only when
 * its origin is the Supabase project (`E2E_SUPABASE_URL`, else
 * `NEXT_PUBLIC_SUPABASE_URL`) or the web (`E2E_BASE_URL`): anyone can mail the
 * predictable address. The key travels only in the `Authorization` header and
 * is never printed: errors name the address, the path, the status or the
 * link's origin, never a token.
 */
import { z } from "zod";

/** The two inboxes a run can read. */
export type MailProvider = "mailpit" | "resend";

/** Resend's API root; the reader calls `GET /emails/receiving?limit=100` and `GET /emails/receiving/{id}`. */
export const RESEND_API = "https://api.resend.com";
/** The newest 100 received mails (Resend's maximum page). */
export const RESEND_LIST_PATH = "/emails/receiving?limit=100";
export const RESEND_POLL_MS = 3_000;
export const RESEND_TIMEOUT_MS = 90_000;
export const MAILPIT_POLL_MS = 1_000;
export const MAILPIT_TIMEOUT_MS = 20_000;
const DEFAULT_MAIL_API = "http://127.0.0.1:54324/api/v1";
const REQUEST_TIMEOUT_MS = 10_000;

/** What the reader touches outside itself; tests pass fakes. */
export interface MailDeps {
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly fetch: typeof fetch;
  readonly sleep: (ms: number) => Promise<void>;
  readonly now: () => number;
}

const defaultDeps = (): MailDeps => ({
  env: process.env,
  fetch: globalThis.fetch,
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  now: Date.now,
});

/** `E2E_MAIL_PROVIDER` (any case, blank = unset): `mailpit` by default; anything but mailpit or resend is refused. */
export function mailProviderOf(env: Readonly<Record<string, string | undefined>>): MailProvider {
  const raw = (env.E2E_MAIL_PROVIDER ?? "").trim().toLowerCase();
  if (raw === "" || raw === "mailpit") return "mailpit";
  if (raw === "resend") return "resend";
  throw new Error("E2E_MAIL_PROVIDER must be mailpit or resend");
}

const MAGIC_LINK = /https?:\/\/[^\s"'<>]+(?:[?&](?:token|token_hash|code)=)[^\s"'<>]+/;

/** The first sign-in URL (one with a `token`, `token_hash` or `code` parameter) in the text body, else in the HTML body; null without one. */
export function extractMagicLink(text: string | null | undefined, html: string | null | undefined): string | null {
  for (const body of [text, html]) {
    const match = body ? MAGIC_LINK.exec(body) : null;
    if (match) return match[0].replace(/&amp;/g, "&");
  }
  return null;
}

/** A received mail as Resend's list returns it (the fields the pick reads). */
export interface ReceivedSummary {
  readonly id: string;
  readonly to: readonly string[];
  readonly from?: string | null;
  readonly created_at: string;
}

/** `Name <addr>` → `addr`; trimmed and lowercased. */
const addressOf = (recipient: string): string => (/<([^<>]+)>\s*$/.exec(recipient)?.[1] ?? recipient).trim().toLowerCase();
const timeOf = (createdAt: string): number => {
  const ms = Date.parse(createdAt);
  return Number.isFinite(ms) ? ms : Number.NEGATIVE_INFINITY;
};

/** True when the `from` address's domain is `domain` or a subdomain of it (any case). */
const sentFrom = (from: string | null | undefined, domain: string): boolean => {
  const host = addressOf(from ?? "").split("@")[1] ?? "";
  const wanted = domain.trim().toLowerCase();
  return host === wanted || host.endsWith(`.${wanted}`);
};

/**
 * The newest item whose `to` holds `email` exactly (any case, bare or
 * `Name <addr>`) and, when `fromDomain` is given, whose `from` is at that
 * domain or a subdomain; on equal or unreadable times the earlier in the list
 * (Resend lists newest first).
 */
export function pickNewestFor<T extends ReceivedSummary>(items: readonly T[], email: string, fromDomain?: string): T | null {
  const wanted = email.trim().toLowerCase();
  return items
    .filter((item) => item.to.some((recipient) => addressOf(recipient) === wanted))
    .filter((item) => fromDomain === undefined || sentFrom(item.from, fromDomain))
    .reduce<T | null>((newest, item) => (newest === null || timeOf(item.created_at) > timeOf(newest.created_at) ? item : newest), null);
}

const originOf = (url: string): string | null => {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
};

/** The link when its origin is one of `allowedOrigins`; otherwise throws naming the link's origin (never its path, query or token). */
export function checkMagicLinkOrigin(link: string, allowedOrigins: readonly string[]): string {
  const allowed = allowedOrigins.map(originOf).filter((o): o is string => o !== null);
  if (allowed.length === 0) throw new Error("set E2E_SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL): the magic link's origin is checked against the Supabase project before it is opened");
  const origin = originOf(link);
  if (origin === null || !allowed.includes(origin)) throw new Error(`the magic link points at ${origin ?? "something that is not a URL"}, not at ${allowed.join(" or ")}: refused`);
  return link;
}

/** The origins a staging magic link may point at: the Supabase project (required) and the web (`E2E_BASE_URL`, when set). */
function allowedLinkOrigins(env: MailDeps["env"]): readonly string[] {
  const supabase = (env.E2E_SUPABASE_URL ?? "").trim() || (env.NEXT_PUBLIC_SUPABASE_URL ?? "").trim();
  if (supabase === "") throw new Error("E2E_MAIL_PROVIDER=resend needs E2E_SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL): the magic link's origin is checked against the Supabase project before it is opened");
  return [supabase, (env.E2E_BASE_URL ?? "").trim()].filter((u) => u !== "");
}

const ResendListSchema = z.object({
  data: z.array(z.object({ id: z.string().min(1), to: z.array(z.string()).nullable().transform((to) => to ?? []), from: z.string().nullable().optional(), created_at: z.string() })),
});
const ResendEmailSchema = z.object({ text: z.string().nullable().optional(), html: z.string().nullable().optional() });

/** A Resend answer the reader cannot use; `retry` is false when polling cannot help (a refused key, a changed shape). */
class ResendError extends Error {
  readonly retry: boolean;

  constructor(message: string, retry: boolean) {
    super(message);
    this.retry = retry;
  }
}

/** GET `path` on Resend with the key as a bearer token; parses the JSON body with `schema`. */
async function resendGet<T extends z.ZodType>(deps: MailDeps, key: string, path: string, schema: T, label: string): Promise<z.infer<T>> {
  const init = { headers: { Authorization: `Bearer ${key}`, Accept: "application/json" }, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) };
  const res = await deps.fetch(`${RESEND_API}${path}`, init).catch((error: unknown) => {
    throw new ResendError(`${label}: GET ${path} failed (${error instanceof Error ? error.message : "network error"})`, true);
  });
  if (res.status === 401 || res.status === 403) throw new ResendError(`${label}: Resend answered ${res.status} for GET ${path}; check E2E_RESEND_KEY (a full-access key)`, false);
  if (!res.ok) throw new ResendError(`${label}: Resend answered ${res.status} for GET ${path}`, true);
  const parsed = schema.safeParse(await res.json().catch(() => undefined));
  if (!parsed.success) throw new ResendError(`${label}: GET ${path} did not match the expected shape (${parsed.error.issues.length} issue(s))`, false);
  return parsed.data;
}

/** One look at the Resend inbox: the newest mail to `email` and its link, or null when none has arrived yet. */
async function resendOnce(deps: MailDeps, key: string, email: string, fromDomain: string | undefined): Promise<string | null> {
  const list = await resendGet(deps, key, RESEND_LIST_PATH, ResendListSchema, "Resend receiving list");
  const mail = pickNewestFor(list.data, email, fromDomain);
  if (!mail) return null;
  const full = await resendGet(deps, key, `/emails/receiving/${encodeURIComponent(mail.id)}`, ResendEmailSchema, "Resend received mail");
  return extractMagicLink(full.text, full.html);
}

async function resendMagicLink(deps: MailDeps, email: string, timeoutMs: number): Promise<string> {
  const key = (deps.env.E2E_RESEND_KEY ?? "").trim();
  if (key === "") throw new Error("E2E_MAIL_PROVIDER=resend needs E2E_RESEND_KEY (a full-access Resend key; docs/runbooks/staging.md §7)");
  const origins = allowedLinkOrigins(deps.env);
  const fromDomain = (deps.env.E2E_MAIL_FROM_DOMAIN ?? "").trim() || undefined;
  const deadline = deps.now() + timeoutMs;
  let lastProblem: string | null = null;
  for (;;) {
    try {
      const link = await resendOnce(deps, key, email, fromDomain);
      if (link) return checkMagicLinkOrigin(link, origins);
    } catch (error) {
      if (!(error instanceof ResendError) || !error.retry) throw error;
      lastProblem = error.message;
    }
    if (deps.now() + RESEND_POLL_MS > deadline) break;
    await deps.sleep(RESEND_POLL_MS);
  }
  const last = lastProblem ? `; last problem: ${lastProblem}` : "";
  throw new Error(`No magic link for ${email} within ${timeoutMs}ms (Resend receiving API${last})`);
}

interface MailpitSummary {
  ID: string;
  To: { Address: string }[];
  Created: string;
}

/** The local mail catcher, as before: the newest 20 messages, the first addressed to `email`, its link. */
async function mailpitMagicLink(deps: MailDeps, email: string, timeoutMs: number): Promise<string> {
  const api = deps.env.E2E_MAIL_API ?? DEFAULT_MAIL_API;
  const deadline = deps.now() + timeoutMs;
  while (deps.now() < deadline) {
    const list = (await deps.fetch(`${api}/messages?limit=20`).then((r) => r.json())) as { messages?: MailpitSummary[] };
    const mail = (list.messages ?? []).find((m) => m.To.some((t) => t.Address.toLowerCase() === email.toLowerCase()));
    if (mail) {
      const full = (await deps.fetch(`${api}/message/${mail.ID}`).then((r) => r.json())) as { Text?: string; HTML?: string };
      const link = extractMagicLink(full.Text, full.HTML);
      if (link) return link;
    }
    await deps.sleep(MAILPIT_POLL_MS);
  }
  throw new Error(`No magic link for ${email} within ${timeoutMs}ms`);
}

/**
 * The magic link most recently sent to `email`, polling the inbox
 * `E2E_MAIL_PROVIDER` names until `timeoutMs` (default 20 s on Mailpit, 90 s
 * on Resend, polled every 3 s there).
 */
export async function latestMagicLink(email: string, timeoutMs?: number, deps: Partial<MailDeps> = {}): Promise<string> {
  const all: MailDeps = { ...defaultDeps(), ...deps };
  return mailProviderOf(all.env) === "resend" ? resendMagicLink(all, email, timeoutMs ?? RESEND_TIMEOUT_MS) : mailpitMagicLink(all, email, timeoutMs ?? MAILPIT_TIMEOUT_MS);
}
