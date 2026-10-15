import { z } from "zod";

/**
 * The worker has one clock (ADR 0011). Every time-dependent decision (brief
 * hour, scan window, card `opened_at` and `dueAt`, overdue defaults, plan
 * week, metric day) reads `deps.clock()`. In production it is the wall clock;
 * in sandbox mode on a loopback host the harness may move it through
 * `POST /sandbox/clock { now }`, so a 7-day run takes minutes.
 */
export type Clock = () => Date;

export const wallClock: Clock = () => new Date();

const IsoSchema = z.iso.datetime({ offset: true });

/** A clock that runs at wall speed from an offset the harness sets; `set` never stops it, so timings inside a day stay real. */
export class SimClock {
  private offset = 0;

  constructor(start?: string) {
    if (start !== undefined) this.set(start);
  }

  /** The current simulated instant: wall time plus the offset. */
  now(): Date {
    return new Date(Date.now() + this.offset);
  }

  /** Moves the clock so that `now()` reads `iso` at this moment; refuses anything that is not an ISO datetime. */
  set(iso: string): Date {
    const parsed = IsoSchema.parse(iso);
    this.offset = Date.parse(parsed) - Date.now();
    return this.now();
  }

  /** How far the simulated time is from the wall clock, in milliseconds (0 = wall clock). */
  get offsetMs(): number {
    return this.offset;
  }
}
