#!/usr/bin/env bash
# One command that must be green before any milestone is called done.
set -euo pipefail
cd "$(dirname "$0")/.."

step() { printf '\n\033[1;34m==> %s\033[0m\n' "$1"; }

step "typecheck"; pnpm -r typecheck
step "lint";      pnpm -r lint
step "unit";      pnpm -r test

if docker info >/dev/null 2>&1 && (cd packages/db && npx supabase status >/dev/null 2>&1); then
  step "integration (local Supabase)"; pnpm --filter @north/db test:integration
else
  echo "skip: integration tests need Docker + 'pnpm db:start'" >&2
  if [ "${REQUIRE_INTEGRATION:-0}" = "1" ]; then exit 1; fi
fi

step "smoke"; pnpm smoke
printf '\n\033[1;32mvalidate: all green\033[0m\n'
