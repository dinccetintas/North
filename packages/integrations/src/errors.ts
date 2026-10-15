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
