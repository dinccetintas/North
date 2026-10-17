const LOOPBACK_HOSTS: ReadonlySet<string> = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);

/**
 * Whether a bind host keeps the worker on this machine: the only place the
 * sandbox simulation routes (M4 review L4) and the sandbox default Sentry
 * secret (M5 review M1) may exist.
 */
export const isLoopbackHost = (host: string): boolean => LOOPBACK_HOSTS.has(host.trim().toLowerCase());

/** Whether a URL names a loopback host (any scheme, any port); false for anything that is not a URL. */
export function isLoopbackUrl(value: string): boolean {
  if (!URL.canParse(value)) return false;
  return isLoopbackHost(new URL(value).hostname);
}

/** The worker's own base URL on its bind (an IPv6 host in brackets): the sandbox billing pages post to its webhook, and sandbox unsubscribe links point at it. */
export function selfBaseUrl(env: { readonly WORKER_HOST: string; readonly WORKER_PORT: number }): string {
  const host = env.WORKER_HOST.includes(":") && !env.WORKER_HOST.startsWith("[") ? `[${env.WORKER_HOST}]` : env.WORKER_HOST;
  return `http://${host}:${env.WORKER_PORT}`;
}
