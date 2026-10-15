import { SIGNAL_CARDS_PER_SCAN, SIGNAL_THRESHOLD, isoWeek, signalCardAllowed, signalPursueSpec, type SignalStatus } from "@north/core";
import { SignalCapError, listActionsByKind, listSignals, updateSignal, type SignalRecord } from "@north/db";
import type { WorkerDeps } from "../deps";
import { gateStandalone } from "./actions";

export interface ConvertedSignal {
  readonly signalId: string;
  readonly status: SignalStatus;
  readonly cardId: string | null;
}

export interface ConvertResult {
  readonly cardsOpened: readonly string[];
  readonly signals: readonly ConvertedSignal[];
}

const NONE: ConvertResult = Object.freeze({ cardsOpened: Object.freeze([]), signals: Object.freeze([]) });

/** The kinds a scan converts into `signal.pursue` cards; `error` rows are the fix pipeline's (a deferred one waits for its day, M5 review M5). */
const CARD_KINDS = ["opportunity", "metric_drop"] as const;

/** Statuses of a row that actually holds its week's card (M5 review M2): a bare reservation (`scored` with the week set) does not. */
const HOLDS_CARD: ReadonlySet<SignalStatus> = new Set(["card_opened", "approved", "declined"]);

/** `deferred` rows first (oldest first: they already waited a day), then `scored` rows at or above the threshold, best score first. */
export async function conversionCandidates(deps: WorkerDeps, companyId: string): Promise<readonly SignalRecord[]> {
  const deferred = [...(await listSignals(deps.db, companyId, { status: ["deferred"], kind: CARD_KINDS, limit: 50 }))].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const scored = (await listSignals(deps.db, companyId, { status: ["scored"], kind: CARD_KINDS, limit: 50 })).filter((s) => s.score >= SIGNAL_THRESHOLD).sort((a, b) => b.score - a.score);
  return Object.freeze([...deferred, ...scored]);
}

/** PRO-3-CAP: whether the week still has room for an opportunity card: only rows that hold a card count (the database's partial unique index backs this). */
async function weekHasRoom(deps: WorkerDeps, companyId: string, week: string): Promise<boolean> {
  const rows = await listSignals(deps.db, companyId, { kind: ["opportunity"], cardWeek: week, limit: 10 });
  const holding = rows.filter((s) => s.convertedCardId !== null || HOLDS_CARD.has(s.status));
  return signalCardAllowed(holding.map((s) => ({ kind: s.kind, cardWeek: s.cardWeek })), week);
}

/** The gate for one reserved signal: card → `card_opened`; quota spent → `deferred`; blocked (the kill switch, a refused kind) → `declined`, never retried. */
async function gateReserved(deps: WorkerDeps, signal: SignalRecord, week: string): Promise<ConvertedSignal> {
  const { db } = deps;
  const existing = (await listActionsByKind(db, signal.companyId, "signal.pursue", 30)).filter((a) => a.status === "pending" && a.decisionCardId !== null);
  const gated = await gateStandalone(deps, signalPursueSpec(signal), existing);
  if (gated.kind === "card") {
    await updateSignal(db, signal.companyId, signal.id, { status: "card_opened", convertedCardId: gated.cardId, cardWeek: week });
    return { signalId: signal.id, status: "card_opened", cardId: gated.cardId };
  }
  const status = gated.kind === "deferred" ? "deferred" : "declined";
  await updateSignal(db, signal.companyId, signal.id, { status, cardWeek: null });
  return { signalId: signal.id, status, cardId: null };
}

/**
 * Opens the card for one signal through the gate (`signal.pursue`, K2,
 * `origin: worker`): the week is reserved on the row first so the database
 * refuses a second opportunity card before any card consumes the quota
 * (`SignalCapError` → `capped`). Anything that throws after the reservation
 * releases it before rethrowing, so no week stays held by a row without a
 * card (M5 review M2).
 */
async function convertOne(deps: WorkerDeps, signal: SignalRecord, week: string): Promise<ConvertedSignal> {
  const { db } = deps;
  try {
    await updateSignal(db, signal.companyId, signal.id, { cardWeek: week });
  } catch (error) {
    if (!(error instanceof SignalCapError)) throw error;
    await updateSignal(db, signal.companyId, signal.id, { status: "capped", cardWeek: null });
    return { signalId: signal.id, status: "capped", cardId: null };
  }
  try {
    return await gateReserved(deps, signal, week);
  } catch (error) {
    await updateSignal(db, signal.companyId, signal.id, { cardWeek: null });
    throw error;
  }
}

/**
 * Step 5 of a scan (PRO-1, PRO-3-CAP): at most `SIGNAL_CARDS_PER_SCAN` cards
 * per scan so one scan cannot empty the day's quota; an `opportunity` beyond
 * the week's cap is `capped` whatever the quota; `metric_drop` rows are not
 * under the weekly cap. Returns the cards opened (the function emits
 * `decision/opened` for each) and every status written.
 */
export async function convertSignals(deps: WorkerDeps, companyId: string, day: string): Promise<ConvertResult> {
  const candidates = await conversionCandidates(deps, companyId);
  if (candidates.length === 0) return NONE;
  const week = isoWeek(day);
  let room = await weekHasRoom(deps, companyId, week);
  const cardsOpened: string[] = [];
  const signals: ConvertedSignal[] = [];
  for (const signal of candidates) {
    if (signal.kind === "opportunity" && !room) {
      await updateSignal(deps.db, companyId, signal.id, { status: "capped", cardWeek: null });
      signals.push({ signalId: signal.id, status: "capped", cardId: null });
      continue;
    }
    if (cardsOpened.length >= SIGNAL_CARDS_PER_SCAN) continue;
    const converted = await convertOne(deps, signal, week);
    signals.push(converted);
    if (converted.cardId) cardsOpened.push(converted.cardId);
    if (converted.cardId && signal.kind === "opportunity") room = false;
  }
  return Object.freeze({ cardsOpened: Object.freeze(cardsOpened), signals: Object.freeze(signals) });
}
