#!/usr/bin/env bash
#
# Turn a working checkout into the releases/current layout the platform panel
# needs, without downtime and without the traps of doing it by hand.
#
# Why this exists: an over-the-air update unpacks into `releases/<version>` and
# moves `current`. A first installation is normally a plain clone, which has
# nowhere for a release to go, so the update button has nothing to switch to.
# This makes the move once.
#
#   scripts/deploy/promote.sh [version] [deploy-root]
#
# Defaults: the version in VERSION or package.json, and the directory above the
# checkout — on CloudPanel that is /home/<user>/htdocs/<domain>.
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
VERSION="${1:-}"
ROOT="${2:-$(dirname "${REPO}")}"

if [ -z "${VERSION}" ]; then
  VERSION="$(cat "${REPO}/VERSION" 2>/dev/null || node -p "require('${REPO}/package.json').version" 2>/dev/null || echo 0.1.0)"
fi

RELEASE="${ROOT}/releases/${VERSION}"
PM2_APP="${UACADEMIC_PM2_APP_NAME:-uacademic}"

log() { printf '\n\033[1;34m▸\033[0m %s\n' "$1"; }
die() { printf '\n\033[1;31m✗\033[0m %s\n' "$1" >&2; exit 1; }

[ -f "${REPO}/package.json" ] || die "${REPO} does not look like the checkout."
[ -d "${REPO}/apps/api/dist" ] || die "Nothing is built. Run 'pnpm build' in ${REPO} first."

if [ -e "${RELEASE}" ] && [ -n "$(ls -A "${RELEASE}" 2>/dev/null)" ]; then
  die "${RELEASE} already exists and is not empty. Pass another version."
fi

log "Preparing ${ROOT}"
mkdir -p "${ROOT}/releases" "${ROOT}/shared/logs" "${ROOT}/shared/uploads" "${ROOT}/backups"
mkdir -p "${RELEASE}"

# The configuration outlives releases. If it is still inside the checkout —
# which is where a first installation puts it when no deploy root was set —
# move it out before anything points at it.
if [ -f "${REPO}/.env" ] && [ ! -e "${ROOT}/shared/.env" ]; then
  log "Moving the configuration to shared/.env"
  cp "${REPO}/.env" "${ROOT}/shared/.env"
  chmod 600 "${ROOT}/shared/.env"
fi
if [ ! -f "${ROOT}/shared/.env" ]; then
  die "No configuration at ${ROOT}/shared/.env.

The deploy root is guessed as the directory above this checkout, which is
wrong whenever the checkout does not sit directly in it — a clone made one
level too deep, say. Name it instead:

  scripts/deploy/promote.sh ${VERSION} /path/to/deploy/root

If this really is a first installation, install through the browser first:
the configuration file is what the installer writes."
fi

# `.git` is excluded because its object directories are read-only, which is
# what makes a plain `cp -a` fail halfway through; `node_modules` because what
# runs on this host is installed on this host, from the lockfile.
log "Copying the build into ${RELEASE}"
if command -v rsync > /dev/null 2>&1; then
  rsync -a --exclude .git --exclude node_modules --exclude .env "${REPO}/" "${RELEASE}/"
else
  tar -c --exclude=.git --exclude=node_modules --exclude=.env -C "${REPO}" . | tar -x -C "${RELEASE}"
fi

# The panel reads this to say what it is running. Without it a promoted
# checkout reports its package.json version — 0.1.0 forever, whatever
# directory it actually sits in.
printf '%s\n' "${VERSION}" > "${RELEASE}/VERSION"

log "Linking the shared state"
ln -sfn "${ROOT}/shared/.env" "${RELEASE}/.env"

log "Installing dependencies"
(cd "${RELEASE}" && pnpm install --frozen-lockfile --prod)

log "Switching current → ${VERSION}"
ln -sfn "${RELEASE}" "${ROOT}/current"

log "Restarting"
# Deleted rather than reloaded: the processes were started from the checkout,
# and PM2 remembers the working directory it was given, not the one we want.
pm2 delete "${PM2_APP}" > /dev/null 2>&1 || true
pm2 delete "${PM2_APP}-worker" > /dev/null 2>&1 || true
UACADEMIC_DEPLOY_ROOT="${ROOT}" pm2 start "${ROOT}/current/ecosystem.config.cjs" --update-env
pm2 save

log "Health"
HEALTH="${UACADEMIC_HEALTH_CHECK_URL:-http://127.0.0.1:3001/health}"
for attempt in $(seq 1 15); do
  if curl -fsS --max-time 3 "${HEALTH}" > /dev/null 2>&1; then
    printf '  %s answers\n' "${HEALTH}"
    printf '\n\033[1;32m✓\033[0m Running from %s\n' "${ROOT}/current"
    printf '  The checkout at %s is still there for git pull; releases are what runs.\n\n' "${REPO}"
    exit 0
  fi
  sleep 2
done

die "No answer from ${HEALTH}. 'pm2 logs ${PM2_APP} --lines 50' says why; the checkout is untouched."
