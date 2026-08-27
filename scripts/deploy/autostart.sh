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
# Run once, after the first release is running:
#
#   sudo bash scripts/deploy/autostart.sh
#
# `bash` rather than the path alone because `sudo scripts/…` resolves the
# command against root's PATH and a relative path is not a command — the shell
# answers "command not found" for a file that is plainly there.
#
# Root is needed only for the unit file. Without sudo it does everything it
# can and prints the one line to run as root.
set -euo pipefail

APP_USER="${SUDO_USER:-$(id -un)}"
APP_HOME="$(getent passwd "${APP_USER}" | cut -d: -f6)"

# Under sudo the PATH is root's, and pm2 is usually installed for the
# application user — so it is looked for as them before giving up.
PM2_BIN="${UACADEMIC_PM2_PATH:-$(command -v pm2 || true)}"
if [[ -z "${PM2_BIN}" && -n "${SUDO_USER:-}" ]]; then
  PM2_BIN="$(su - "${APP_USER}" -c 'command -v pm2' 2>/dev/null || true)"
fi

if [[ -z "${PM2_BIN}" ]]; then
  cat >&2 <<'MISSING'
pm2 was not found, neither on this PATH nor on the application user's.

Install it, or say where it is:

  npm install --global pm2
  UACADEMIC_PM2_PATH=/path/to/pm2 sudo -E bash scripts/deploy/autostart.sh
MISSING
  exit 1
fi

# PM2 keeps its state per user: run as root, `pm2 save` would save root's
# (empty) list and the unit would resurrect nothing.
run_as_app() {
  if [[ -n "${SUDO_USER:-}" ]]; then
    su - "${APP_USER}" -c "$*"
  else
    eval "$*"
  fi
}

log() { printf '\n\033[1m%s\033[0m\n' "$*"; }

# The release the symlink points at, which is what a boot should start.
CURRENT="${UACADEMIC_CURRENT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
CRON_TAG="# uacademic-autostart"

#
# A @reboot line in the application user's own crontab.
#
# Weaker than a systemd unit — cron has to be running, and @reboot fires
# early — but it needs no root at all, which on a managed host is the
# difference between having this and not having it. The ecosystem file is
# started rather than `pm2 resurrect`, so it does not depend on a saved list
# being right; the delay is for the database, which is often a few seconds
# behind at boot.
install_reboot_cron() {
  local line="@reboot sleep 30; cd ${CURRENT} && ${PM2_BIN} start ecosystem.config.cjs ${CRON_TAG}"

  local existing
  existing="$(run_as_app "crontab -l" 2>/dev/null | grep -v -F "${CRON_TAG}" || true)"

  printf '%s\n%s\n' "${existing}" "${line}" | sed '/^$/d' | run_as_app "crontab -"

  log "Installed the @reboot line"
  cat <<CRON
${line}

It is in the crontab of ${APP_USER}: \`crontab -l\` shows it, and removing
that line undoes this. If you later get root, the systemd unit above is the
better answer — it starts earlier and reports its state to \`systemctl\`.
CRON
}

log "Looking at what PM2 is running"
# Saving an empty list is the trap this script exists to avoid: the unit would
# resurrect nothing, which looks exactly like no unit at all. So a list with
# nothing in it is a stop, with the reason.
if ! run_as_app "${PM2_BIN} pid uacademic" > /dev/null 2>&1; then
  cat >&2 <<MANAGING

PM2 is not running UAcademic for ${APP_USER}, so there is nothing to make
come back. Start it first, from the release directory:

  pm2 start ecosystem.config.cjs

and run this again. If the site *is* answering, then something other than
this user's PM2 is serving it — find out what before setting up a second
thing to start it:

  pm2 list                                  # as ${APP_USER}
  sudo pm2 list                             # as root, if sudo allows it
  systemctl list-units --type=service | grep -i uacademic
  ps -ef | grep -i '[u]academic'

MANAGING
  exit 1
fi

log "Saving the process list"
# What resurrect brings back is this file, so it has to be written *after* the
# processes are running and *again* after every release — and as the user who
# owns the processes, which under sudo is not the user running this.
run_as_app "${PM2_BIN} save"

UNIT="/etc/systemd/system/pm2-${APP_USER}.service"

if [[ -f "${UNIT}" ]] && systemctl is-enabled --quiet "pm2-${APP_USER}" 2>/dev/null; then
  log "Already installed"
  echo "${UNIT} exists and is enabled: UAcademic comes back on its own."
  echo "The process list has just been refreshed."
  exit 0
fi

if [[ "$(id -u)" -ne 0 ]]; then
  cat <<MANUAL

The unit file needs root:

  sudo env PATH="\$PATH:$(dirname "${PM2_BIN}")" "${PM2_BIN}" startup systemd \\
    -u "${APP_USER}" --hp "${APP_HOME}"

On a host where sudo is restricted — a managed panel usually is — that line
comes back "not allowed". There is a way that needs nobody's permission, and
it is what this script is about to do instead: a @reboot line in your own
crontab.

MANUAL

  install_reboot_cron
  exit 0
fi

log "Installing the boot unit"
env PATH="${PATH}:$(dirname "${PM2_BIN}")" "${PM2_BIN}" startup systemd \
  -u "${APP_USER}" --hp "${APP_HOME}"

systemctl enable "pm2-${APP_USER}" >/dev/null 2>&1 || true

log "Done"
cat <<'NEXT'
UAcademic will start again by itself after a reboot.

Two things worth knowing:

  * `pm2 save` has to run again whenever the set of processes changes.
    scripts/deploy/release.sh does it on every deployment, and so does the
    over-the-air updater, so in normal use this is taken care of.

  * The database is a separate service. Check it also starts at boot:
      systemctl is-enabled mariadb   (or mysql)
    and enable it with `systemctl enable mariadb` if it says "disabled".
NEXT

# Outside the heredoc, which is quoted so that the backticks above are text
# rather than commands: an unquoted one ran `pm2 save` a second time while
# printing this and swallowed the words it was meant to show.
cat <<CHECK

To see that it really works, without waiting for the next outage:

  sudo systemctl restart pm2-${APP_USER}
  pm2 status

CHECK
