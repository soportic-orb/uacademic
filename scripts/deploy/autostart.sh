#!/usr/bin/env bash
#
# Make UAcademic come back on its own after a reboot.
#
# PM2 keeps a process alive when it crashes, but PM2 itself is a process: when
# the machine restarts, nothing starts it, and the site answers 502 until
# somebody logs in and types `pm2 start`. That has now happened twice on this
# installation, which is twice too often for something a unit file fixes.
#
# Two things are needed, and both are done here:
#
#   1. A systemd unit that runs `pm2 resurrect` at boot, as the application
#      user, with the right PATH and HOME. `pm2 startup` writes it.
#   2. A saved process list for it to resurrect — `pm2 save`. Without this the
#      unit starts a PM2 with nothing in it, which looks identical to the
#      failure it was meant to fix.
#
# Run once, from the application user, after the first release is running:
#
#   scripts/deploy/autostart.sh
#
# It needs root only for the unit file. Run it under sudo, or run it as the
# application user and it prints the one line to run as root and stops.
set -euo pipefail

APP_USER="${SUDO_USER:-$(id -un)}"
APP_HOME="$(getent passwd "${APP_USER}" | cut -d: -f6)"
PM2_BIN="$(command -v pm2 || true)"

if [[ -z "${PM2_BIN}" ]]; then
  echo "pm2 is not on the PATH of ${APP_USER}. Install it first:" >&2
  echo "  npm install --global pm2" >&2
  exit 1
fi

log() { printf '\n\033[1m%s\033[0m\n' "$*"; }

log "Saving the process list"
# What resurrect brings back is this file, so it has to be written *after* the
# processes are running and *again* after every release.
"${PM2_BIN}" save

UNIT="/etc/systemd/system/pm2-${APP_USER}.service"

if [[ -f "${UNIT}" ]] && systemctl is-enabled --quiet "pm2-${APP_USER}" 2>/dev/null; then
  log "Already installed"
  echo "${UNIT} exists and is enabled: UAcademic comes back on its own."
  echo "The process list has just been refreshed."
  exit 0
fi

if [[ "$(id -u)" -ne 0 ]]; then
  cat >&2 <<MANUAL

The unit file needs root. Run this line, then this script again:

  sudo env PATH="\$PATH:$(dirname "${PM2_BIN}")" "${PM2_BIN}" startup systemd \\
    -u "${APP_USER}" --hp "${APP_HOME}"

MANUAL
  exit 1
fi

log "Installing the boot unit"
env PATH="${PATH}:$(dirname "${PM2_BIN}")" "${PM2_BIN}" startup systemd \
  -u "${APP_USER}" --hp "${APP_HOME}"

systemctl enable "pm2-${APP_USER}" >/dev/null 2>&1 || true

log "Done"
cat <<NEXT
UAcademic will start again by itself after a reboot.

Two things worth knowing:

  * `pm2 save` has to run again whenever the set of processes changes.
    scripts/deploy/release.sh does it on every deployment, and so does the
    over-the-air updater, so in normal use this is taken care of.

  * The database is a separate service. Check it also starts at boot:
      systemctl is-enabled mariadb   (or mysql)
    and enable it with `systemctl enable mariadb` if it says "disabled".

To see that it really works, without waiting for the next outage:

  sudo systemctl stop pm2-${APP_USER} && sudo systemctl start pm2-${APP_USER}
  pm2 status
NEXT
