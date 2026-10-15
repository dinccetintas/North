import { NotConfiguredError } from "../errors";
import type { ScanInput, SignalSource } from "../types";
import type { SignalCandidate } from "@north/core";

/** M5 scope decision: Product Hunt's API is GraphQL behind a developer token, a key the founder enters later. */
export const PRODUCTHUNT_NOT_CONFIGURED = "Product Hunt is not available yet: its API is GraphQL behind a developer token (a key the founder enters later); the sandbox source stands in until then";

/** Interface-complete stub; the scan logs the error and moves to the next source. */
export class ProductHuntSignals implements SignalSource {
  readonly id = "producthunt" as const;

  async scan(_input: ScanInput): Promise<readonly SignalCandidate[]> {
    throw new NotConfiguredError(PRODUCTHUNT_NOT_CONFIGURED);
  }
}
