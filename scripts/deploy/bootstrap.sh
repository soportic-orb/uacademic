#!/usr/bin/env bash
#
# First-time setup on a Plesk or CloudPanel host.
#
# The layout is the one every later deployment — by hand or over the air —
# assumes:
#
#   /var/www/uacademic
#   ├── current -> releases/2026.08.18-1     the symlink Nginx and PM2 point at
#   ├── releases/                            one directory per version, kept
#   ├── shared/                              everything that must survive one
#   │   ├── .env                             the configuration, mode 600
#   │   ├── uploads/                         attachments and documents, OUTSIDE
#   │   │                                    the webroot on purpose
#   │   └── logs/
#   └── backups/                             mysqldump output, pruned by policy
#
# Releases are directories rather than a git checkout: a deployment that has to
# resolve dependencies on the server is a deployment that can fail halfway.
#
# Run once, as the application user:
#   ./bootstrap.sh /var/www/uacademic
set -euo pipefail

ROOT="${1:-/var/www/uacademic}"

echo "Preparing ${ROOT}"

mkdir -p "${ROOT}/releases"
mkdir -p "${ROOT}/shared/uploads"
mkdir -p "${ROOT}/shared/logs"
mkdir -p "${ROOT}/backups"

# Uploads hold documents and message attachments: nothing here is ever served
# by the web server directly, only through the API after a permission check.
chmod 750 "${ROOT}/shared/uploads"
chmod 750 "${ROOT}/backups"

if [[ ! -f "${ROOT}/shared/.env" ]]; then
  cat > "${ROOT}/shared/.env" <<'ENV'
# UAcademic — see .env.example in the repository for every variable.
# Every name carries the UACADEMIC_ prefix: this host may run other apps.
NODE_ENV=production
UACADEMIC_DATABASE_URL=
UACADEMIC_SESSION_COOKIE_SECRET=
UACADEMIC_APP_ENCRYPTION_KEY=
UACADEMIC_WEB_ORIGIN=
UACADEMIC_API_PUBLIC_URL=
UACADEMIC_APP_URL=
UACADEMIC_UPLOAD_DIR=/var/www/uacademic/shared/uploads
UACADEMIC_BACKUP_DIR=/var/www/uacademic/backups
UACADEMIC_DEPLOY_ROOT=/var/www/uacademic
ENV
  chmod 600 "${ROOT}/shared/.env"
  echo "Created ${ROOT}/shared/.env — fill it in before starting anything."
fi

cat <<NEXT

Layout ready. What is left, in order:

  1. Fill in ${ROOT}/shared/.env (database URL, secrets, origins).
  2. Deploy a release:   scripts/deploy/release.sh <version> <artifact.tar.gz>
  3. Start PM2:          pm2 start ${ROOT}/current/ecosystem.config.cjs
  4. Make it survive a reboot:
                         sudo bash scripts/deploy/autostart.sh
     This is the step that is easy to skip and expensive to have skipped:
     without it PM2 does not come back after a restart and the site answers
     502 until somebody logs in and starts it by hand. The script writes the
     systemd unit and saves the process list for it to resurrect; every later
     deployment refreshes that list on its own.
  5. Point Nginx at ${ROOT}/current/apps/web/dist and proxy /api to the API
     port — see scripts/deploy/nginx.conf.example.
  6. Optional, and worth it: the watchdog, for the case where the processes
     are alive and not answering. PM2 cannot see that; a health check can.
     * * * * * /usr/bin/flock -n /tmp/uacademic-watchdog.lock \
         ${ROOT}/current/scripts/deploy/watchdog.sh
  7. If PM2 daemons are not allowed on this host, use the cron worker instead:
     * * * * * /usr/bin/flock -n /tmp/uacademic-jobs.lock \\
         node ${ROOT}/current/apps/api/dist/jobs/tick.js

NEXT
