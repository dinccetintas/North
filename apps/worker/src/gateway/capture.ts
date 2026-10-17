// SEC-1: a bounded copy of a reply, for recording it and for reading the usage
// of a non-streaming one (a stream is priced as it goes by, see `sse.ts`). Past
// the limit it stops keeping bytes (the reply itself still streams on), so one
// huge reply cannot exhaust the worker's memory.

/** Collects chunks up to `limit` bytes in total. */
export interface Capture {
  add(chunk: Buffer): void;
  /** Everything collected, or null once the limit was passed. */
  result(): Buffer | null;
}

/** A new, empty capture. */
export function createCapture(limit: number): Capture {
  const chunks: Buffer[] = [];
  let size = 0;
  let overflowed = false;
  return {
    add(chunk) {
      if (overflowed) return;
      size += chunk.length;
      if (size > limit) {
        overflowed = true;
        chunks.length = 0;
        return;
      }
      chunks.push(chunk);
    },
    result: () => (overflowed ? null : Buffer.concat(chunks)),
  };
}
