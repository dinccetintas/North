/** A live adapter was selected but its keys are missing or the provider is not implemented yet. */
export class NotConfiguredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NotConfiguredError";
  }
}

/** Secrets shorter than this are not real tokens; redacting them would only mangle the message. */
const MIN_SECRET_LENGTH = 8;

/** Replaces every occurrence of `secret` in `text`, so a provider error that echoes a token never reaches a log. */
export function redactSecret(text: string, secret: string): string {
  return secret.length >= MIN_SECRET_LENGTH ? text.split(secret).join("[redacted]") : text;
}

/** The provider answered with an error. The message never contains credentials. */
export class ProviderError extends Error {
  constructor(
    readonly provider: string,
    message: string,
    override readonly cause?: unknown,
  ) {
    super(`${provider}: ${message}`);
    this.name = "ProviderError";
  }
}

/** A Stripe `error.code` (or a sandbox code) is lowercase letters, digits and underscores; anything else is not echoed. */
const BILLING_CODE = /^[a-z0-9_]{1,80}$/;

/**
 * The billing provider refused or failed (BIL-1). It carries the provider's
 * machine code (`card_declined`, `resource_missing`, `http_500`) and the
 * HTTP status only: never the response body, never the key. The worker maps
 * it to a fixed message on the session row.
 */
export class BillingProviderError extends ProviderError {
  readonly code: string;

  constructor(
    code: string,
    readonly status: number | null = null,
    operation = "",
  ) {
    const safe = BILLING_CODE.test(code) ? code : "unknown";
    super("stripe", operation ? `${operation} → ${status ?? "-"} ${safe}` : safe);
    this.code = safe;
    this.name = "BillingProviderError";
  }
}
