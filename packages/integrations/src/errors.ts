/** A live adapter was selected but its keys are missing or the provider is not implemented yet. */
export class NotConfiguredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NotConfiguredError";
  }
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
