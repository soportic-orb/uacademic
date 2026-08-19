# Deployment manual

For whoever installs and maintains UAcademic on a server. It assumes shared
hosting with Plesk or CloudPanel, Nginx, PM2 and MySQL 8 or MariaDB — the
environment the platform is built for: no Docker, no Redis, no native
dependencies.

---

## 1. Requirements

| Component | Version                | Note                                                          |
| --------- | ---------------------- | ------------------------------------------------------------- |
| Node      | 22.x                   | Plesk's panel can install it per application                  |
| pnpm      | 10.x                   | `corepack enable && corepack prepare pnpm@10.33.0 --activate` |
| MySQL     | 8.0+ or MariaDB 10.11+ | `utf8mb4_unicode_ci`, InnoDB                                  |
| PM2       | 5.x                    | If the host forbids daemons, see section 7                    |
| mysqldump | the server's own       | The backups call it                                           |

The application needs no Docker, no Python and no image library.

---

## 2. Directory layout

```
/var/www/uacademic
├── current -> releases/2026.08.18-1    the symlink Nginx and PM2 point at
├── releases/                           one directory per version
├── shared/
│   ├── .env                            configuration, mode 600
│   ├── uploads/                        documents and attachments, OUTSIDE the webroot
│   └── logs/
└── backups/                            mysqldump output
```

Prepare it once:

```bash
./scripts/deploy/bootstrap.sh /var/www/uacademic
```

Uploaded files are never served by the web server: only by the API, after the
role and the center have been checked. That is why `uploads/` lives outside the
webroot and the `location /shared/` block in the Nginx configuration returns 404.

**On a panel that gives you no root (CloudPanel).** The site user owns
`/home/<user>/htdocs/<domain>` and nothing above it, so the layout moves there
and the tools install into the user's own prefix — `corepack`, `apt` and
`pm2 startup` are all root's:

```bash
cd /home/uacademic/htdocs/uacademic.cat
mkdir -p shared/logs shared/uploads backups
pnpm add -g pm2
echo 'export UACADEMIC_DEPLOY_ROOT=/home/uacademic/htdocs/uacademic.cat' >> ~/.profile
```

That variable is what points the API at `shared/.env`, and PM2 reads it when it
starts the processes — set it in the shell you are in as well, not only in
`~/.profile`. With no `current` symlink, PM2 runs the checkout it finds
`ecosystem.config.cjs` in, so a plain clone works.

Then the part that matters most: set the site's **root directory** to
`repo/apps/web/dist`. The built SPA is the only thing that should be
web-reachable — with the root one level up, `https://uacademic.cat/shared/.env`
would serve the database password and the encryption key.

`pm2 startup` needs root. Without it, survive a reboot from the user's own
crontab:

```bash
pm2 save
(crontab -l 2>/dev/null; echo "@reboot $(command -v pm2) resurrect") | crontab -
```

---

## 3. Database

```sql
CREATE DATABASE uacademic CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'uacademic'@'localhost' IDENTIFIED BY '…';
GRANT ALL PRIVILEGES ON uacademic.* TO 'uacademic'@'localhost';
```

The user needs `ALTER` and `CREATE`: migrations run under this account on every
deployment.

**Opening it later.** The system account you log in with over SSH is not the
database account, so a bare `mysql` is refused. Use the configuration the
application already has:

```bash
scripts/deploy/db.sh                             # a session
scripts/deploy/db.sh "SELECT status, error_key, error_detail FROM documents"
```

The password travels through `MYSQL_PWD`, so it reaches neither the process
list nor your shell history.

---

## 4. Configuration

**If you use the web installer (section 5), it writes this file for you** and
this section is the reference for what ends up in it.

Every variable carries the `UACADEMIC_` prefix. This is not decoration: on a
shared server a neighbour's `SMTP_HOST` would be picked up silently and mail
would go out through their server. The application reads only its own.

`shared/.env`, mode 600. The ones you cannot do without:

```
NODE_ENV=production
UACADEMIC_DATABASE_URL=mysql://uacademic:…@127.0.0.1:3306/uacademic
UACADEMIC_SESSION_COOKIE_SECRET=…            # at least 32 characters
UACADEMIC_APP_ENCRYPTION_KEY=…               # 32 bytes in hex (64 characters)
UACADEMIC_WEB_ORIGIN=https://uacademic.example.edu
UACADEMIC_API_PUBLIC_URL=https://uacademic.example.edu
UACADEMIC_APP_URL=https://uacademic.example.edu
UACADEMIC_UPLOAD_DIR=/var/www/uacademic/shared/uploads
UACADEMIC_BACKUP_DIR=/var/www/uacademic/backups
UACADEMIC_DEPLOY_ROOT=/var/www/uacademic
```

Generate the encryption key with `openssl rand -hex 32`. If you change it, the
stored calendar tokens can no longer be decrypted and everybody has to connect
their calendar again.

The rest — Entra ID, Google, SMTP, push, the assistant, embeddings — are
documented in `.env.example`, along with what leaving each one empty means.

---

## 5. Installing from the browser

The recommended path. With the code built and the API running, open
**https://uacademic.cat/install** and follow four steps: token, database,
center, administrator.

**The token.** When the API starts with no configuration it does not fail: it
comes up in setup mode, writes a one-time token to `shared/install.token` and
prints it in the log. Read it over SSH:

```bash
cat /var/www/uacademic/shared/install.token
pm2 logs uacademic --lines 30      # it is there too
```

That is what keeps whoever merely found the URL from installing the platform:
it takes access to the server.

**What the installer does**, in this order and writing nothing until the last
step: tests the MySQL connection and reports what it found (character set,
collation, whether tables are already there) · runs the migrations · creates
the university, the center and the SUPERADMIN account · writes `shared/.env`
at mode 600, with the session secret and the encryption key **generated**
rather than chosen by hand.

**What it does not do**: create the database. Create it first (section 3) — a
web installer holding privileges to create databases holds more than it needs.

When it finishes, restart so the new configuration is read:

```bash
pm2 restart uacademic
```

From then on `/install` answers 410 for good. Changing the configuration means
editing `shared/.env` and restarting; there is no reinstall.

**Signing in the first time.** A fresh installation has no Entra application
registered, so the installer writes `UACADEMIC_AUTH_MODE="local"` and the
Microsoft button on the sign-in screen stays disabled. Sign in with the email
and password you gave the installer — the superadmin's break-glass credential.
Once Entra ID is registered (section 11), set `UACADEMIC_ENTRA_CLIENT_ID` and
restart — that alone lights the button up, because the browser asks the API
which application to sign in against and there is nothing to rebuild. The
credential stays as the way in when Microsoft is down.

If you would rather do it from a shell, there is an equivalent:

```bash
UACADEMIC_BOOTSTRAP_UNIVERSITY="…" UACADEMIC_BOOTSTRAP_CENTER="…" \
UACADEMIC_BOOTSTRAP_CENTER_CODE="…" UACADEMIC_BOOTSTRAP_EMAIL="…" \
UACADEMIC_BOOTSTRAP_PASSWORD="…" pnpm --filter @uacademic/db bootstrap
```

---

## 6. Deploying a release by hand

```bash
scripts/deploy/release.sh 2026.08.18-1 /tmp/uacademic-2026.08.18-1.tar.gz <sha256>
```

The script does this, in order: verify the checksum, back up the database,
unpack into `releases/<version>`, link the shared state, run the migrations,
move the `current` symlink, reload PM2, health check. If the check fails, the
symlink goes back where it was.

Then, the first time only:

```bash
pnpm --filter @uacademic/db exec prisma migrate deploy   # the script already does this
pm2 start /var/www/uacademic/current/ecosystem.config.cjs
pm2 save && pm2 startup
```

**Deploying from a checkout instead**, which is how a first installation
usually goes, is three commands and the middle one is not optional:

```bash
git pull
pnpm install --frozen-lockfile    # a pull can bring a new dependency
pnpm build
pm2 restart uacademic --update-env
```

Skipping the install fails the build rather than the boot — `noEmitOnError` is
set, so a build that does not compile leaves the previous one running.

---

## 7. Nginx

There are two shapes, and both work.

**Nginx serves the SPA and proxies `/api/`** — the layout in
`scripts/deploy/nginx.conf.example`, and the one to prefer: static files are
served by the thing that is good at it.

**The panel proxies every path to the application port**, which is what
CloudPanel's and Plesk's Node.js site types produce. The API then serves the
built SPA itself, from `apps/web/dist` next to it: `/install` and every screen
after it work with no static configuration at all. Nothing to set up — if the
web application is built, it is served. (`UACADEMIC_WEB_DIST` overrides where
it is looked for.) The trade is that Node serves the bundle, so prefer the
first shape once the platform is up.

For the first shape, copy `scripts/deploy/nginx.conf.example` into the vhost
configuration and adjust the server name. Three things cannot be left out:

- `index.html`, `sw.js` and `manifest.webmanifest` **uncached**. A cached
  service worker is how a browser gets stuck on last month's version.
- `/api/` with `proxy_buffering off` and `proxy_read_timeout 3600s`: realtime
  events and the assistant's answers are streams.
- The `location /shared/` block that returns 404.

---

## 8. The job queue

Two ways, and they are interchangeable because a job is claimed with a
conditional `UPDATE`, not with a lock held in memory:

**PM2 (recommended).** `ecosystem.config.cjs` already starts the
`uacademic-worker` process.

**Cron every minute**, where daemons are not allowed:

```cron
* * * * * /usr/bin/flock -n /tmp/uacademic-jobs.lock \
    node /var/www/uacademic/current/apps/api/dist/jobs/tick.js
```

`flock` keeps a slow batch from being overtaken by the next minute's run.

---

## 9. Backups

The `db.backup` job runs daily and writes to `UACADEMIC_BACKUP_DIR`. Retention
is `UACADEMIC_BACKUP_RETENTION_DAYS` (14 by default); zero keeps everything,
which is a decision rather than an oversight.

Restoring:

```bash
gunzip -c backups/uacademic-2026-08-18_03-00-00.sql.gz | mysql -u uacademic -p uacademic
```

Test a real restore at least once a year. A backup nobody has tried to restore
is not a backup.

---

## 10. Updates

The superadmin runs them from **Platform**. The server downloads the artefact
from the private repository with the PAT, **verifies the checksum before
unpacking anything**, backs up the database, migrates, moves the symlink,
reloads and health-checks. If the check fails it rolls itself back to the
previous version. Every attempt lands in `app_versions`.

That needs, in `shared/.env`:

```
UACADEMIC_GITHUB_OTA_TOKEN=…      # PAT with read access to releases
UACADEMIC_GITHUB_OTA_REPO=soportic-orb/uacademic
UACADEMIC_DEPLOY_ROOT=/var/www/uacademic
UACADEMIC_HEALTH_CHECK_URL=http://127.0.0.1:3001/health
UACADEMIC_PM2_APP_NAME=uacademic
```

The token is a **fine-grained** personal access token on the repository, with
`Contents: Read-only` and nothing else. It reads releases; it never writes. It
lives on the server, never in the repository (R10) and never in the browser —
the panel asks the API, and the API holds the token.

**Two conditions the panel cannot create for you.**

A release has to exist: the workflow publishes one on every push to `main` that
passes lint, types and tests, so a branch that has not been merged produces
nothing to install. `Actions → Release → Run workflow` cuts one by hand.

And the installation has to have the layout in section 2 — `releases/`,
`current`, `shared/` — because an update unpacks into
`releases/<version>` and moves `current`. Installing from a plain clone works
and is the normal way to start, but the update button has nowhere to put a
release. Move to it once, before enabling updates:

```bash
cd /var/www/uacademic/repo                  # your checkout
pnpm build                                  # promotion copies a build, not sources
scripts/deploy/promote.sh
```

It copies the build beside the checkout as `releases/<version>`, moves the
configuration to `shared/.env` if it was still inside the checkout, installs
from the lockfile, moves `current`, restarts PM2 from there and health-checks.
It refuses rather than half-finishing, and the checkout is left alone — it is
still what you `git pull` into.

Do not copy the checkout by hand. `cp -a` brings `.git` with it, whose object
directories are read-only, so it creates them unwritable and then cannot write
the objects into them — failing halfway with hundreds of "Permission denied".

From then on PM2 follows `current`, and each update moves it.

**The migration rule.** Within one version, migrations must be backward
compatible: add a column, fill it, use it. Never drop in the same deployment.
Between the migration and the reload the previous code is still serving
requests against the new schema — and after a rollback, it is serving them
again.

**Nothing happens to teachers.** The service worker notices the new version and
does **not** force a reload: it records it and applies it at the next start of
the app. Somebody halfway through a message loses nothing.

---

## 11. Microsoft Entra ID

Register the application as **multi-tenant**. Sign-in is a public-client flow
(PKCE) and needs no secret; the secret is only for the calendar consent.

Every Microsoft organisation in the world passes signature verification at the
`/organizations` endpoint. That is why the server validates `tid` against the
list of registered tenants and answers 403 when it is not there. Register each
tenant under **Administration → Tenants** before anybody signs in.

---

## 12. When the browser says 502

Nginx is up and nothing is answering behind it. It is almost always one of
three things, in this order:

```bash
pm2 status                          # is the API running at all?
pm2 logs uacademic --lines 50       # if it restarts in a loop, why
curl -fsS http://127.0.0.1:3001/health
ss -ltnp | grep 3001                # who is listening, if anybody
```

**`pm2 status` empty or `errored`.** The processes were never started, or they
died. Start them from the repository root:

```bash
cd /var/www/uacademic/current
pm2 start ecosystem.config.cjs && pm2 save
```

**`/health` answers but the browser still says 502.** Nginx is proxying
somewhere else. Check that `proxy_pass` names the same port the API is
listening on (3001 unless `UACADEMIC_PORT` says otherwise) — in CloudPanel
that is the site's reverse-proxy port, in Plesk the "Additional nginx
directives".

**`/health` answers `{"status":"setup"}`.** That is correct before installing:
the API is in setup mode, waiting for the wizard. If `/install` then answers
404, nothing is serving the page — check that `apps/web/dist` exists, which
means `pnpm build` finished.

An API that exits at boot writes the reason in
`shared/logs/api.error.log`, one line, naming the variable or the file.

---

## 13. Checks after deploying

```bash
curl -fsS https://uacademic.example.edu/health
pm2 status
tail -f /var/www/uacademic/shared/logs/api.error.log
```

And from a browser: sign in, look at your own timetable, open the calendar with
no connection (flight mode), and check that adding it to the home screen works
on an iPhone — without that, push notifications never arrive on iOS.
