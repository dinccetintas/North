const LOOPBACK_HOSTS: ReadonlySet<string> = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);

/**
 * Whether a bind host keeps the worker on this machine: the only place the
 * sandbox simulation routes (M4 review L4) and the sandbox default Sentry
 * secret (M5 review M1) may exist.
 */
export const isLoopbackHost = (host: string): boolean => LOOPBACK_HOSTS.has(host.trim().toLowerCase());
