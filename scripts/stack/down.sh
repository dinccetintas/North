#!/usr/bin/env bash
# Stops every process scripts/stack/up.sh started (PostgreSQL itself stays up).
set -uo pipefail
STACK="$(cd "$(dirname "$0")/../.." && pwd)/.stack"
[ -f "$STACK/pids" ] || { echo "[stack] nothing to stop"; exit 0; }
while read -r pid; do
  [ -n "$pid" ] && kill "$pid" 2>/dev/null && echo "[stack] stopped $pid"
done <"$STACK/pids"
: >"$STACK/pids"
