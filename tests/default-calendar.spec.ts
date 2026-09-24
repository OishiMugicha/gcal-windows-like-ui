import { test, expect } from '@playwright/test';

test('default calendar persists, applies to both entry points and stays separate from demo', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-09-24T03:00:00Z') });
  await page.route('https://accounts.google.com/gsi/client', route => route.fulfill({
    contentType: 'application/javascript',
    body: 'window.google={accounts:{oauth2:{initTokenClient:c=>({requestAccessToken:()=>c.callback({access_token:"fake-token",expires_in:3600,scope:"https://www.googleapis.com/auth/calendar.calendarlist.readonly https://www.googleapis.com/auth/calendar.events"})})}}};',
  }));
  const writes: string[] = [];
  let otherWritable = true;
  await page.route('https://www.googleapis.com/calendar/v3/**', route => {
    const req = route.request();
    if (req.url().includes('/calendarList')) return route.fulfill({ json: { items: [
      { id: 'main', summary: '仕事', accessRole: 'owner', primary: true },
      { id: 'other', summary: '個人', accessRole: otherWritable ? 'writer' : 'reader' },
      { id: 'read', summary: '閲覧', accessRole: 'reader' },
    ] } });
    if (req.method() === 'POST') {
      writes.push(new URL(req.url()).pathname);
      return route.fulfill({ json: req.postDataJSON() });
    }
    return route.fulfill({ json: { items: [] } });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Googleに接続' }).click();
  await expect(page.getByRole('button', { name: '接続解除', exact: true })).toBeVisible();
  const settings = () => page.getByRole('button', { name: '設定', exact: true }).click();
  const preference = page.getByLabel('予定追加時のデフォルトカレンダー');
  await settings();
  await expect(preference.locator('option')).toHaveCount(3);
  await preference.selectOption('other');
  await page.getByRole('button', { name: 'キャンセル', exact: true }).click();
  await settings();
  await expect(preference).toHaveValue('');
  await preference.selectOption('other');
  await page.getByRole('button', { name: '適用' }).click();
  await page.reload();
  await expect(page.getByRole('button', { name: '接続解除', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '＋ 予定' }).click();
  await expect(page.getByRole('dialog').getByRole('combobox', { name: /^カレンダー/ })).toHaveValue('other');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.locator('.statusbar')).toContainText('現在非表示');
  expect(writes).toEqual(['/calendar/v3/calendars/other/events']);
  await page.locator('.day-column').nth(3).click({ position: { x: 30, y: 100 } });
  await expect(page.getByRole('dialog').getByRole('combobox', { name: /^カレンダー/ })).toHaveValue('other');
  await page.getByRole('dialog').getByRole('combobox', { name: /^カレンダー/ }).selectOption('main');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await settings();
  await expect(preference).toHaveValue('other');
  await page.getByRole('button', { name: 'キャンセル', exact: true }).click();
  await page.getByRole('button', { name: '接続解除', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: '接続解除', exact: true }).click();
  await settings();
  await preference.selectOption('sample-personal');
  await page.getByRole('button', { name: '適用' }).click();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('calendar95.settings')!).defaultCalendarId)).toBe('other');
  otherWritable = false;
  await page.getByRole('button', { name: 'Googleに接続' }).click();
  await expect(page.getByRole('button', { name: '接続解除', exact: true })).toBeVisible();
  await settings();
  await expect(preference).toHaveValue('other');
  await expect(page.getByText('設定済みのカレンダーは利用できません。現在は自動選択します。')).toBeVisible();
  await page.getByRole('button', { name: '適用' }).click();
  await page.getByRole('button', { name: '＋ 予定' }).click();
  await expect(page.getByRole('dialog').getByRole('combobox', { name: /^カレンダー/ })).toHaveValue('main');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('calendar95.settings')!).defaultCalendarId)).toBe('other');
});
