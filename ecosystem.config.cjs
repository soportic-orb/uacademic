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
const path = require('node:path')

const ROOT = process.env.UACADEMIC_DEPLOY_ROOT || '/var/www/uacademic'
const CURRENT = path.join(ROOT, 'current')

module.exports = {
  apps: [
    {
      name: 'uacademic',
      cwd: path.join(CURRENT, 'apps/api'),
      script: 'dist/server.js',
      instances: 2,
      exec_mode: 'cluster',
      max_memory_restart: '512M',
      env: { NODE_ENV: 'production' },
      // The shared directory survives deployments; the release directory does
      // not, so nothing that matters is written inside it.
      error_file: path.join(ROOT, 'shared/logs/api.error.log'),
      out_file: path.join(ROOT, 'shared/logs/api.out.log'),
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
      env: { NODE_ENV: 'production' },
      error_file: path.join(ROOT, 'shared/logs/worker.error.log'),
      out_file: path.join(ROOT, 'shared/logs/worker.out.log'),
      time: true,
      kill_timeout: 30_000,
    },
  ],
}
