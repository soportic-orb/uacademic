#!/usr/bin/env bash
#
# A MySQL session as the application, using the configuration the application
# reads. Nothing is typed and nothing is echoed: the password goes through
# MYSQL_PWD, so it never reaches the process list or the shell history.
#
#   scripts/deploy/db.sh                            # interactive
#   scripts/deploy/db.sh "SELECT 1"                 # one statement
#   scripts/deploy/db.sh < queries.sql              # a file
#
# The configuration is found the same way the API finds it: UACADEMIC_ENV_FILE,
# then <deploy root>/shared/.env, then the nearest .env above this script.
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

find_env() {
  if [ -n "${UACADEMIC_ENV_FILE:-}" ] && [ -f "${UACADEMIC_ENV_FILE}" ]; then
    printf '%s' "${UACADEMIC_ENV_FILE}"; return
  fi
  if [ -n "${UACADEMIC_DEPLOY_ROOT:-}" ] && [ -f "${UACADEMIC_DEPLOY_ROOT}/shared/.env" ]; then
    printf '%s' "${UACADEMIC_DEPLOY_ROOT}/shared/.env"; return
  fi
  local directory="${REPO}"
  for _ in 1 2 3 4 5; do
    [ -f "${directory}/shared/.env" ] && { printf '%s' "${directory}/shared/.env"; return; }
    [ -f "${directory}/.env" ] && { printf '%s' "${directory}/.env"; return; }
    directory="$(dirname "${directory}")"
  done
}

ENV_FILE="$(find_env)"
[ -n "${ENV_FILE}" ] || { echo "No configuration file found." >&2; exit 1; }

# Parsed by Node rather than by sed: a password may hold every character that
# would break a regular expression, and it arrives percent-encoded.
eval "$(node -e '
const { readFileSync } = require("node:fs")
const match = readFileSync(process.argv[1], "utf8").match(/^\s*UACADEMIC_DATABASE_URL\s*=\s*"?([^"\r\n]+)"?/m)
if (!match) { console.error("UACADEMIC_DATABASE_URL is not set in " + process.argv[1]); process.exit(1) }
const url = new URL(match[1])
const quote = (value) => "'"'"'" + String(value).replaceAll("'"'"'", "'"'"'\\'"'"''"'"'") + "'"'"'"
console.log("export MYSQL_PWD=" + quote(decodeURIComponent(url.password)))
console.log("DB_USER=" + quote(decodeURIComponent(url.username)))
console.log("DB_NAME=" + quote(decodeURIComponent(url.pathname.slice(1))))
console.log("DB_HOST=" + quote(url.hostname))
console.log("DB_PORT=" + quote(url.port || "3306"))
' "${ENV_FILE}")"

printf '\033[2m%s@%s:%s — from %s\033[0m\n' "${DB_USER}" "${DB_HOST}" "${DB_NAME}" "${ENV_FILE}" >&2

if [ "$#" -gt 0 ]; then
  exec mysql -h "${DB_HOST}" -P "${DB_PORT}" -u "${DB_USER}" "${DB_NAME}" -e "$*"
fi
exec mysql -h "${DB_HOST}" -P "${DB_PORT}" -u "${DB_USER}" "${DB_NAME}"
