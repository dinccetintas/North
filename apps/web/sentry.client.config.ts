import * as Sentry from "@sentry/nextjs";
import { sentryDsn } from "./src/lib/env";
import { scrubBreadcrumb, scrubEvent } from "./src/lib/sentry-scrub";

/**
 * OBS-1: the web's browser Sentry, imported by `src/instrumentation-client.ts`
 * only when the public DSN is set (so the SDK is not in the bundle otherwise).
 * No personal data, no session replay, no typed input.
 */
const dsn = sentryDsn(process.env.NEXT_PUBLIC_SENTRY_DSN);

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.NEXT_PUBLIC_VERCEL_ENV ?? process.env.NODE_ENV,
    sendDefaultPii: false,
    tracesSampleRate: 0.1,
    beforeSend: (event) => scrubEvent(event),
    beforeBreadcrumb: (breadcrumb) => scrubBreadcrumb(breadcrumb),
  });
}
