#!/usr/bin/env bash
# North local stack without Docker: PostgreSQL 16 + GoTrue + PostgREST +
# storage API + Mailpit behind a one-file gateway on :54321, the same URLs and
# key shapes `supabase start` provides. Used where Docker is unavailable
# (cloud sessions); with Docker, prefer `pnpm db:start`.
#
#   scripts/stack/up.sh [--reset]      start everything (reset drops the database)
#   scripts/stack/down.sh              stop everything
#   source .stack/env                  keys for pnpm test:integration / smoke / e2e
#
# Binaries are expected under $NORTH_STACK_TOOLS (default ~/tools):
#   postgrest/postgrest   auth/gotrue (+ auth/migrations)   mailpit/mailpit
#   storage-src/          (supabase/storage, built: dist/start/server.js; Node >= 24)
set -euo pipefail

REPO="$(cd "$(dirname "$0")/../.." && pwd)"
STACK="$REPO/.stack"
TOOLS="${NORTH_STACK_TOOLS:-$HOME/tools}"
NODE24="${NORTH_STACK_NODE24:-$(ls -d /opt/nvm/versions/node/v24*/bin/node 2>/dev/null | tail -1 || true)}"
NODE24="${NODE24:-node}"

DB_NAME="${NORTH_STACK_DB:-north}"
DB_HOST=127.0.0.1
DB_PORT=5432
JWT_SECRET="${NORTH_STACK_JWT_SECRET:-super-secret-jwt-token-with-at-least-32-characters-long}"
API_PORT=54321 REST_PORT=54329 AUTH_PORT=9999 STORAGE_PORT=5000 MAIL_HTTP_PORT=54324 MAIL_SMTP_PORT=54325
SITE_URL="${NEXT_PUBLIC_APP_URL:-http://localhost:3100}"
RESET=0
[ "${1:-}" = "--reset" ] && RESET=1

log() { printf '\033[1;34m[stack]\033[0m %s\n' "$*"; }
die() { printf '\033[1;31m[stack] %s\033[0m\n' "$*" >&2; exit 1; }
mkdir -p "$STACK/logs" "$STACK/storage"

# --- postgres (superuser via peer auth when root, else the current user) -----
if [ "$(id -u)" = "0" ]; then pgsu() { su postgres -c "psql -v ON_ERROR_STOP=1 -q $*"; }; else pgsu() { psql -v ON_ERROR_STOP=1 -q "$@"; }; fi
pg_lsclusters 2>/dev/null | grep -q online || { log "starting PostgreSQL cluster"; pg_ctlcluster 16 main start; sleep 2; }

SHAREDIR="$(pg_config --sharedir 2>/dev/null || echo /usr/share/postgresql/16)"
if [ ! -f "$SHAREDIR/extension/vector.control" ]; then
  log "pgvector missing: installing the placeholder vector type (verification only)"
  cp "$REPO/scripts/pg-verify/vector-placeholder.control" "$SHAREDIR/extension/vector.control"
  cp "$REPO/scripts/pg-verify/vector-placeholder--0.0.sql" "$SHAREDIR/extension/vector--0.0.sql"
fi

if [ "$RESET" = "1" ]; then
  log "dropping database $DB_NAME"
  "$REPO/scripts/stack/down.sh" >/dev/null 2>&1 || true
  pgsu -c "\"drop database if exists $DB_NAME\""
fi
pgsu -tAc "\"select 1 from pg_database where datname = '$DB_NAME'\"" | grep -q 1 || { log "creating database $DB_NAME"; pgsu -c "\"create database $DB_NAME\""; }
pgsu -d "$DB_NAME" -f "$REPO/scripts/stack/db-init.sql"

# --- keys (same shape the Supabase CLI prints) ------------------------------
ANON_KEY="$(node "$REPO/scripts/stack/jwt.mjs" "$JWT_SECRET" anon)"
SERVICE_KEY="$(node "$REPO/scripts/stack/jwt.mjs" "$JWT_SECRET" service_role)"

# --- gotrue (auth) -----------------------------------------------------------
export GOTRUE_API_HOST=127.0.0.1 PORT=$AUTH_PORT API_EXTERNAL_URL="http://127.0.0.1:$API_PORT"
export GOTRUE_DB_DRIVER=postgres DATABASE_URL="postgres://supabase_auth_admin:supabase_auth_admin@$DB_HOST:$DB_PORT/$DB_NAME"
export GOTRUE_SITE_URL="$SITE_URL" GOTRUE_URI_ALLOW_LIST="$SITE_URL/auth/callback,http://127.0.0.1:3100/auth/callback,$SITE_URL/**"
export GOTRUE_DISABLE_SIGNUP=false GOTRUE_JWT_ADMIN_ROLES=service_role GOTRUE_JWT_AUD=authenticated GOTRUE_JWT_DEFAULT_GROUP_NAME=authenticated
export GOTRUE_JWT_EXP=3600 GOTRUE_JWT_SECRET="$JWT_SECRET" GOTRUE_JWT_ISSUER="http://127.0.0.1:$API_PORT/auth/v1"
export GOTRUE_EXTERNAL_EMAIL_ENABLED=true GOTRUE_MAILER_AUTOCONFIRM=false GOTRUE_MAILER_SECURE_EMAIL_CHANGE_ENABLED=true GOTRUE_MAILER_OTP_EXP=3600
export GOTRUE_SMTP_HOST=127.0.0.1 GOTRUE_SMTP_PORT=$MAIL_SMTP_PORT GOTRUE_SMTP_ADMIN_EMAIL=admin@north.test GOTRUE_SMTP_SENDER_NAME=North GOTRUE_SMTP_MAX_FREQUENCY=1s
export GOTRUE_MAILER_URLPATHS_INVITE=/auth/v1/verify GOTRUE_MAILER_URLPATHS_CONFIRMATION=/auth/v1/verify GOTRUE_MAILER_URLPATHS_RECOVERY=/auth/v1/verify GOTRUE_MAILER_URLPATHS_EMAIL_CHANGE=/auth/v1/verify
export GOTRUE_RATE_LIMIT_EMAIL_SENT=1000 GOTRUE_RATE_LIMIT_VERIFY=1000 GOTRUE_RATE_LIMIT_TOKEN_REFRESH=1000 GOTRUE_RATE_LIMIT_OTP=1000
export GOTRUE_EXTERNAL_PHONE_ENABLED=false GOTRUE_SMS_AUTOCONFIRM=false GOTRUE_PASSWORD_MIN_LENGTH=6
export GOTRUE_SECURITY_REFRESH_TOKEN_ROTATION_ENABLED=true GOTRUE_SECURITY_REFRESH_TOKEN_REUSE_INTERVAL=10 GOTRUE_LOG_LEVEL=info
log "gotrue migrate"
(cd "$TOOLS/auth" && ./gotrue migrate >"$STACK/logs/gotrue-migrate.log" 2>&1) || die "gotrue migrate failed: see $STACK/logs/gotrue-migrate.log"
pgsu -d "$DB_NAME" -f "$REPO/scripts/stack/auth-helpers.sql"

# --- storage api (runs its own migrations on boot) ---------------------------
start_bg() { # name, logfile, command...
  local name="$1" logf="$2"; shift 2
  nohup "$@" >"$logf" 2>&1 &
  echo "$!" >>"$STACK/pids"
  log "$name pid $! → $logf"
}
wait_http() { # url, label
  for _ in $(seq 1 60); do curl -fsS -o /dev/null "$1" 2>/dev/null && return 0; sleep 0.5; done
  die "$2 did not answer at $1 (see $STACK/logs)"
}
: >"$STACK/pids"

start_bg storage "$STACK/logs/storage.log" env -C "$TOOLS/storage-src" NODE_ENV=production SERVER_HOST=127.0.0.1 SERVER_PORT=$STORAGE_PORT SERVER_REGION=local \
  AUTH_JWT_SECRET="$JWT_SECRET" AUTH_JWT_ALGORITHM=HS256 ANON_KEY="$ANON_KEY" SERVICE_KEY="$SERVICE_KEY" \
  DATABASE_URL="postgresql://postgres:postgres@$DB_HOST:$DB_PORT/$DB_NAME" DB_INSTALL_ROLES=true DB_SUPER_USER=postgres \
  STORAGE_BACKEND=file STORAGE_FILE_BACKEND_PATH="$STACK/storage" TENANT_ID=stub GLOBAL_S3_BUCKET=stub \
  IMAGE_TRANSFORMATION_ENABLED=false PG_QUEUE_ENABLE=false EXPOSE_DOCS=false \
  UPLOAD_FILE_SIZE_LIMIT=52428800 UPLOAD_FILE_SIZE_LIMIT_STANDARD=52428800 \
  "$NODE24" dist/start/server.js
wait_http "http://127.0.0.1:$STORAGE_PORT/status" "storage api"
pgsu -d "$DB_NAME" -tAc "\"select 1 from information_schema.tables where table_schema = 'storage' and table_name = 'objects'\"" | grep -q 1 || die "storage schema missing after boot"

# --- north migrations --------------------------------------------------------
if ! pgsu -d "$DB_NAME" -tAc "\"select 1 from information_schema.tables where table_schema = 'public' and table_name = 'companies'\"" | grep -q 1; then
  for f in "$REPO"/packages/db/supabase/migrations/*.sql; do
    log "migration $(basename "$f")"
    pgsu -d "$DB_NAME" -f "$f"
  done
  pgsu -d "$DB_NAME" -f "$REPO/packages/db/supabase/seed.sql"
else
  log "schema present; skipping migrations (use --reset to re-apply)"
fi

# --- auth, rest, mail, gateway ----------------------------------------------
start_bg gotrue "$STACK/logs/gotrue.log" env -C "$TOOLS/auth" ./gotrue serve
cat >"$STACK/postgrest.conf" <<EOF
db-uri = "postgres://authenticator:authenticator@$DB_HOST:$DB_PORT/$DB_NAME"
db-schemas = "public"
db-anon-role = "anon"
db-extra-search-path = "public, extensions"
jwt-secret = "$JWT_SECRET"
server-host = "127.0.0.1"
server-port = $REST_PORT
db-pool = 10
EOF
start_bg postgrest "$STACK/logs/postgrest.log" "$TOOLS/postgrest/postgrest" "$STACK/postgrest.conf"
start_bg mailpit "$STACK/logs/mailpit.log" "$TOOLS/mailpit/mailpit" --listen "127.0.0.1:$MAIL_HTTP_PORT" --smtp "127.0.0.1:$MAIL_SMTP_PORT" --database "$STACK/mailpit.db" --smtp-auth-accept-any --smtp-auth-allow-insecure
start_bg proxy "$STACK/logs/proxy.log" env STACK_API_PORT=$API_PORT STACK_AUTH_PORT=$AUTH_PORT STACK_REST_PORT=$REST_PORT STACK_STORAGE_PORT=$STORAGE_PORT node "$REPO/scripts/stack/proxy.mjs"

wait_http "http://127.0.0.1:$AUTH_PORT/health" "gotrue"
wait_http "http://127.0.0.1:$REST_PORT/" "postgrest"
wait_http "http://127.0.0.1:$MAIL_HTTP_PORT/api/v1/info" "mailpit"
wait_http "http://127.0.0.1:$API_PORT/rest/v1/" "gateway"

cat >"$STACK/env" <<EOF
export SUPABASE_URL=http://127.0.0.1:$API_PORT
export SUPABASE_ANON_KEY=$ANON_KEY
export SUPABASE_SERVICE_ROLE_KEY=$SERVICE_KEY
export NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:$API_PORT
export NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=$ANON_KEY
export NEXT_PUBLIC_APP_URL=$SITE_URL
export E2E_MAIL_API=http://127.0.0.1:$MAIL_HTTP_PORT/api/v1
EOF
log "up. API http://127.0.0.1:$API_PORT · mail http://127.0.0.1:$MAIL_HTTP_PORT · keys in $STACK/env"
