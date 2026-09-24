import { test, expect } from '@playwright/test';
test.beforeEach(async ({ page }) => {
  await page.clock.install({ time: new Date('2026-09-24T03:00:00Z') });
  await page.goto('/');
});
test('fixed range uses the available height and survives resize and reload', async ({ page }) => {
  await expect(page.locator('.day-column')).toHaveCount(7);
  await expect(page.locator('.time-axis span').first()).toHaveText('08:00');
  await expect(page.locator('.time-axis span').last()).toHaveText('02:00');
  for (const height of [900, 640]) {
    await page.setViewportSize({ width: 1440, height });
    const dimensions = await page.evaluate(() => {
      const grid = document.querySelector('.time-grid')!.getBoundingClientRect();
      const first = document.querySelector('.time-axis span')!.getBoundingClientRect();
      const last = document.querySelector('.time-axis span:last-child')!.getBoundingClientRect();
      return { scroll: document.documentElement.scrollHeight, height: innerHeight, gridTop: grid.top, gridBottom: grid.bottom, first: (first.top + first.bottom) / 2, last: (last.top + last.bottom) / 2 };
    });
    expect(dimensions.scroll).toBeLessThanOrEqual(dimensions.height);
    expect(Math.abs(dimensions.first - dimensions.gridTop)).toBeLessThan(1);
    expect(Math.abs(dimensions.last - dimensions.gridBottom)).toBeLessThan(1);
  }
  await page.getByRole('button', { name: '設定', exact: true }).click();
  await page.getByLabel('上端（開始）').selectOption('540');
  await page.getByLabel('下端（終了）').selectOption('1320');
  await page.getByLabel('終了は翌日').uncheck();
  await page.getByRole('button', { name: '適用' }).click();
  await page.reload();
  await expect(page.locator('.time-axis span').first()).toHaveText('09:00');
  await expect(page.locator('.time-axis span').last()).toHaveText('22:00');
  await expect(page.getByRole('button', { name: /読書/ })).toHaveCount(0);
});
test('overnight editor uses the actual next-day date; create/edit/delete works', async ({ page }) => {
  await page.getByRole('button', { name: /読書/ }).click();
  await expect(page.getByLabel('開始日', { exact: true })).toHaveValue('2026-09-22');
  await expect(page.getByLabel('開始時刻')).toHaveValue('00:30');
  await page.getByLabel('件名').fill('深夜の予定');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.getByRole('button', { name: /深夜の予定/ })).toBeVisible();
  await page.getByRole('button', { name: /深夜の予定/ }).click();
  await page.getByRole('button', { name: '削除…' }).click();
  await page.getByRole('button', { name: '削除する' }).click();
  await expect(page.getByRole('button', { name: /深夜の予定/ })).toHaveCount(0);
  await page.getByRole('button', { name: '＋ 予定' }).click();
  await page.getByLabel('件名').fill('新しいテスト');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.getByRole('button', { name: /新しいテスト/ })).toBeVisible();
});
test('dragging across columns preserves duration and updates real dates', async ({ page }) => {
  const source = page.locator('[data-event-id="demo-1"]');
  const box = (await source.boundingBox())!;
  const cols = page.locator('.day-column');
  const first = (await cols.nth(0).boundingBox())!, second = (await cols.nth(1).boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + second.x - first.x, box.y + box.height / 2, { steps: 8 });
  await page.mouse.up();
  await expect(cols.nth(1).locator('[data-event-id="demo-1"]')).toBeVisible();
  await source.click();
  await expect(page.getByLabel('開始日', { exact: true })).toHaveValue('2026-09-22');
  await expect(page.getByLabel('開始時刻')).toHaveValue('09:00');
  await expect(page.getByLabel('終了時刻')).toHaveValue('10:15');
});
test('dragging blank space creates a range; resize changes duration', async ({ page }) => {
  const column = (await page.locator('.day-column').nth(3).boundingBox())!;
  await page.mouse.move(column.x + 30, column.y + column.height * 2 / 18);
  await page.mouse.down();
  await page.mouse.move(column.x + 30, column.y + column.height * 3 / 18, { steps: 8 });
  await page.mouse.up();
  await expect(page.getByLabel('開始時刻')).toHaveValue('10:00');
  await expect(page.getByLabel('終了時刻')).toHaveValue('11:00');
  await page.getByLabel('件名').fill('範囲テスト');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  const event = page.getByRole('button', { name: /範囲テスト/ });
  const handle = (await event.locator('.resize-end').boundingBox())!;
  await page.mouse.move(handle.x + 20, handle.y + handle.height / 2);
  await page.mouse.down();
  await page.mouse.move(handle.x + 20, handle.y + handle.height / 2 + column.height / 18, { steps: 8 });
  await page.mouse.up();
  await event.click();
  await expect(page.getByLabel('終了時刻')).toHaveValue('12:00');
});
test('settings validation, calendar visibility and month navigation', async ({ page }) => {
  await page.getByRole('button', { name: '設定', exact: true }).click();
  await page.getByLabel('終了は翌日').uncheck();
  await expect(page.getByRole('button', { name: '適用' })).toBeDisabled();
  await page.getByLabel('終了は翌日').check();
  await page.getByLabel('土曜日・日曜日を表示').uncheck();
  await page.getByLabel('仕事', { exact: true }).uncheck();
  await page.getByRole('button', { name: '適用' }).click();
  await expect(page.locator('.day-column')).toHaveCount(5);
  await expect(page.getByRole('button', { name: /週間プランニング/ })).toHaveCount(0);
  await page.getByRole('button', { name: '月', exact: true }).click();
  await expect(page.locator('.month-cell')).toHaveCount(30);
  await page.getByRole('button', { name: '次の期間' }).click();
  await expect(page.getByRole('heading')).toHaveText('2026年 10月');
});
test('all-day dates are inclusive in the editor and exclusive on the calendar', async ({ page }) => {
  await page.getByRole('button', { name: '＋ 予定' }).click();
  await page.getByLabel('件名').fill('2日間');
  await page.getByLabel('終日', { exact: true }).check();
  await page.getByLabel('開始日', { exact: true }).fill('2026-09-24');
  await page.getByLabel('終了日', { exact: true }).fill('2026-09-25');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.locator('.all-day-event').filter({ hasText: '2日間' })).toHaveCount(2);
});
test('mobile opens day view without horizontal overflow and supports keyboard dialogs', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await expect(page.locator('.day-column')).toHaveCount(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
  await page.getByRole('button', { name: '＋ 予定' }).click();
  await expect(page.getByLabel('件名')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '＋ 予定' })).toBeFocused();
});
