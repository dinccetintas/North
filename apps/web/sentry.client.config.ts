import * as Sentry from "@sentry/nextjs";
import { sentryDsn } from "./src/lib/env";
import { SENTRY_PRIVACY_OPTIONS } from "./src/lib/sentry-scrub";

/**
 * OBS-1: the web's browser Sentry, imported by `src/instrumentation-client.ts`
 * only when the public DSN is set (so the SDK is not in the bundle otherwise).
 * No personal data, no session replay, no typed input, no transactions.
 */
const dsn = sentryDsn(process.env.NEXT_PUBLIC_SENTRY_DSN);

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.NEXT_PUBLIC_VERCEL_ENV ?? process.env.NODE_ENV,
    // No personal data, no transactions (tracing off; M6 review L7): see SENTRY_PRIVACY_OPTIONS.
    ...SENTRY_PRIVACY_OPTIONS,
  });
}
