import { NotConfiguredError } from "../errors";
import type { ScanInput, SignalSource } from "../types";
import type { SignalCandidate } from "@north/core";

/** M5 scope decision: Google Trends has no official API, and scraping the widget endpoint violates its terms. */
export const GOOGLE_TRENDS_NOT_CONFIGURED = "Google Trends is not available: there is no official API and scraping the widget endpoint violates its terms; the sandbox source stands in";

/** Interface-complete stub; the scan logs the error and moves to the next source. */
export class GoogleTrendsSignals implements SignalSource {
  readonly id = "google_trends" as const;

  async scan(_input: ScanInput): Promise<readonly SignalCandidate[]> {
    throw new NotConfiguredError(GOOGLE_TRENDS_NOT_CONFIGURED);
  }
}
