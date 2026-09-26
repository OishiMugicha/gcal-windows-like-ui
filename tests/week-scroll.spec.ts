import { test, expect, type Page } from '@playwright/test';

const columns = (page: Page) => page.locator('.day-column:not([inert])');
async function settle(page: Page) {
  await page.clock.runFor(400);
  await expect(page.locator('.week-viewport')).toHaveAttribute('data-moving', 'false');
}
async function wheel(page: Page, days: number, shift = false) {
  await page.locator('.week-viewport').evaluate((el, { days, shift }) => {
    const delta = (el.clientWidth - 58) / 7 * days;
    el.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true,
      deltaX: shift ? 0 : delta, deltaY: shift ? delta : 0, shiftKey: shift }));
  }, { days, shift });
}
test.beforeEach(async ({ page }) => {
  await page.clock.install({ time: new Date('2026-09-24T03:00:00Z') });
  await page.goto('/');
});

test('follows horizontal input, keeps all rows aligned and snaps to Wednesday–Tuesday', async ({ page }) => {
  const before = await columns(page).first().boundingBox();
  const axis = await page.locator('.time-axis').boundingBox();
  await wheel(page, 1.7);
  const during = await page.locator('[data-day="2026-09-21"]').boundingBox();
  expect(during!.x).toBeCloseTo(before!.x - before!.width * 1.7, 0);
  expect((await page.locator('.time-axis').boundingBox())!.x).toBeCloseTo(axis!.x, 1);
  await settle(page);
  await expect(columns(page).first()).toHaveAttribute('data-day', '2026-09-23');
  await expect(columns(page).last()).toHaveAttribute('data-day', '2026-09-29');
  await expect(page.getByRole('heading')).toHaveText('2026.09.23 — 09.29');
  const head = await page.getByRole('button', { name: '2026-09-23の日表示' }).boundingBox();
  const allDay = await page.locator('.all-day-cell:not([inert])').first().boundingBox();
  const column = await columns(page).first().boundingBox();
  expect(head!.x).toBeCloseTo(column!.x, 1);
  expect(allDay!.x).toBeCloseTo(column!.x, 1);
  expect(column!.x).toBeCloseTo(before!.x, 1);
  await page.screenshot({ path: '.runtime/rolling-week.png' });
});

test('buttons, Shift-wheel, repeated recycling and today retain the correct dates', async ({ page }) => {
  await page.getByRole('button', { name: '1日後へ' }).click();
  await page.getByRole('button', { name: '1日後へ' }).click();
  await settle(page);
  await expect(columns(page).first()).toHaveAttribute('data-day', '2026-09-23');
  await page.getByRole('button', { name: '次の期間' }).click();
  await settle(page);
  await expect(columns(page).first()).toHaveAttribute('data-day', '2026-09-30');
  await wheel(page, 30, true); await settle(page);
  await expect(columns(page).first()).toHaveAttribute('data-day', '2026-10-30');
  await wheel(page, -37); await settle(page);
  await expect(columns(page).first()).toHaveAttribute('data-day', '2026-09-23');
  await expect(page.locator('.day-column')).toHaveCount(21);
  await page.getByRole('button', { name: '1日前へ' }).focus();
  await page.keyboard.press('Enter'); await settle(page);
  await expect(columns(page).first()).toHaveAttribute('data-day', '2026-09-22');
  await page.getByRole('button', { name: '今日', exact: true }).click();
  await expect(columns(page).first()).toHaveAttribute('data-day', '2026-09-21');
  await expect(columns(page)).toHaveCount(7);
});

test('ignores vertical wheel and prevents wheel navigation during event dragging', async ({ page }) => {
  await page.locator('.week-viewport').dispatchEvent('wheel', { deltaY: 400 });
  await settle(page);
  await expect(columns(page).first()).toHaveAttribute('data-day', '2026-09-21');
  const event = page.locator('[data-event-id="demo-1"]');
  const box = (await event.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await wheel(page, 3); await settle(page);
  await expect(columns(page).first()).toHaveAttribute('data-day', '2026-09-21');
  await page.mouse.move(box.x + box.width / 2 + (await columns(page).first().boundingBox())!.width,
    box.y + box.height / 2, { steps: 5 });
  await page.mouse.up();
  await expect(columns(page).nth(1).locator('[data-event-id="demo-1"]')).toBeVisible();
});

test('shifted dates support creation, resize, view changes and Sunday reset', async ({ page }) => {
  await wheel(page, 2); await settle(page);
  const column = (await columns(page).first().boundingBox())!;
  await page.mouse.click(column.x + 30, column.y + column.height * 8 / 18);
  await expect(page.getByLabel('開始日', { exact: true })).toHaveValue('2026-09-23');
  await page.getByLabel('件名').fill('横移動後の予定');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  const event = page.getByRole('button', { name: /横移動後の予定/ });
  const handle = (await event.locator('.resize-end').boundingBox())!;
  await page.mouse.move(handle.x + 20, handle.y + handle.height / 2);
  await page.mouse.down();
  await page.mouse.move(handle.x + 20, handle.y + handle.height / 2 + column.height / 18, { steps: 5 });
  await page.mouse.up(); await event.click();
  await expect(page.getByLabel('終了時刻')).toHaveValue('18:00');
  await page.getByRole('button', { name: 'キャンセル', exact: true }).click();
  await page.getByRole('button', { name: '2026-09-29の日表示' }).click();
  await expect(columns(page)).toHaveCount(1);
  await page.getByRole('button', { name: '週', exact: true }).click();
  await expect(columns(page).first()).toHaveAttribute('data-day', '2026-09-28');
  await page.getByRole('button', { name: '設定', exact: true }).click();
  await page.getByLabel('週の始まり').selectOption('0');
  await expect(page.getByLabel('土曜日・日曜日を表示')).toHaveCount(0);
  await page.getByRole('button', { name: '適用', exact: true }).click();
  await expect(columns(page).first()).toHaveAttribute('data-day', '2026-09-27');
  await page.getByRole('button', { name: '今日', exact: true }).click();
  await expect(columns(page).first()).toHaveAttribute('data-day', '2026-09-20');
});

test('resize settles to the committed date, reduced motion jumps, old preferences migrate', async ({ page }) => {
  await page.evaluate(() => localStorage.setItem('calendar95.settings', JSON.stringify({ showWeekends: false, view: 'week' })));
  await page.reload();
  await expect(columns(page)).toHaveCount(7);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('calendar95.settings')!))).not.toHaveProperty('showWeekends');
  await wheel(page, 2); await settle(page);
  await wheel(page, 0.7);
  await page.setViewportSize({ width: 1100, height: 700 });
  await settle(page);
  await expect(columns(page).first()).toHaveAttribute('data-day', '2026-09-23');
  const box = (await columns(page).first().boundingBox())!;
  const axis = (await page.locator('.time-axis').boundingBox())!;
  expect(box.x).toBeCloseTo(axis.x + axis.width, 1);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.getByRole('button', { name: '1日後へ' }).click();
  await expect(columns(page).first()).toHaveAttribute('data-day', '2026-09-24');
  await expect(page.locator('.week-viewport')).toHaveAttribute('data-moving', 'false');
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(1100);
});

test('prefetches three weeks, reuses them and rejects late responses after navigation', async ({ page }) => {
  const requests: URL[] = [];
  const pending: { release: () => void; done: Promise<void> }[] = [];
  let hold = false, fail = false;
  await page.route('https://accounts.google.com/gsi/client', route => route.fulfill({ contentType: 'application/javascript',
    body: `window.google={accounts:{oauth2:{initTokenClient:c=>({requestAccessToken:()=>c.callback({access_token:'fake',expires_in:3600,scope:c.scope})})}}};` }));
  await page.route('https://www.googleapis.com/calendar/v3/**', async route => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/calendarList')) return route.fulfill({ json: { items: [{ id: 'main', summary: '個人', accessRole: 'owner', primary: true }] } });
    requests.push(url);
    const number = requests.length;
    if (hold) {
      let release!: () => void, done!: () => void;
      const wait = new Promise<void>(resolve => { release = resolve; });
      const completed = new Promise<void>(resolve => { done = resolve; });
      pending.push({ release, done: completed });
      await wait;
      await route.fulfill({ json: { items: [{ id: 'event', summary: `取得${number}`, start: { date: '2026-09-30' }, end: { date: '2026-10-01' } }] } });
      done(); return;
    }
    await route.fulfill(fail ? { status: 403, json: {} } : { json: { items: [{ id: 'event', summary: '取得済みの予定', start: { date: '2026-09-30' }, end: { date: '2026-10-01' } }] } });
  });
  await page.reload();
  await page.getByRole('button', { name: 'Googleに接続', exact: true }).click();
  await expect(page.getByRole('button', { name: '予定を更新' })).toBeEnabled();
  expect(requests).toHaveLength(1);
  expect(requests[0].searchParams.get('timeMin')).toBe('2026-09-13T15:00:00.000Z');
  expect(requests[0].searchParams.get('timeMax')).toBe('2026-10-04T17:00:00.000Z');
  await wheel(page, 3); await settle(page);
  expect(requests).toHaveLength(1);
  await expect(page.getByRole('button', { name: '取得済みの予定', exact: true })).toBeVisible();
  hold = true;
  await wheel(page, 4); await settle(page);
  await expect.poll(() => pending.length).toBe(1);
  await expect(page.getByRole('button', { name: '取得済みの予定', exact: true })).toBeVisible();
  // Newly prefetched columns must not imply that they are empty before a reply.
  await expect(page.locator('[data-day="2026-10-05"] .day-loading')).toHaveText('予定を取得中…');
  await wheel(page, -7); await settle(page);
  await expect.poll(() => pending.length).toBe(2);
  pending[1].release(); await pending[1].done;
  await expect(page.getByRole('button', { name: '予定を更新' })).toBeEnabled();
  pending[0].release(); await pending[0].done;
  await wheel(page, 3); await settle(page);
  await expect(page.getByRole('button', { name: '取得3', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '取得2', exact: true })).toHaveCount(0);
  hold = false; fail = true;
  await wheel(page, 4); await settle(page);
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.getByRole('button', { name: '取得3', exact: true })).toBeVisible();
  await expect(page.locator('[data-day="2026-10-05"] .day-loading')).toHaveText('予定は未取得です');
});

async function pixelWheel(page: Page, deltaX: number) {
  await page.locator('.week-viewport').dispatchEvent('wheel', { deltaX });
  await page.clock.runFor(16);
}

test('snaps to the predicted destination while momentum still has speed, then accepts acceleration and reversal', async ({ page }) => {
  await page.clock.pauseAt(new Date('2026-09-24T03:01:00Z'));
  const width = (await columns(page).first().boundingBox())!.width;
  await pixelWheel(page, 1);
  let stoppedAt = 0;
  for (let time = 16; time <= 608; time += 16) {
    const delta = width * 0.03 * 140 * (Math.exp(-(time - 16) / 140) - Math.exp(-time / 140));
    await pixelWheel(page, delta);
    if (!stoppedAt && await page.locator('.week-viewport').getAttribute('data-moving') === 'false') {
      stoppedAt = time;
      expect(delta).toBeGreaterThan(4);
    }
  }
  expect(stoppedAt).toBeGreaterThan(0);
  expect(stoppedAt).toBeLessThanOrEqual(400);
  await expect(columns(page).first()).toHaveAttribute('data-day', '2026-09-25');
  const before = (await columns(page).first().boundingBox())!.x;
  await pixelWheel(page, 0.5);
  expect((await columns(page).first().boundingBox())!.x).toBeCloseTo(before, 1);
  // Two accelerating samples distinguish a fresh push from momentum noise.
  await pixelWheel(page, 20);
  await pixelWheel(page, 20);
  expect((await columns(page).first().boundingBox())!.x).toBeCloseTo(before - 20, 1);
  await pixelWheel(page, -2);
  expect((await columns(page).first().boundingBox())!.x).toBeCloseTo(before - 18, 1);
  await settle(page);
});

test('keeps slow deliberate scrolling responsive and falls back to snapping after input stops', async ({ page }) => {
  await page.clock.pauseAt(new Date('2026-09-24T03:01:00Z'));
  const initial = (await columns(page).first().boundingBox())!.x;
  for (let i = 0; i < 12; i++) await pixelWheel(page, 2);
  expect((await columns(page).first().boundingBox())!.x).toBeCloseTo(initial - 24, 1);
  await expect(page.locator('.week-viewport')).toHaveAttribute('data-moving', 'true');
  await settle(page);
  const settled = (await columns(page).first().boundingBox())!.x;
  await pixelWheel(page, 2);
  expect((await columns(page).first().boundingBox())!.x).toBeCloseTo(settled - 2, 1);
  await settle(page);
});
