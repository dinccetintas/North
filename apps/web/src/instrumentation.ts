import type { Instrumentation } from "next";
import { sentryDsn } from "@/lib/env";

/** OBS-1: server Sentry when the public DSN is set; nothing is loaded otherwise. */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs" && sentryDsn()) await import("../sentry.server.config");
}

export const onRequestError: Instrumentation.onRequestError = async (error, request, context) => {
  if (!sentryDsn()) return;
  const { captureRequestError } = await import("@sentry/nextjs");
  captureRequestError(error, request, context);
};
