#!/usr/bin/env bash
# TST-3, TST-4: fail a staging run whose output holds a secret's value.
#
# After the live journey (pnpm e2e:staging / e2e:live) the Playwright report,
# the test results (traces, videos, error contexts), the tee'd run log and the
# acceptance evidence are shared or committed. This looks for the values of
# VERCEL_AUTOMATION_BYPASS_SECRET and E2E_RESEND_KEY (each only when set) in
# every file under them: as plain text, inside zip files (traces) and inside
# the HTML report's embedded base64 zip. A hit names the file and the
# variable, never the value; the values are handed to grep through a
# private pattern file, never on a command line.
#
#   bash scripts/evidence-guard.sh [path ...]            scan the default paths and the given ones
#   bash scripts/evidence-guard.sh --run <command ...>   run the command from the repo root, then scan;
#                                                        exit with the command's code, or 1 when a value leaked
#
# Default paths (from the repo root): apps/web/playwright-report-staging,
# apps/web/test-results, docs/evidence/M7/staging-journey.txt,
# docs/evidence/M7/acceptance. EVIDENCE_GUARD_ROOT overrides the root (tests).
set -u

ROOT="${EVIDENCE_GUARD_ROOT:-$(cd "$(dirname "$0")/.." && pwd)}"
DEFAULT_PATHS=(apps/web/playwright-report-staging apps/web/test-results docs/evidence/M7/staging-journey.txt docs/evidence/M7/acceptance)
SECRET_VARS=(VERCEL_AUTOMATION_BYPASS_SECRET E2E_RESEND_KEY)

usage() {
  echo "evidence guard usage: bash scripts/evidence-guard.sh [path ...] | --run <command> [args ...]" >&2
  exit 2
}

status=0
if [ "${1:-}" = "--run" ]; then
  shift
  [ "$#" -gt 0 ] || usage
  (cd "$ROOT" && "$@")
  status=$?
  set --
fi

WORK="$(mktemp -d)"
chmod 700 "$WORK"
trap 'rm -rf "$WORK"' EXIT

# One pattern file per secret that is set (trimmed; blank counts as unset).
names=()
for var in "${SECRET_VARS[@]}"; do
  value="$(printf '%s' "${!var:-}" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')"
  if [ -n "$value" ]; then
    printf '%s\n' "$value" >"$WORK/$var.pattern"
    names+=("$var")
  fi
done
if [ "${#names[@]}" -eq 0 ]; then
  echo "evidence guard: skip (${SECRET_VARS[0]} and ${SECRET_VARS[1]} unset: nothing to look for)"
  exit "$status"
fi

# Prints where in FILE the pattern in PATTERN_FILE occurs: "" (plain), " (inside the archive)", " (inside the embedded report)"; nothing when it does not.
where_held() {
  local file="$1" pattern="$2" base64_zip
  if grep -qF -f "$pattern" "$file" 2>/dev/null; then
    printf '%s' "-"
    return
  fi
  case "$file" in
    *.zip)
      if unzip -p "$file" 2>/dev/null | grep -qF -f "$pattern"; then printf '%s' " (inside the archive)"; fi
      ;;
    *.html)
      base64_zip="$(sed -n 's/.*<template id="playwrightReportBase64">data:application\/zip;base64,\([A-Za-z0-9+\/=]*\)<\/template>.*/\1/p' "$file")"
      if [ -n "$base64_zip" ] && printf '%s' "$base64_zip" | base64 -d >"$WORK/embedded.zip" 2>/dev/null && unzip -p "$WORK/embedded.zip" 2>/dev/null | grep -qF -f "$pattern"; then
        printf '%s' " (inside the embedded report)"
      fi
      ;;
  esac
}

files=()
for path in "${DEFAULT_PATHS[@]/#/$ROOT/}" "$@"; do
  if [ -d "$path" ]; then
    while IFS= read -r -d '' file; do files+=("$file"); done < <(find "$path" -type f -print0)
  elif [ -f "$path" ]; then
    files+=("$path")
  fi
done

leaks=0
for file in ${files[@]+"${files[@]}"}; do
  shown="${file#"$ROOT"/}"
  case "$file" in
    *.zip | *.html)
      if ! command -v unzip >/dev/null 2>&1; then
        echo "evidence guard: cannot look inside $shown: unzip is not installed" >&2
        leaks=$((leaks + 1))
        continue
      fi
      ;;
  esac
  for var in "${names[@]}"; do
    held="$(where_held "$file" "$WORK/$var.pattern")"
    if [ -n "$held" ]; then
      [ "$held" = "-" ] && held=""
      echo "evidence guard: $shown$held holds the value of $var; remove it before the output is shared" >&2
      leaks=$((leaks + 1))
    fi
  done
done

if [ "$leaks" -gt 0 ]; then
  echo "evidence guard: FAIL ($leaks finding(s); no value was printed)" >&2
  [ "$status" -ne 0 ] && exit "$status"
  exit 1
fi
echo "evidence guard: OK (${#files[@]} file(s) checked for ${names[*]})"
exit "$status"
