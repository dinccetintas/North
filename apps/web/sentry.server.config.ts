import * as Sentry from "@sentry/nextjs";
import { sentryDsn } from "./src/lib/env";
import { scrubBreadcrumb, scrubEvent } from "./src/lib/sentry-scrub";

/**
 * OBS-1: the web's server-side Sentry, loaded by `src/instrumentation.ts`.
 * Off without the public DSN; no personal data in events or breadcrumbs.
 */
const dsn = sentryDsn(process.env.NEXT_PUBLIC_SENTRY_DSN);

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV,
    sendDefaultPii: false,
    tracesSampleRate: 0.1,
    beforeSend: (event) => scrubEvent(event),
    beforeBreadcrumb: (breadcrumb) => scrubBreadcrumb(breadcrumb),
  });
}
