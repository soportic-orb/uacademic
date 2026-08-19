/**
 * PM2 on a shared Plesk or CloudPanel host.
 *
 * Two processes, and the reason they are two: an HTTP request must never wait
 * behind a slow SMTP handshake, a calendar sync or a 25 MB document being read
 * by the model. The API answers; the worker takes its time.
 *
 * `cluster` is deliberate for the API — Node is one core otherwise — and
 * deliberately *not* used for the worker: jobs are claimed with a conditional
 * UPDATE, so more workers would be safe, but on a shared host one is plenty
 * and two would double the memory for nothing.
 *
 *   pm2 start ecosystem.config.cjs
 *   pm2 save && pm2 startup
 */
const fs = require('node:fs')
const path = require('node:path')

/**
 * Where this installation lives.
 *
 * `/var/www/uacademic` is the layout section 2 of the deployment manual
 * describes, but a panel decides its own paths — CloudPanel puts a site under
 * `/home/<user>/htdocs/<domain>` — and a first installation is often a plain
 * clone with no `current` symlink yet. So both are found rather than assumed:
 * `UACADEMIC_DEPLOY_ROOT` wins, then the documented path if it is really
 * there, and otherwise the directory above this file.
 */
function deployRoot() {
  if (process.env.UACADEMIC_DEPLOY_ROOT) return process.env.UACADEMIC_DEPLOY_ROOT

  // Started from a release — `<root>/releases/<version>/`, which is where
  // `current` points. Node resolves the symlink before we see it, so the
  // layout has to be recognised by shape: the root is two levels up, not one,
  // or `shared/logs` would end up inside `releases/` where the next cleanup
  // takes it.
  const parent = path.dirname(__dirname)
  if (path.basename(parent) === 'releases') return path.dirname(parent)

  if (fs.existsSync('/var/www/uacademic')) return '/var/www/uacademic'
  return parent
}

const ROOT = deployRoot()

/**
 * The release to run. The symlink is the point of the release layout — PM2
 * keeps pointing at `current` and a deployment flips it underneath — so it
 * wins whenever it exists. Without one, this file's own directory is the
 * checkout somebody just built.
 */
const CURRENT = fs.existsSync(path.join(ROOT, 'current')) ? path.join(ROOT, 'current') : __dirname

// PM2 creates the log file but not the directory above it, and refusing to
// start over a missing folder is a poor first impression. If the directory
// cannot be created, PM2's own error naming the path is more useful than one
// thrown while reading this file.
const LOGS = path.join(ROOT, 'shared/logs')
try {
  fs.mkdirSync(LOGS, { recursive: true })
} catch {
  /* left to PM2 to report */
}

module.exports = {
  apps: [
    {
      name: 'uacademic',
      cwd: path.join(CURRENT, 'apps/api'),
      script: 'dist/main.js',
      instances: 2,
      exec_mode: 'cluster',
      max_memory_restart: '512M',
      // TZ is a floor, not the setting: `UACADEMIC_TIMEZONE` in shared/.env
      // overrides it at start-up. It is here so a host on UTC still runs the
      // clock the platform is written for before anything is configured.
      env: { NODE_ENV: 'production', TZ: 'Europe/Madrid' },
      // The shared directory survives deployments; the release directory does
      // not, so nothing that matters is written inside it.
      error_file: path.join(LOGS, 'api.error.log'),
      out_file: path.join(LOGS, 'api.out.log'),
      time: true,
      // A release switch flips the symlink under a running process, so the
      // reload has to be graceful: finish what is in flight, then exit.
      kill_timeout: 10_000,
      wait_ready: false,
      listen_timeout: 10_000,
    },
    {
      name: 'uacademic-worker',
      cwd: path.join(CURRENT, 'apps/api'),
      script: 'dist/jobs/main.js',
      instances: 1,
      exec_mode: 'fork',
      max_memory_restart: '512M',
      env: { NODE_ENV: 'production', TZ: 'Europe/Madrid' },
      error_file: path.join(LOGS, 'worker.error.log'),
      out_file: path.join(LOGS, 'worker.out.log'),
      time: true,
      kill_timeout: 30_000,
    },
  ],
}
