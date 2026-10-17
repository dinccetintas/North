import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Playwright output (HTML reports with the trace viewer's bundled JS, failure artifacts): generated and gitignored.
    "playwright-report/**",
    "playwright-report-prod/**",
    "playwright-report-staging/**",
    "test-results/**",
  ]),
]);

export default eslintConfig;
