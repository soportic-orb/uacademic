import { defineConfig, devices } from '@playwright/test'

const WEB_PORT = 4173
const API_PORT = 3001

/**
 * E2E covers the flows that would hurt most if they broke: seeing your own
 * load, the role-based navigation and switching language on the fly.
 * Both servers are started by Playwright so `pnpm test:e2e` is one command.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list']],
  use: {
    baseURL: `http://127.0.0.1:${WEB_PORT}`,
    trace: 'on-first-retry',
    // Escape hatch for environments that ship their own Chromium instead of
    // the build `playwright install` would download.
    ...(process.env.PLAYWRIGHT_CHROMIUM_PATH
      ? { launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH } }
      : {}),
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: 'pnpm --filter @uacademic/api start',
      port: API_PORT,
      reuseExistingServer: !process.env.CI,
      env: {
        // Not `production`: that mode refuses UACADEMIC_AUTH_MODE=mock, which
        // is exactly what the role-switching flows below rely on.
        NODE_ENV: 'test',
        UACADEMIC_LOG_LEVEL: 'warn',
        UACADEMIC_AUTH_MODE: process.env.UACADEMIC_AUTH_MODE ?? 'mock',
        UACADEMIC_WEB_ORIGIN: `http://127.0.0.1:${WEB_PORT}`,
        UACADEMIC_SESSION_COOKIE_SECRET: 'e2e-session-secret-that-is-long-enough',
        // The whole suite is one browser on one IP driving every screen in a
        // few minutes, and the rate limiter counts per IP. The production
        // default would throttle the run, not a real user.
        UACADEMIC_RATE_LIMIT_MAX: '5000',
        // The suite decides which calendar providers exist, rather than
        // whatever a developer happens to have configured locally.
        UACADEMIC_ENTRA_CLIENT_SECRET: '',
        UACADEMIC_GOOGLE_CLIENT_ID: '',
        UACADEMIC_GOOGLE_CLIENT_SECRET: '',
        UACADEMIC_APP_ENCRYPTION_KEY: 'a'.repeat(64),
        // No assistant in the e2e environment: the suite asserts that the
        // product is whole without it.
        UACADEMIC_ANTHROPIC_API_KEY: '',
      },
      cwd: '../..',
    },
    {
      command: `pnpm --filter @uacademic/web preview --port ${WEB_PORT} --strictPort`,
      port: WEB_PORT,
      reuseExistingServer: !process.env.CI,
      cwd: '../..',
    },
  ],
})
