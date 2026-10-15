import { NotConfiguredError } from "../errors";
import type { PaymentsProvider, PaymentsSnapshot } from "../growth-types";
import type { ProviderAuth } from "../types";

/** M4 scope decision: the user's Stripe OAuth (read) belongs with the Stripe work in M6, and no M4 company has paying customers yet. */
export const STRIPE_READ_NOT_CONFIGURED = "Stripe read is not available yet: the user's Stripe OAuth belongs with the Stripe work in M6, and no M4 company has paying customers yet";

/** Interface-complete stub; the collector treats the error as "no payments data this window". */
export class StripeReadPayments implements PaymentsProvider {
  constructor(readonly auth: ProviderAuth | null = null) {}

  async read(_companyId: string): Promise<PaymentsSnapshot | null> {
    throw new NotConfiguredError(STRIPE_READ_NOT_CONFIGURED);
  }
}
