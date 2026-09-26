import { test, expect } from '@playwright/test';
test('capture desktop, settings and mobile layouts', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-09-24T03:00:00Z') });
  await page.goto('/');
  await expect(page.locator('.day-column:not([inert])')).toHaveCount(7);
  await page.screenshot({ path: '.runtime/desktop.png' });
  await page.getByRole('button', { name: '設定', exact: true }).click();
  await page.screenshot({ path: '.runtime/settings.png' });
  await page.keyboard.press('Escape');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await expect(page.locator('.day-column:not([inert])')).toHaveCount(1);
  await page.screenshot({ path: '.runtime/mobile.png' });
});
