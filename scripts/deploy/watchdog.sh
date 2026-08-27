#!/usr/bin/env bash
#
# Bring UAcademic back when it is up but not answering.
#
# PM2 restarts a process that dies. It cannot see a process that is alive and
# stuck — a pool exhausted against a database that went away, an event loop
# blocked — and neither can a reboot, because the machine is fine. What is
# broken is the answer, so the answer is what this checks.
#
# Run it from cron, every minute:
#
#   * * * * * /usr/bin/flock -n /tmp/uacademic-watchdog.lock \
#       /var/www/uacademic/current/scripts/deploy/watchdog.sh
#
# It is deliberately slow to act. A restart drops whatever is in flight, so it
# takes three consecutive failures — around three minutes — before doing
# anything, and it never restarts twice within the cool-off. A platform that
# restarts itself on every blip hides the fault that is actually there.
set -euo pipefail

# Cron runs with a PATH of its own, usually without the one npm installs into,
# so a watchdog that only says "pm2: command not found" every minute would be
# worse than no watchdog at all.
PATH="${PATH}:/usr/local/bin:/usr/bin:${HOME:-/root}/.nvm/versions/node/current/bin"
PM2_BIN="${UACADEMIC_PM2_PATH:-$(command -v pm2 || true)}"

HEALTH_URL="${UACADEMIC_HEALTH_URL:-http://127.0.0.1:3000/api/v1/health}"
PM2_APP="${UACADEMIC_PM2_APP:-uacademic}"
STATE_DIR="${UACADEMIC_WATCHDOG_STATE:-/tmp/uacademic-watchdog}"
FAILURES_BEFORE_RESTART="${UACADEMIC_WATCHDOG_FAILURES:-3}"
COOLOFF_SECONDS="${UACADEMIC_WATCHDOG_COOLOFF:-600}"

mkdir -p "${STATE_DIR}"
COUNT_FILE="${STATE_DIR}/failures"
LAST_FILE="${STATE_DIR}/last-restart"
LOG_FILE="${UACADEMIC_WATCHDOG_LOG:-${STATE_DIR}/watchdog.log}"

log() { printf '%s %s\n' "$(date -Iseconds)" "$*" >> "${LOG_FILE}"; }

if curl -fsS --max-time 5 "${HEALTH_URL}" > /dev/null 2>&1; then
  # Healthy: forget the failures rather than letting them accumulate over
  # weeks into a restart nobody asked for.
  if [[ -s "${COUNT_FILE}" ]] && [[ "$(cat "${COUNT_FILE}")" != "0" ]]; then
    log "answering again after $(cat "${COUNT_FILE}") failed checks"
  fi
  echo 0 > "${COUNT_FILE}"
  exit 0
fi

FAILURES=$(( $(cat "${COUNT_FILE}" 2>/dev/null || echo 0) + 1 ))
echo "${FAILURES}" > "${COUNT_FILE}"
log "health check failed (${FAILURES}/${FAILURES_BEFORE_RESTART}) at ${HEALTH_URL}"

if (( FAILURES < FAILURES_BEFORE_RESTART )); then
  exit 0
fi

NOW=$(date +%s)
LAST=$(cat "${LAST_FILE}" 2>/dev/null || echo 0)

if (( NOW - LAST < COOLOFF_SECONDS )); then
  # Restarting again this soon would only churn: something is wrong that a
  # restart does not fix, and the log is where somebody should be looking.
  log "still failing, but a restart was tried $(( NOW - LAST ))s ago; leaving it alone"
  exit 0
fi

if [[ -z "${PM2_BIN}" ]]; then
  # Nothing can be done from here, and saying so once every cool-off is the
  # useful thing: silence would read as "the watchdog is handling it".
  echo "${NOW}" > "${LAST_FILE}"
  log "not answering, and pm2 is not on this PATH; set UACADEMIC_PM2_PATH"
  exit 1
fi

echo "${NOW}" > "${LAST_FILE}"
log "restarting ${PM2_APP}"

if "${PM2_BIN}" reload "${PM2_APP}" --update-env >> "${LOG_FILE}" 2>&1; then
  log "reloaded"
else
  # Nothing to reload: PM2 is empty, which is what a reboot without the boot
  # unit looks like. Start the release the symlink points at.
  ROOT="${UACADEMIC_DEPLOY_ROOT:-/var/www/uacademic}"
  log "reload failed; starting ${ROOT}/current/ecosystem.config.cjs"
  "${PM2_BIN}" start "${ROOT}/current/ecosystem.config.cjs" >> "${LOG_FILE}" 2>&1 || true
  "${PM2_BIN}" save >> "${LOG_FILE}" 2>&1 || true
fi

echo 0 > "${COUNT_FILE}"
