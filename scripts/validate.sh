#!/usr/bin/env bash
# One command that must be green before any milestone is called done.
set -euo pipefail
cd "$(dirname "$0")/.."

step() { printf '\n\033[1;34m==> %s\033[0m\n' "$1"; }
up() { node -e "fetch(process.argv[1],{signal:AbortSignal.timeout(3000)}).then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" "$1"; }

step "typecheck"; pnpm -r typecheck
step "lint";      pnpm -r lint
# Stack-bound worker tests (apps/worker/test/purge.test.ts) skip here when the stack is not in the env; they run, required, in the integration step.
step "unit";      REQUIRE_INTEGRATION=0 pnpm -r test
step "unit (scripts)"; pnpm test:scripts

stack_reachable() {
  [ -n "${SUPABASE_SERVICE_ROLE_KEY:-}" ] && curl -fsS -o /dev/null "${SUPABASE_URL:-http://127.0.0.1:54321}/rest/v1/" -H "apikey: $SUPABASE_SERVICE_ROLE_KEY"
}
# The worker's integration tests read the stack from the env only; fill it from `supabase status` when Docker holds it.
stack_env() {
  if [ -z "${SUPABASE_SERVICE_ROLE_KEY:-}" ]; then
    local status
    status="$(cd packages/db && npx supabase status -o env 2>/dev/null || true)"
    SUPABASE_URL="$(printf '%s\n' "$status" | sed -n 's/^API_URL="\{0,1\}\([^"]*\)"\{0,1\}$/\1/p' | head -1)"
    SUPABASE_SERVICE_ROLE_KEY="$(printf '%s\n' "$status" | sed -n 's/^\(SERVICE_ROLE_KEY\|SECRET_KEY\)="\{0,1\}\([^"]*\)"\{0,1\}$/\2/p' | head -1)"
    export SUPABASE_URL SUPABASE_SERVICE_ROLE_KEY
  fi
}
if stack_reachable || (docker info >/dev/null 2>&1 && (cd packages/db && npx supabase status >/dev/null 2>&1)); then
  step "integration (local Supabase)"; pnpm --filter @north/db test:integration
  stack_env
  step "integration (worker: the purge against the stack)"; REQUIRE_INTEGRATION=1 pnpm --filter @north/worker exec vitest run test/purge.test.ts
else
  echo "skip: integration tests need Docker + 'pnpm db:start' (or 'source .stack/env' after scripts/stack/up.sh)" >&2
  if [ "${REQUIRE_INTEGRATION:-0}" = "1" ]; then exit 1; fi
fi

step "smoke (domain)"; pnpm smoke

if up http://localhost:3101/health && up http://localhost:8288; then
  step "smoke M1 (worker + inngest + supabase)"; pnpm smoke:m1
  step "smoke M2 (decision layer)"; pnpm smoke:m2
  step "smoke M3 (build pipeline)"; pnpm smoke:m3
  step "smoke M4 (growth, sales, ledger)"; pnpm smoke:m4
  step "smoke M5 (proactive layer, seven simulated days)"; pnpm smoke:m5
  step "smoke M6 (subscription and launch, ten phases)"; pnpm smoke:m6
else
  echo "skip: smoke M1 needs the worker (:3101) and the Inngest Dev Server (:8288); run 'pnpm dev'" >&2
  if [ "${REQUIRE_SMOKE_M1:-0}" = "1" ]; then exit 1; fi
fi

printf '\n\033[1;32mvalidate: all green\033[0m\n'
