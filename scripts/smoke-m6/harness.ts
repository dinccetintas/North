/**
 * Shared plumbing of the M6 smoke (docs/plans/M6.md "Acceptance test"): the
 * service-role client and an owner's own RLS client (what the web holds), the
 * Inngest dev client plus the Dev Server's API (run outputs, the event list),
 * the worker's simulated clock, the signed Stripe webhook, the sandbox
 * checkout and portal buttons, polling with timeouts, the cron start guard
 * and the checkpoint every phase ends with (append-only tables, the
 * owner-local daily quota).
 */
import { randomUUID } from "node:crypto";
import { Inngest } from "inngest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { localDay } from "@north/core/time";
import type { Database, DbClient } from "@north/db";
import { SANDBOX_STRIPE_WEBHOOK_SECRET, signSandboxWebhook } from "../../packages/integrations/src/sandbox/billing-events";
import { localSupabaseEnv } from "../../packages/db/test/env";

const INNGEST_BASE_URL = (process.env.INNGEST_BASE_URL ?? "http://localhost:8288").replace(/\/+$/, "");
export const WORKER_URL = (process.env.WORKER_URL ?? "http://localhost:3101").replace(/\/+$/, "");
/** Where the worker says its sandbox checkout and portal pages live (`SANDBOX_SITE_BASE_URL`, default loopback). */
export const SANDBOX_BASE_URL = (process.env.SANDBOX_SITE_BASE_URL ?? "http://127.0.0.1:3101").replace(/\/+$/, "");
/** The worker's sandbox default (`STRIPE_WEBHOOK_SECRET` unset on a loopback host, ADR 0014). */
export const STRIPE_SECRET = process.env.STRIPE_WEBHOOK_SECRET ?? SANDBOX_STRIPE_WEBHOOK_SECRET;
export const TIMEOUT_MS = Number(process.env.SMOKE_TIMEOUT_MS ?? 120_000);
/** The owner the plan prescribes: Istanbul (UTC+3, no DST), quota 3, the brief at 09:00. */
export const TIMEZONE = "Europe/Istanbul";
export const QUOTA = 3;
export const OWNER_BRIEF_HOUR = 9;
/** Monday 2026-11-02 07:00 Istanbul: the first instant of the run. */
export const SIM_START = "2026-11-02T04:00:00Z";
const SIM_START_HOUR = 7;
export const DAY_MS = 86_400_000;
/** How long phases 1–6 may take before the companies stop: the six-hourly scan must not fall inside (override in minutes). */
const SCAN_GUARD_MS = Number(process.env.SMOKE_M6_SCAN_GUARD_MIN ?? 12) * 60_000;

export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
export const show = (value: unknown): string => (typeof value === "string" ? value : JSON.stringify(value));

export function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`smoke M6: ${message}`);
}

/** Every assertion says what it expected and what it found. */
export function check(condition: unknown, label: string, expected: string, found: unknown): asserts condition {
  if (!condition) throw new Error(`smoke M6: ${label}: expected ${expected}, found ${show(found)}`);
}

export interface UntilOptions {
  readonly timeoutMs?: number;
  readonly intervalMs?: number;
  /** What to print when the wait times out (the rows that were there instead). */
  readonly found?: () => Promise<unknown>;
}

export async function until<T>(label: string, probe: () => Promise<T | null | undefined | false>, opts: UntilOptions = {}): Promise<T> {
  const started = Date.now();
  const timeoutMs = opts.timeoutMs ?? TIMEOUT_MS;
  while (Date.now() - started < timeoutMs) {
    const value = await probe();
    if (value) return value;
    await sleep(opts.intervalMs ?? 1000);
  }
  const found = opts.found ? ` (found: ${show(await opts.found())})` : "";
  throw new Error(`smoke M6: timed out after ${timeoutMs} ms waiting for ${label}${found}`);
}

const env = localSupabaseEnv();
const NO_SESSION = { auth: { persistSession: false, autoRefreshToken: false } } as const;
export const db: DbClient = createClient<Database>(env.url, env.serviceRoleKey, NO_SESSION);
/** Untyped view of the service client for row counts over many tables (the purge proof). */
export const loose: SupabaseClient = db as unknown as SupabaseClient;
export const inngest = new Inngest({ id: "north-smoke-m6", isDev: true, baseUrl: INNGEST_BASE_URL });

export interface SignedInUser {
  readonly id: string;
  readonly email: string;
  /** The user's own client under RLS: what the web app holds for them. */
  readonly client: DbClient;
}

/** A confirmed auth user (the trigger gives them the trial) and a client signed in as them. */
export async function signedInUser(label: string): Promise<SignedInUser> {
  const email = `smoke-m6-${label}-${Date.now()}@north.test`;
  const password = `pw-${randomUUID()}-Aa1!`;
  const created = await db.auth.admin.createUser({ email, password, email_confirm: true });
  assert(created.data.user, `createUser failed: ${created.error?.message}`);
  const client = createClient<Database>(env.url, env.anonKey, NO_SESSION);
  const signed = await client.auth.signInWithPassword({ email, password });
  assert(!signed.error, `signIn failed: ${signed.error?.message}`);
  return { id: created.data.user.id, email, client };
}

/* ---------- the simulated clock ---------- */

/** The instant of `hh:mm` Istanbul on day N of the run (day 1 = SIM_START's Monday). */
export function simAt(day: number, hhmm: string): Date {
  const [h, m] = hhmm.split(":").map(Number);
  assert(h !== undefined && m !== undefined && Number.isInteger(h) && Number.isInteger(m), `bad time ${hhmm}`);
  return new Date(Date.parse(SIM_START) + (day - 1) * DAY_MS + ((h - SIM_START_HOUR) * 60 + m) * 60_000);
}

/** The owner-local calendar day of day N (`YYYY-MM-DD`). */
export const simDay = (day: number): string => localDay(TIMEZONE, simAt(day, "12:00"));

async function workerPostRaw(path: string, body: unknown, headers: Record<string, string> = {}): Promise<Response> {
  return fetch(`${WORKER_URL}${path}`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: typeof body === "string" ? body : JSON.stringify(body) });
}

export async function workerPost(path: string, body: unknown): Promise<void> {
  const response = await workerPostRaw(path, body);
  assert(response.ok, `worker POST ${path} → ${response.status} ${await response.text()}`);
}

/** Moves the worker's clock (sandbox mode on a loopback host only) and returns the instant. */
export async function setClockTo(now: Date): Promise<Date> {
  await workerPost("/sandbox/clock", { now: now.toISOString() });
  return now;
}

export const setClock = (day: number, hhmm: string): Promise<Date> => setClockTo(simAt(day, hhmm));

/** What the worker's clock reads now (it runs at wall speed from the last set). */
export async function workerNow(): Promise<Date> {
  const response = await fetch(`${WORKER_URL}/sandbox/clock`);
  assert(response.ok, `worker GET /sandbox/clock → ${response.status}`);
  const body = (await response.json()) as { now?: unknown };
  assert(typeof body.now === "string", `worker clock answered ${show(body)}`);
  return new Date(body.now);
}

/** Puts the worker back on the wall clock so the M1–M5 smokes keep working after this run. */
export async function resetClock(): Promise<void> {
  await workerPostRaw("/sandbox/clock", { now: new Date().toISOString() }).catch(() => undefined);
}

/* ---------- Stripe, through the worker's own webhook and sandbox pages ---------- */

export interface Reply {
  readonly status: number;
  readonly json: Readonly<Record<string, unknown>>;
  readonly text: string;
  readonly location: string | null;
}

const objectOf = (text: string): Readonly<Record<string, unknown>> => {
  try {
    const parsed: unknown = JSON.parse(text);
    return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
};

async function reply(response: Response): Promise<Reply> {
  const text = await response.text();
  return { status: response.status, json: objectOf(text), text: text.slice(0, 2000), location: response.headers.get("location") };
}

/** `stripe-signature` for the exact bytes, timed on the worker's clock (the webhook's 300 s tolerance reads that clock). */
export const stripeSignature = async (body: string): Promise<string> => signSandboxWebhook(body, STRIPE_SECRET, await workerNow());

export async function postStripeWebhook(body: string, signature: string): Promise<Reply> {
  return reply(await workerPostRaw("/webhooks/stripe", body, { "stripe-signature": signature }));
}

/** One button on a sandbox checkout or portal page: a form POST; the worker signs the events and posts its own webhook first. */
export async function pressSandboxButton(url: string): Promise<Reply> {
  const response = await fetch(url, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "", redirect: "manual" });
  const r = await reply(response);
  check(r.status < 400, `POST ${url}`, "a page or a redirect (< 400)", { status: r.status, body: r.text });
  return r;
}

/* ---------- Inngest: events in, function outputs back (the Dev Server's API) ---------- */

export async function send(name: string, data: Record<string, unknown>): Promise<string> {
  const { ids } = await inngest.send({ name, data });
  const id = ids[0];
  assert(id, `inngest.send(${name}) returned no event id`);
  return id;
}

async function gql<T>(query: string): Promise<T | null> {
  const response = await fetch(`${INNGEST_BASE_URL}/v0/gql`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ query }) });
  if (!response.ok) return null;
  const body = (await response.json()) as { data?: T };
  return body.data ?? null;
}

const ULID = /^[0-9A-HJKMNP-TV-Z]{26}$/;
const FINISHED = new Set(["COMPLETED", "FAILED", "CANCELLED"]);

export interface RunResult {
  readonly fn: string;
  readonly status: string;
  /** The function's return value (the `RunComplete` op's data); null while unknown. */
  readonly output: unknown;
}

/** A run's stored output is either the value or the SDK's op list ending in `RunComplete`. */
function returnValue(raw: unknown): unknown {
  if (typeof raw !== "string" || raw.length === 0) return null;
  const parsed = objectOrValue(raw);
  if (!Array.isArray(parsed)) return parsed;
  const done = parsed.find((op): op is { op: string; data?: unknown } => op !== null && typeof op === "object" && (op as { op?: unknown }).op === "RunComplete");
  return done?.data ?? parsed;
}

const objectOrValue = (raw: string): unknown => {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return raw;
  }
};

type EventRuns = { event: { functionRuns: { id: string; status: string; function: { slug: string } }[] | null } | null };

/** Waits until every function the event triggered has finished and returns each one's status and return value. */
export async function runsOf(label: string, eventId: string, timeoutMs = 60_000): Promise<readonly RunResult[]> {
  assert(ULID.test(eventId), `not an Inngest event id: ${eventId}`);
  const runs = await until(
    `${label}: the runs of event ${eventId} to finish`,
    async () => {
      const data = await gql<EventRuns>(`query { event(query: { eventId: "${eventId}" }) { functionRuns { id status function { slug } } } }`);
      const list = data?.event?.functionRuns ?? [];
      return list.length > 0 && list.every((r) => FINISHED.has(r.status)) ? list : null;
    },
    { timeoutMs, intervalMs: 500 },
  );
  const results: RunResult[] = [];
  for (const run of runs) {
    assert(ULID.test(run.id), `not an Inngest run id: ${run.id}`);
    const detail = await gql<{ run: { status: string; output: unknown } | null }>(`query { run(runID: "${run.id}") { status output } }`);
    results.push({ fn: run.function.slug, status: run.status, output: returnValue(detail?.run?.output) });
  }
  return Object.freeze(results);
}

/** The run outputs as one string, for "returns skipped: …" style checks. */
export const outputsText = (runs: readonly RunResult[]): string => runs.map((r) => `${r.fn}:${r.status}:${show(r.output)}`).join(" | ");

export interface SeenEvent {
  readonly name: string;
  readonly data: Readonly<Record<string, unknown>>;
  readonly ts: number;
}

/** Events of one name the Dev Server received at or after `sinceMs` (wall clock). */
export async function eventsSince(name: string, sinceMs: number): Promise<readonly SeenEvent[]> {
  const response = await fetch(`${INNGEST_BASE_URL}/v1/events?name=${encodeURIComponent(name)}&limit=100`);
  if (!response.ok) return [];
  const body = (await response.json()) as { data?: { name?: unknown; data?: unknown; ts?: unknown }[] };
  return Object.freeze(
    (body.data ?? [])
      .filter((e) => typeof e.ts === "number" && e.ts >= sinceMs && e.data !== null && typeof e.data === "object")
      .map((e) => ({ name: String(e.name), data: e.data as Record<string, unknown>, ts: e.ts as number })),
  );
}

/* ---------- the cron guard ---------- */

const SCAN_HOURS = [0, 6, 12, 18] as const;

/** The next `scan-signals` cron (minute 17 of the UTC hours 0, 6, 12 and 18, wall clock) at or after two minutes ago. */
function nextScan(now: Date): number {
  const base = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const slots = [0, 1].flatMap((d) => SCAN_HOURS.map((h) => base + d * DAY_MS + (h * 60 + 17) * 60_000));
  return slots.find((t) => t >= now.getTime() - 120_000) ?? base + DAY_MS;
}

/**
 * How long to wait before starting, 0 when nothing is due: the six-hourly
 * scan would open signal cards for the two companies while they still run
 * (phases 1–6), and the hourly `entitlements-tick` (`23 * * * *`) would end
 * the owner's trial, which the simulated clock has already passed, before
 * the Pro subscription lands (phases 1–2).
 */
export function cronWaitMs(now: Date): number {
  const untilScan = nextScan(now) - now.getTime();
  if (untilScan <= SCAN_GUARD_MS) return Math.max(0, untilScan) + 120_000;
  const minute = now.getUTCMinutes();
  if (minute >= 19 && minute <= 23) return ((24 - minute) * 60 - now.getUTCSeconds()) * 1000 + 30_000;
  return 0;
}

export async function avoidCrons(): Promise<void> {
  for (let wait = cronWaitMs(new Date()); wait > 0; wait = cronWaitMs(new Date())) {
    console.log(`smoke M6: waiting ${Math.ceil(wait / 1000)} s for the scan-signals / entitlements-tick cron to pass`);
    await sleep(wait);
  }
}

/* ---------- the run's state and the checkpoint ---------- */

export interface Company {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
}

export interface Tally {
  readonly actions: number;
  readonly ledger: number;
  readonly billingEvents: number;
  readonly creditEntries: number;
}

export interface Ctx {
  readonly ownerId: string;
  readonly owner: DbClient;
  readonly c1: Company;
  readonly c2: Company | null;
  readonly tally: readonly Tally[];
  /** Entitlement statuses in the order the run saw them. */
  readonly transitions: readonly string[];
  /** Plan items the committed contracts cannot satisfy: recorded, and the run fails at the end after cleanup. */
  readonly unmet: readonly string[];
  readonly facts: Readonly<Record<string, string | number>>;
}

export const companiesOf = (ctx: Pick<Ctx, "c1" | "c2">): readonly Company[] => (ctx.c2 ? [ctx.c1, ctx.c2] : [ctx.c1]);

/** Appends the status when it differs from the last one seen. */
export const observe = (ctx: Ctx, status: string): Ctx => (ctx.transitions[ctx.transitions.length - 1] === status ? ctx : { ...ctx, transitions: [...ctx.transitions, status] });

export const withFacts = (ctx: Ctx, facts: Readonly<Record<string, string | number>>): Ctx => ({ ...ctx, facts: { ...ctx.facts, ...facts } });

/** A plan item the contracts cannot meet: logged now, failed at the end, so the later phases still run and report. */
export function softCheck(ctx: Ctx, condition: boolean, label: string, expected: string, found: unknown): Ctx {
  if (condition) return ctx;
  const line = `${label}: expected ${expected}, found ${show(found)}`;
  console.warn(`smoke M6: UNMET ${line}`);
  return { ...ctx, unmet: [...ctx.unmet, line] };
}

/** Rows of `table` whose `column` is the value or one of the values (service role). */
export async function countRows(table: string, column: string, value: string | readonly string[]): Promise<number> {
  const query = loose.from(table).select("*", { count: "exact", head: true });
  const { count, error } = await (typeof value === "string" ? query.eq(column, value) : query.in(column, [...value]));
  assert(!error, `could not count ${table}: ${error?.message}`);
  return count ?? 0;
}

export async function counts(ctx: Pick<Ctx, "ownerId" | "c1" | "c2">): Promise<Tally> {
  const ids = companiesOf(ctx).map((c) => c.id);
  const [actions, ledger, billingEvents, creditEntries] = await Promise.all([
    countRows("actions", "company_id", ids),
    countRows("ledger_entries", "company_id", ids),
    countRows("billing_events", "user_id", ctx.ownerId),
    countRows("credit_entries", "user_id", ctx.ownerId),
  ]);
  return { actions, ledger, billingEvents, creditEntries };
}

/** `select day, count(*) from decision_cards where company_id = … group by day`. */
export async function cardsPerDay(companyId: string): Promise<Readonly<Record<string, number>>> {
  const { data, error } = await db.from("decision_cards").select("day").eq("company_id", companyId);
  assert(!error, `could not read decision_cards: ${error?.message}`);
  return Object.freeze((data ?? []).reduce<Record<string, number>>((acc, row) => ({ ...acc, [row.day]: (acc[row.day] ?? 0) + 1 }), {}));
}

/**
 * Every phase ends here: `actions`, `ledger_entries`, `billing_events` and
 * `credit_entries` never shrink, no company holds more than the quota on a
 * local day, and no signal exists (only the phase 6 scan runs, while the
 * subscription has ended, and it inserts nothing).
 */
export async function checkpoint(ctx: Ctx, phase: number): Promise<Ctx> {
  const now = await counts(ctx);
  const last = ctx.tally[ctx.tally.length - 1];
  const grew = !last || (now.actions >= last.actions && now.ledger >= last.ledger && now.billingEvents >= last.billingEvents && now.creditEntries >= last.creditEntries);
  check(grew, `phase ${phase} append-only`, `every count ≥ ${show(last)}`, now);
  for (const company of companiesOf(ctx)) {
    const perDay = await cardsPerDay(company.id);
    check(Math.max(0, ...Object.values(perDay)) <= QUOTA, `phase ${phase} quota (${company.slug})`, `max(cards per day) ≤ ${QUOTA}`, perDay);
  }
  const signals = await countRows("signals", "company_id", companiesOf(ctx).map((c) => c.id));
  check(signals === 0, `phase ${phase} signals`, "none (a six-hourly scan-signals cron during the run opens extra cards; rerun outside its window)", signals);
  console.log(`smoke M6: phase ${phase} ok (${show(now)})`);
  return { ...ctx, tally: [...ctx.tally, now] };
}
