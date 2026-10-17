import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    /** `e2e/**\/*.test.ts`: unit tests of the browser suites' pure helpers (mail reader, live-journey rules); the `*.spec.ts` flows run under Playwright only. */
    include: ["src/**/*.test.{ts,tsx}", "e2e/**/*.test.ts"],
    exclude: ["e2e/**/*.spec.ts", "node_modules/**", ".next/**"],
    passWithNoTests: true,
  },
});
