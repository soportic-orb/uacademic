#!/usr/bin/env bash
#
# Deploying one release, by hand.
#
# The same steps the platform panel runs over the air, in the same order and
# with the same guarantees — because an operator who has to fix a failed
# automatic update should be following a procedure they already know:
#
#   verify the artefact → back up the database → unpack → link shared state →
#   migrate → switch the symlink → reload → health check → roll back if it fails
#
# The database backup happens before the migration and not after: that is the
# last moment a rollback is cheap.
#
#   ./release.sh 2026.08.18-1 /tmp/uacademic-2026.08.18-1.tar.gz [sha256]
set -euo pipefail

VERSION="${1:?usage: release.sh <version> <artifact.tar.gz> [sha256]}"
ARTIFACT="${2:?usage: release.sh <version> <artifact.tar.gz> [sha256]}"
EXPECTED_SHA="${3:-}"

ROOT="${UACADEMIC_DEPLOY_ROOT:-/var/www/uacademic}"
RELEASE="${ROOT}/releases/${VERSION}"
HEALTH_URL="${UACADEMIC_HEALTH_CHECK_URL:-http://127.0.0.1:3001/health}"
PM2_APP="${UACADEMIC_PM2_APP_NAME:-uacademic}"

log() { printf '\n▸ %s\n' "$1"; }

if [[ -n "${EXPECTED_SHA}" ]]; then
  log "Verifying checksum"
  echo "${EXPECTED_SHA}  ${ARTIFACT}" | sha256sum --check --status || {
    echo "Checksum does not match. Nothing has been touched." >&2
    exit 1
  }
fi

PREVIOUS=""
if [[ -L "${ROOT}/current" ]]; then
  PREVIOUS="$(readlink -f "${ROOT}/current")"
fi

log "Backing up the database"
mkdir -p "${ROOT}/backups"
BACKUP="${ROOT}/backups/pre-${VERSION}-$(date -u +%Y%m%d-%H%M%S).sql.gz"
# Reads UACADEMIC_DATABASE_URL from the shared environment.
set -a && source "${ROOT}/shared/.env" && set +a
DB_URL="${UACADEMIC_DATABASE_URL:?UACADEMIC_DATABASE_URL is not set}"
DB_NAME="$(basename "${DB_URL%%\?*}")"
DB_USER="$(printf '%s' "${DB_URL}" | sed -E 's#^mysql://([^:]+):.*#\1#')"
DB_PASS="$(printf '%s' "${DB_URL}" | sed -E 's#^mysql://[^:]+:([^@]*)@.*#\1#')"
DB_HOST="$(printf '%s' "${DB_URL}" | sed -E 's#^mysql://[^@]+@([^:/]+).*#\1#')"
MYSQL_PWD="${DB_PASS}" mysqldump --host="${DB_HOST}" --user="${DB_USER}" \
  --single-transaction --quick --routines --events "${DB_NAME}" | gzip -6 > "${BACKUP}"
echo "  ${BACKUP}"

log "Unpacking into ${RELEASE}"
mkdir -p "${RELEASE}"
# The archive holds a single `uacademic/` directory; strip it rather than
# ending up with `releases/<version>/uacademic/`.
tar -xzf "${ARTIFACT}" -C "${RELEASE}" --strip-components=1

log "Linking shared state"
ln -sfn "${ROOT}/shared/.env" "${RELEASE}/.env"
ln -sfn "${ROOT}/shared/uploads" "${RELEASE}/var-uploads"
ln -sfn "${ROOT}/shared/logs" "${RELEASE}/logs"

log "Installing dependencies"
# The artefact carries no node_modules: what runs on this host is built for
# this host. pnpm hardlinks from its store, so releases share almost everything.
(cd "${RELEASE}" && pnpm install --frozen-lockfile --prod)

log "Running migrations"
# Migrations must be backward compatible within a version — add a column, fill
# it, use it; never drop in the same deployment — because for a few seconds the
# old code is still serving requests against the new schema.
(cd "${RELEASE}" && pnpm --filter @uacademic/db migrate:deploy)

log "Switching current → ${VERSION}"
ln -sfn "${RELEASE}" "${ROOT}/current"

log "Reloading"
pm2 reload "${PM2_APP}" --update-env || pm2 start "${ROOT}/current/ecosystem.config.cjs"

log "Health check"
HEALTHY=0
for attempt in $(seq 1 15); do
  if curl -fsS --max-time 3 "${HEALTH_URL}" > /dev/null 2>&1; then
    HEALTHY=1
    break
  fi
  sleep 2
done

if [[ "${HEALTHY}" -eq 1 ]]; then
  log "Deployed ${VERSION}"
  exit 0
fi

echo "Health check failed after the switch." >&2

if [[ -n "${PREVIOUS}" && -d "${PREVIOUS}" ]]; then
  log "Rolling back to $(basename "${PREVIOUS}")"
  ln -sfn "${PREVIOUS}" "${ROOT}/current"
  pm2 reload "${PM2_APP}" --update-env || true
  echo "Rolled back. The database backup is at ${BACKUP}; restore it only if" >&2
  echo "the migration is what broke — the previous code may not read the new" >&2
  echo "schema, which is why migrations have to be backward compatible." >&2
else
  echo "No previous release to roll back to." >&2
fi

exit 1
