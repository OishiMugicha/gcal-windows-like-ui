import { test, expect } from '@playwright/test';

test('missing environment ID keeps the demo usable and ignores legacy credentials', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('calendar95.settings', JSON.stringify({ clientId: 'legacy.apps.googleusercontent.com' }));
    localStorage.setItem('calendar95.connection', JSON.stringify({
      version: 1, clientId: 'legacy.apps.googleusercontent.com', token: 'fake-token', expiresAt: Date.now() + 3600000,
    }));
  });
  const requests: string[] = [];
  await page.route(/https:\/\/(accounts\.google\.com|www\.googleapis\.com)\//, route => {
    requests.push(route.request().url());
    return route.abort();
  });
  await page.goto('/');
  await expect(page.locator('.day-column:not([inert])')).toHaveCount(7);
  await page.getByRole('button', { name: 'Googleに接続' }).click();
  await expect(page.getByText('Google接続はまだ設定されていません。サイトの管理者にお問い合わせください。')).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem('calendar95.connection'))).toBeNull();
  await page.getByRole('button', { name: '＋ 予定' }).click();
  await page.getByLabel('件名').fill('サンプルの予定');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(requests).toEqual([]);
});
