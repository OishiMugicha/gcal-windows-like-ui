import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  workers: 2,
  use: { baseURL: 'http://localhost:5173', headless: true, viewport: { width: 1440, height: 900 },
    channel: process.env.PW_BROWSER_CHANNEL || undefined, trace: 'retain-on-failure' },
  reporter: [['list']],
});
