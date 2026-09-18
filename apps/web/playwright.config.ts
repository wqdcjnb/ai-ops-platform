import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  timeout: 45_000,
  expect: { timeout: 8_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://127.0.0.1:4176',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: 'npm run dev',
      cwd: '../server',
      url: 'http://127.0.0.1:4177/health',
      env: { AUTH_MODE: 'disabled', PORT: '4177', PLATFORM_DB_PATH: ':memory:' },
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      command: 'npm run dev',
      cwd: '.',
      url: 'http://127.0.0.1:4176',
      env: { VITE_PORT: '4176', VITE_BFF_PORT: '4177' },
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
})
