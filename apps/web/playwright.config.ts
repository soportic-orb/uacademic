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
        NODE_ENV: 'production',
        LOG_LEVEL: 'warn',
        WEB_ORIGIN: `http://127.0.0.1:${WEB_PORT}`,
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
