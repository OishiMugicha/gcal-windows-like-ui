import { test, expect, type Page, type Locator } from '@playwright/test';

async function range(page: Page, start: string, end: string, nextDay = false) {
  await page.getByRole('button', { name: '設定', exact: true }).click();
  await page.getByLabel('上端（開始）').selectOption(start);
  await page.getByLabel('下端（終了）').selectOption(end);
  await page.getByLabel('終了は翌日').setChecked(nextDay);
  await page.getByRole('button', { name: '適用' }).click();
}
async function font(event: Locator) {
  return event.locator('strong').evaluate(el => parseFloat(getComputedStyle(el).fontSize));
}
async function fits(event: Locator) {
  await expect.poll(() => event.evaluate(el => {
    const title = el.querySelector('strong')!;
    const box = el.getBoundingClientRect(), text = title.getBoundingClientRect();
    return text.top >= box.top - 1.1
      && text.bottom <= box.bottom + 1.1
      && text.height >= parseFloat(getComputedStyle(title).lineHeight) - 0.1;
  })).toBe(true);
}
async function create(page: Page, title: string, start: string, end: string) {
  await page.getByRole('button', { name: '＋ 予定' }).click();
  await page.getByLabel('件名').fill(title);
  await page.getByLabel('開始日', { exact: true }).fill('2026-09-24');
  await page.getByLabel('終了日', { exact: true }).fill('2026-09-24');
  await page.getByLabel('開始時刻').fill(start);
  await page.getByLabel('終了時刻').fill(end);
  await page.getByRole('button', { name: '保存', exact: true }).click();
  return page.locator('.event-block').filter({ hasText: title });
}
test.beforeEach(async ({ page }) => {
  await page.clock.install({ time: new Date('2026-09-24T03:00:00Z') });
  await page.goto('/');
});

test('30-minute titles follow range, viewport and all-day row height', async ({ page }) => {
  const event = await create(page, '30分の予定', '10:00', '10:30');
  await fits(event);
  await expect(event.locator('.event-time')).toHaveCount(0);
  const initial = await font(event);
  const slotHeight = await event.evaluate(el => el.getBoundingClientRect().height);
  expect(initial).toBeCloseTo(Math.min(24, slotHeight + 2), 1);
  await expect(event).toHaveCSS('overflow', 'visible');
  await range(page, '540', '720');
  await expect.poll(() => font(event)).toBe(24);
  await expect(event.locator('.event-time')).toBeVisible();
  await fits(event);
  await range(page, '0', '0', true);
  await expect.poll(() => font(event)).toBeLessThan(initial);
  await fits(event);
  const fullDay = await font(event);
  await page.setViewportSize({ width: 1440, height: 640 });
  await expect.poll(() => font(event)).toBeLessThan(fullDay);
  await fits(event);
  const shorter = await font(event);
  // Isolate a layout-only change to verify the observer, without a settings change.
  await page.locator('.all-day-row').evaluate(el => { (el as HTMLElement).style.minHeight = '100px'; });
  await expect.poll(() => font(event)).toBeLessThan(shorter);
  await fits(event);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: '日', exact: true }).click();
  await fits(event);
});

test('short and clipped events allow slight overflow and retain full accessible text', async ({ page }) => {
  const longTitle = '長いタイトルの予定を省略して表示するための確認'.repeat(5);
  const event = await create(page, longTitle, '10:00', '10:30');
  const short = await create(page, '15分の予定', '11:00', '11:15');
  await fits(event);
  await fits(short);
  expect(await font(short)).toBeLessThan(await font(event));
  await expect(event).toHaveAccessibleName(longTitle + ' 10:00〜10:30');
  await expect(event).toHaveAttribute('title', longTitle + '\n10:00 – 10:30');
  expect(await event.locator('strong').evaluate(el => {
    const style = getComputedStyle(el);
    return style.textOverflow === 'ellipsis' && style.whiteSpace === 'nowrap' && el.scrollWidth > el.clientWidth;
  })).toBe(true);
  const clippedStart = await create(page, '上端で切れる予定', '09:45', '10:15');
  const clippedEnd = await create(page, '下端で切れる予定', '11:45', '12:15');
  await range(page, '600', '720');
  await expect(clippedStart).toHaveClass(/clipped-start/);
  await expect(clippedEnd).toHaveClass(/clipped-end/);
  await fits(clippedStart);
  await fits(clippedEnd);
  // Keep both clipped fragments at 15 minutes while making the grid very short.
  await page.locator('.time-grid').evaluate(el => {
    (el as HTMLElement).style.flex = 'none';
    (el as HTMLElement).style.height = '100px';
  });
  await expect(clippedStart).toHaveClass(/compact/);
  await expect(clippedEnd).toHaveClass(/compact/);
  await fits(clippedStart);
  await fits(clippedEnd);
});
