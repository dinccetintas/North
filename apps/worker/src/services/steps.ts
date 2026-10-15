/**
 * The subset of Inngest's `step` the services need: each call is a durable,
 * memoised step, so a service can run "record pending → perform → record" as
 * three separate steps without depending on the Inngest SDK (ADR 0002).
 */
export interface StepRunner {
  run<T>(id: string, fn: () => Promise<T>): Promise<T>;
}

/** A runner that just runs; unit tests and scripts do not need memoisation. */
export const directSteps: StepRunner = { run: (_id, fn) => fn() };
