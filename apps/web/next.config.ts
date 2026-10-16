import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs/config";
import { SECURITY_HEADERS } from "./src/lib/security-headers";

const nextConfig: NextConfig = {
  reactCompiler: true,
  transpilePackages: ["@north/core", "@north/db", "@north/agents"],
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  images: {
    remotePatterns: [{ protocol: "https", hostname: "**.supabase.co" }],
  },
  async headers() {
    return [
      // Every response: no framing (clickjacking of a card), no sniffing, origin-only cross-site referrers.
      { source: "/:path*", headers: [...SECURITY_HEADERS] },
      {
        // PWA-1: the worker must always be revalidated so a new version (cache names, rules) takes over.
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Service-Worker-Allowed", value: "/" },
        ],
      },
    ];
  },
};

/**
 * OBS-1: Sentry wraps the build only when the public DSN is set. Source maps
 * upload needs SENTRY_AUTH_TOKEN, which lives in Vercel's build env only.
 */
const sentryEnabled = Boolean(process.env.NEXT_PUBLIC_SENTRY_DSN);

export default sentryEnabled
  ? withSentryConfig(nextConfig, {
      org: process.env.SENTRY_ORG,
      project: process.env.SENTRY_PROJECT,
      authToken: process.env.SENTRY_AUTH_TOKEN,
      silent: !process.env.CI,
      telemetry: false,
      sourcemaps: { disable: !process.env.SENTRY_AUTH_TOKEN },
    })
  : nextConfig;
