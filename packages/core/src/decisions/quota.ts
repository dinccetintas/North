import type { CardDraft } from "./types";
import { tierRank } from "../tiers";

export interface QuotaPlan {
  /** Cards to open today, in priority order; never more than the free slots. */
  readonly open: readonly CardDraft[];
  /** Cards folded into an opened card with the same mergeKey. */
  readonly merged: readonly CardDraft[];
  /** Cards pushed to the next day. */
  readonly deferred: readonly CardDraft[];
}

/** Higher is more urgent: tier first, then cost, then earliest due. */
export function priorityScore(card: CardDraft): number {
  const due = Date.parse(card.dueAt);
  const dueScore = Number.isFinite(due) ? 1 / Math.max(1, due) : 0;
  return tierRank(card.tier) * 1_000_000 + Math.min(card.costUsd, 999_999) + dueScore;
}

/**
 * Enforces the daily decision quota (DEC-3).
 *
 * Given candidate cards and the number already opened today, returns which to
 * open, which to merge into an opened sibling, and which to defer. No card is
 * ever dropped; the total of open + merged + deferred equals the input.
 */
export function planCards(
  candidates: readonly CardDraft[],
  input: { readonly quota: number; readonly openedToday: number },
): QuotaPlan {
  const freeSlots = Math.max(0, input.quota - input.openedToday);
  const sorted = [...candidates].sort((a, b) => priorityScore(b) - priorityScore(a));

  const open: CardDraft[] = [];
  const merged: CardDraft[] = [];
  const deferred: CardDraft[] = [];

  for (const card of sorted) {
    const sibling = open.find((c) => c.mergeKey === card.mergeKey && c.tier !== "K3" && card.tier !== "K3");
    if (sibling) {
      merged.push(card);
    } else if (open.length < freeSlots) {
      open.push(card);
    } else {
      deferred.push(card);
    }
  }

  return Object.freeze({ open: Object.freeze(open), merged: Object.freeze(merged), deferred: Object.freeze(deferred) });
}
