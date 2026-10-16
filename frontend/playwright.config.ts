import { defineConfig, devices } from '@playwright/test';

// Servers (uvicorn + vite on the synthetic seed) are started by
// scripts/browser-tests.sh; this runner works inside the Playwright docker
// image, so screenshots render the same locally and in CI.
export default defineConfig({
  testDir: './browser-tests',
  workers: 1,
  forbidOnly: true,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:15173',
    ...devices['Desktop Chrome'],
    viewport: { width: 390, height: 844 },
    locale: 'ru-RU',
    timezoneId: 'Europe/Moscow',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  expect: { toHaveScreenshot: { animations: 'disabled', caret: 'hide' } },
  projects: [
    { name: 'light', use: { colorScheme: 'light' } },
    { name: 'dark', use: { colorScheme: 'dark' } },
  ],
});
