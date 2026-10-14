#!/usr/bin/env bash
# Applies the given migration files (or every file under packages/db/supabase/migrations
# newer than the schema when none are given) to the Docker-free stack's database and
# tells PostgREST to reload its schema cache. Idempotency is the migration's own job.
#
#   scripts/stack/migrate.sh packages/db/supabase/migrations/0005_m3.sql
set -euo pipefail
REPO="$(cd "$(dirname "$0")/../.." && pwd)"
DB_NAME="${NORTH_STACK_DB:-north}"
if [ "$(id -u)" = "0" ]; then pgsu() { su postgres -c "psql -v ON_ERROR_STOP=1 -q -d $DB_NAME $*"; }; else pgsu() { psql -v ON_ERROR_STOP=1 -q -d "$DB_NAME" "$@"; }; fi
[ "$#" -gt 0 ] || { echo "usage: $0 <migration.sql> [...]" >&2; exit 2; }
for f in "$@"; do
  echo "[stack] migration $(basename "$f")"
  cat "$REPO/$f" | pgsu
done
pgsu -c "\"notify pgrst, 'reload schema'\""
echo "[stack] PostgREST schema cache reloaded"
