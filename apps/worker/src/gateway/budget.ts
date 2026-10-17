// TST-1: the model gateway's per-UTC-day spend cap, as bookkeeping over the
// pure TestRunBudget guard in @north/core. The gateway, not convention, is what
// keeps a staging worker or a CI run under its cap.
import { applyTestSpend, remainingTestUsd, rollDay, TestRunBudgetSchema, wouldExceedTestCap, type TestRunBudget } from "@north/core";

/** Under a nano-dollar left, the cap counts as reached (same noise floor as the guard). */
const NOISE_USD = 1e-9;

/** What the gateway reports about its budget. */
export interface GatewayBudgetStats {
  readonly capUsd: number;
  readonly spentUsd: number;
  /** Replies priced by guess (a model with no price, charged the dearest rate) or not at all (no readable usage, which closes the day under a cap). */
  readonly unpriced: number;
  readonly day: string;
  /** STG-1: what the boot seed (`initialSpentUsd`) put on today's spend; 0 without one and from the next UTC day on. Already inside `spentUsd`. */
  readonly seededUsd: number;
}

/** How a budget starts. */
export interface GatewayBudgetOptions {
  /**
   * STG-1: spend already made today before this process started (the worker
   * seeds it from `agent_runs` at boot), so a restart, a wake from auto-stop or
   * a deploy does not hand out a second allowance. Counts on the boot's UTC
   * day only. A finite number of USD, 0 or more (default 0).
   */
  readonly initialSpentUsd?: number;
}

const utcDay = (date: Date): string => date.toISOString().slice(0, 10);

/**
 * The day's spend against a cap. Every call first rolls to the clock's UTC day
 * (a later day resets the spend; a clock that steps back keeps it). A cap of 0
 * means unlimited. `TestRunBudget` values are immutable: each change is a new
 * frozen object.
 */
export class GatewayBudget {
  private current: TestRunBudget;
  private unpricedCount = 0;
  private exhausted: { readonly day: string; readonly reason: string } | null = null;
  private readonly seed: { readonly day: string; readonly usd: number };

  /** Throws when `capUsd` or `options.initialSpentUsd` is not a finite number of at least 0. */
  constructor(
    capUsd: number,
    private readonly clock: () => Date = () => new Date(),
    options: GatewayBudgetOptions = {},
  ) {
    const seedUsd = options.initialSpentUsd ?? 0;
    if (!Number.isFinite(seedUsd) || seedUsd < 0) throw new Error(`GatewayBudget: initialSpentUsd must be a finite number of USD, 0 or more (got ${String(seedUsd)})`);
    const parsed = TestRunBudgetSchema.safeParse({ capUsd, spentUsd: seedUsd, day: utcDay(clock()) });
    if (!parsed.success) throw new Error(`GatewayBudget: the cap must be a number of USD, 0 or more (got ${String(capUsd)})`);
    this.current = Object.freeze(parsed.data);
    this.seed = Object.freeze({ day: parsed.data.day, usd: seedUsd });
  }

  /** Today's budget (rolled to the clock's UTC day first). */
  get state(): TestRunBudget {
    return this.sync();
  }

  /**
   * Whether `estimateUsd` still fits under the day's cap, without spending it.
   * `reserve(0)` asks whether any budget is left: false once the spend has
   * reached the cap, or once `exhaust` has closed the day. An estimate that is
   * not a non-negative number is refused.
   */
  reserve(estimateUsd: number): boolean {
    if (!Number.isFinite(estimateUsd) || estimateUsd < 0) return false;
    const state = this.sync();
    if (this.exhausted?.day === state.day) return false;
    if (wouldExceedTestCap(state, estimateUsd)) return false;
    return !(state.capUsd > 0 && estimateUsd === 0 && remainingTestUsd(state) <= NOISE_USD);
  }

  /**
   * Adds the actual cost of a finished exchange to the day's spend. A cost that
   * is not a non-negative finite number (NaN for an unknown model) adds nothing
   * and counts as unpriced.
   */
  settle(actualUsd: number): void {
    const state = this.sync();
    if (!Number.isFinite(actualUsd) || actualUsd < 0) {
      this.unpricedCount += 1;
      return;
    }
    this.current = applyTestSpend(state, actualUsd);
  }

  /**
   * Adds a guess for a reply whose model has no price (the dearest rate, see
   * `costAtHighestRate`) to the day's spend and counts the reply as unpriced.
   * A guess that is not a non-negative finite number adds nothing.
   */
  settleUnpriced(estimateUsd: number): void {
    const state = this.sync();
    this.unpricedCount += 1;
    if (Number.isFinite(estimateUsd) && estimateUsd >= 0) this.current = applyTestSpend(state, estimateUsd);
  }

  /**
   * Fails closed when a reply cannot be priced at all: under a cap, the day is
   * closed, so `reserve` admits nothing more until the UTC day rolls, and
   * `exhaustion()` reports why. The spend is left as priced (the closing is
   * its own flag, never folded into `spentUsd`). Counts as unpriced. With no
   * cap there is nothing to close and it only counts. True when this call
   * closed the day (false when it was already closed, or there is no cap).
   */
  exhaust(reason: string): boolean {
    const state = this.sync();
    this.unpricedCount += 1;
    if (state.capUsd === 0) return false;
    if (this.exhausted?.day === state.day) return false;
    this.exhausted = Object.freeze({ day: state.day, reason });
    return true;
  }

  /** Why today is closed by `exhaust`, or null when it is not (a new UTC day clears it). */
  exhaustion(): string | null {
    const { day } = this.sync();
    return this.exhausted?.day === day ? this.exhausted.reason : null;
  }

  /** Cap, today's spend (the seed included), the unpriced count, the day and today's part of the boot seed. */
  stats(): GatewayBudgetStats {
    const { capUsd, spentUsd, day } = this.sync();
    return Object.freeze({ capUsd, spentUsd, unpriced: this.unpricedCount, day, seededUsd: this.seed.day === day ? this.seed.usd : 0 });
  }

  private sync(): TestRunBudget {
    this.current = rollDay(this.current, utcDay(this.clock()));
    return this.current;
  }
}
