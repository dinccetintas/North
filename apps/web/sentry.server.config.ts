import * as Sentry from "@sentry/nextjs";
import { sentryDsn } from "./src/lib/env";
import { SENTRY_PRIVACY_OPTIONS } from "./src/lib/sentry-scrub";

/**
 * OBS-1: the web's server-side Sentry, loaded by `src/instrumentation.ts`.
 * Off without the public DSN; no personal data in events or breadcrumbs,
 * and no transactions (their URLs and spans carry query strings).
 */
const dsn = sentryDsn(process.env.NEXT_PUBLIC_SENTRY_DSN);

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV,
    // No personal data, no transactions (tracing off; M6 review L7): see SENTRY_PRIVACY_OPTIONS.
    ...SENTRY_PRIVACY_OPTIONS,
  });
}
