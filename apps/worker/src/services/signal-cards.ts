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

/** `deferred` rows first (oldest first: they already waited a day), then `scored` rows at or above the threshold, best score first. */
export async function conversionCandidates(deps: WorkerDeps, companyId: string): Promise<readonly SignalRecord[]> {
  const deferred = [...(await listSignals(deps.db, companyId, { status: ["deferred"], limit: 50 }))].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const scored = (await listSignals(deps.db, companyId, { status: ["scored"], limit: 50 })).filter((s) => s.score >= SIGNAL_THRESHOLD).sort((a, b) => b.score - a.score);
  return Object.freeze([...deferred, ...scored]);
}

/** PRO-3-CAP: whether the week still has room for an opportunity card (the database's partial unique index backs this). */
async function weekHasRoom(deps: WorkerDeps, companyId: string, week: string): Promise<boolean> {
  const opened = await listSignals(deps.db, companyId, { kind: ["opportunity"], cardWeek: week, limit: 10 });
  return signalCardAllowed(opened.map((s) => ({ kind: s.kind, cardWeek: s.cardWeek })), week);
}

/**
 * Opens the card for one signal through the gate (`signal.pursue`, K2,
 * `origin: worker`): the week is reserved on the row first so the database
 * refuses a second opportunity card before any card consumes the quota
 * (`SignalCapError` → `capped`); a spent quota defers the row (retried by
 * the next scan, never a second signal row); a block declines it.
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
  const existing = (await listActionsByKind(db, signal.companyId, "signal.pursue", 30)).filter((a) => a.status === "pending" && a.decisionCardId !== null);
  const gated = await gateStandalone(deps, signalPursueSpec(signal), existing);
  if (gated.kind === "card") {
    await updateSignal(db, signal.companyId, signal.id, { status: "card_opened", convertedCardId: gated.cardId, cardWeek: week });
    return { signalId: signal.id, status: "card_opened", cardId: gated.cardId };
  }
  if (gated.kind === "deferred") {
    await updateSignal(db, signal.companyId, signal.id, { status: "deferred", cardWeek: null });
    return { signalId: signal.id, status: "deferred", cardId: null };
  }
  // `blocked` (the kill switch, a refused kind): the signal is declined with the gate's reason in the action row, never retried.
  await updateSignal(db, signal.companyId, signal.id, { status: "declined", cardWeek: null });
  return { signalId: signal.id, status: "declined", cardId: null };
}

/**
 * Step 5 of a scan (PRO-1, PRO-3-CAP): at most `SIGNAL_CARDS_PER_SCAN` cards
 * per scan so one scan cannot empty the day's quota; an `opportunity` beyond
 * the week's cap is `capped` whatever the quota; `metric_drop` and `error`
 * rows are not under the weekly cap. Returns the cards opened (the function
 * emits `decision/opened` for each) and every status written.
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
      await updateSignal(deps.db, companyId, signal.id, { status: "capped" });
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
