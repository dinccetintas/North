/**
 * OBS-1: the browser Sentry loads only when the public DSN was set at build
 * time; without it this file is empty in effect and the SDK stays out of the
 * bundle the home screen downloads.
 */
if (process.env.NEXT_PUBLIC_SENTRY_DSN) {
  void import("../sentry.client.config");
}
