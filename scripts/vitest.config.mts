import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/** Unit tests of the repo scripts (`pnpm test:scripts`, a `pnpm validate` step): pure checks against fakes, no stack, no network. */
const here = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: here,
  cacheDir: `${here}/../node_modules/.vite/scripts`,
  test: {
    include: ["*.test.ts", "**/*.test.ts"],
    exclude: ["**/node_modules/**", "stack/**", "pg-verify/**"],
  },
});
