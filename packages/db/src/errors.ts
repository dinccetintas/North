/** Error thrown by every repository function when a query fails or returns nothing usable. */
export class DbError extends Error {
  constructor(
    message: string,
    override readonly cause?: unknown,
  ) {
    super(message);
    this.name = "DbError";
  }
}

const messageOf = (error: unknown): string => {
  if (error && typeof error === "object" && "message" in error) {
    return String((error as { message: unknown }).message);
  }
  return error ? String(error) : "no row returned";
};

/** Builds a `DbError` with a human-readable context prefix and the raw cause attached. */
export function dbError(context: string, error: unknown): DbError {
  return new DbError(`${context}: ${messageOf(error)}`, error);
}
