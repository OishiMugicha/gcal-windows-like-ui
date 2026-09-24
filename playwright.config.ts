import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  workers: 2,
  webServer: [
    { command: 'npm run dev -- --host 127.0.0.1 --port 5174', url: 'http://127.0.0.1:5174',
      env: { VITE_GOOGLE_CLIENT_ID: ' test.apps.googleusercontent.com ' }, reuseExistingServer: false },
    { command: 'npm run dev -- --host 127.0.0.1 --port 5175', url: 'http://127.0.0.1:5175',
      env: { VITE_GOOGLE_CLIENT_ID: '' }, reuseExistingServer: false },
  ],
  projects: [
    { name: 'configured', testIgnore: '**/unconfigured.spec.ts', use: { baseURL: 'http://127.0.0.1:5174' } },
    { name: 'unconfigured', testMatch: '**/unconfigured.spec.ts', use: { baseURL: 'http://127.0.0.1:5175' } },
  ],
  use: { headless: true, viewport: { width: 1440, height: 900 },
    channel: process.env.PW_BROWSER_CHANNEL || undefined, trace: 'retain-on-failure' },
  reporter: [['list']],
});
