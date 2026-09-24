import { test, expect, type Page } from '@playwright/test';

type GoogleEvent = {
  id: string; summary: string; etag: string; organizer: { self: boolean }; eventType: string;
  start: { dateTime?: string; date?: string }; end: { dateTime?: string; date?: string };
  recurringEventId?: string; htmlLink: string;
};
async function setup(page: Page, options: { allDay?: boolean; hidden?: boolean; event?: Partial<GoogleEvent>; readOnly?: boolean } = {}) {
  await page.clock.install({ time: new Date('2026-09-24T03:00:00Z') });
  await page.addInitScript(hidden => localStorage.setItem('calendar95.settings', JSON.stringify({
    selectedCalendars: hidden ? ['main'] : ['main', 'other'], defaultCalendarId: 'main',
  })), !!options.hidden);
  await page.route('https://accounts.google.com/gsi/client', route => route.fulfill({
    contentType: 'application/javascript',
    body: 'window.google={accounts:{oauth2:{initTokenClient:c=>({requestAccessToken:()=>c.callback({access_token:"fake-token",expires_in:3600,scope:"https://www.googleapis.com/auth/calendar.calendarlist.readonly https://www.googleapis.com/auth/calendar.events"})})}}};',
  }));
  const event: GoogleEvent = {
    id: 'event1', summary: '移動する予定', etag: '"v1"', organizer: { self: true }, eventType: 'default',
    start: options.allDay ? { date: '2026-09-24' } : { dateTime: '2026-09-24T10:00:00+09:00' },
    end: options.allDay ? { date: '2026-09-25' } : { dateTime: '2026-09-24T11:00:00+09:00' },
    htmlLink: 'https://calendar.google.com/', ...options.event,
  };
  const state = {
    events: new Map<string, GoogleEvent>([['main', event]]),
    moveError: '', patchError: 0, readError: false,
    moves: [] as string[], patches: [] as { calendar: string; etag?: string; body: Record<string, unknown> }[],
    deletes: [] as string[],
  };
  await page.route('https://www.googleapis.com/calendar/v3/**', async route => {
    const req = route.request(), url = new URL(req.url());
    if (url.pathname.endsWith('/calendarList')) {
      await route.fulfill({ json: { items: [
        { id: 'main', summary: '仕事', accessRole: options.readOnly ? 'reader' : 'owner', primary: true },
        { id: 'other', summary: '個人', accessRole: 'writer' },
        { id: 'read', summary: '閲覧', accessRole: 'reader' },
      ] } }); return;
    }
    const calendar = url.pathname.split('/')[4];
    if (url.pathname.endsWith('/move')) {
      state.moves.push(calendar);
      expect(req.method()).toBe('POST');
      expect(req.postData()).toBeNull();
      expect(url.searchParams.get('destination')).toBe('other');
      expect(url.searchParams.get('sendUpdates')).toBe('all');
      if (state.moveError === '403' || state.moveError === '401') {
        await route.fulfill({ status: Number(state.moveError), json: {} }); return;
      }
      if (state.moveError === 'abort-before') { await route.abort(); return; }
      const original = state.events.get(calendar)!;
      state.events.delete(calendar);
      state.events.set('other', { ...original, etag: '"moved"' });
      if (state.moveError === 'abort-after') { await route.abort(); return; }
      await route.fulfill({ json: state.events.get('other') }); return;
    }
    if (req.method() === 'PATCH') {
      state.patches.push({ calendar, etag: req.headers()['if-match'], body: req.postDataJSON() });
      if (state.patchError) { await route.fulfill({ status: state.patchError, json: {} }); return; }
      const updated = { ...state.events.get(calendar)!, ...req.postDataJSON(), etag: '"updated"' };
      state.events.set(calendar, updated);
      await route.fulfill({ json: updated }); return;
    }
    if (req.method() === 'DELETE') {
      state.deletes.push(calendar); state.events.delete(calendar);
      await route.fulfill({ status: 204 }); return;
    }
    if (url.pathname.endsWith('/event1')) {
      if (state.readError) { await route.fulfill({ status: 503, json: {} }); return; }
      const stored = state.events.get(calendar);
      await route.fulfill({ status: stored ? 200 : 404, json: stored || {} }); return;
    }
    await route.fulfill({ json: { items: state.events.has(calendar) ? [state.events.get(calendar)] : [] } });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Googleに接続' }).click();
  await page.getByRole('button', { name: /移動する予定/ }).click();
  return state;
}
const calendarField = (page: Page) => page.getByRole('dialog').getByRole('combobox', { name: /^カレンダー/ });
const save = (page: Page) => page.getByRole('button', { name: '保存', exact: true }).click();

for (const allDay of [false, true]) {
  test('moves ' + (allDay ? 'all-day' : 'timed') + ' events without a redundant patch or duplicate', async ({ page }) => {
    const state = await setup(page, { allDay });
    await expect(calendarField(page).locator('option')).toHaveCount(2);
    await calendarField(page).selectOption('other');
    await expect(page.getByText('保存すると主催カレンダーが変わり、参加者に通知されます。')).toBeVisible();
    await save(page);
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(state.moves).toEqual(['main']);
    expect(state.patches).toHaveLength(0);
    await expect(page.getByRole('button', { name: /移動する予定/ })).toHaveCount(1);
    await page.getByRole('button', { name: /移動する予定/ }).click();
    await expect(calendarField(page)).toHaveValue('other');
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('calendar95.settings')!).defaultCalendarId)).toBe('main');
  });
}
test('moves to a hidden calendar and reports that it is hidden', async ({ page }) => {
  const state = await setup(page, { hidden: true });
  await calendarField(page).selectOption('other');
  await save(page);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('.statusbar')).toContainText('現在非表示');
  await expect(page.getByRole('button', { name: /移動する予定/ })).toHaveCount(0);
  expect(state.events.has('other')).toBe(true);
});
test('content failure after a move retries only the content, with the moved ETag', async ({ page }) => {
  const state = await setup(page);
  state.patchError = 403;
  await calendarField(page).selectOption('other');
  await page.getByLabel('件名').fill('移動して変更');
  await save(page);
  await expect(page.getByRole('alert')).toContainText('移動済みですが、内容変更は未保存');
  await expect(page.getByLabel('件名')).toHaveValue('移動して変更');
  state.patchError = 0;
  await save(page);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(state.moves).toEqual(['main']);
  expect(state.patches.map(p => [p.calendar, p.etag])).toEqual([['other', '"moved"'], ['other', '"moved"']]);
  await expect(page.getByRole('button', { name: /移動して変更/ })).toHaveCount(1);
});
test('reconnection after a completed move preserves the destination and edits', async ({ page }) => {
  const state = await setup(page);
  state.patchError = 401;
  await calendarField(page).selectOption('other');
  await page.getByLabel('件名').fill('再接続して変更');
  await save(page);
  await expect(page.getByRole('button', { name: '入力を保持してGoogleに再接続' })).toBeVisible();
  state.patchError = 0;
  await page.getByRole('button', { name: '入力を保持してGoogleに再接続' }).click();
  await expect(page.getByRole('button', { name: '保存', exact: true })).toBeEnabled();
  await expect(page.getByLabel('件名')).toHaveValue('再接続して変更');
  await save(page);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(state.moves).toHaveLength(1);
  expect(state.patches.every(p => p.calendar === 'other')).toBe(true);
});
test('an unsaved destination never changes the delete target', async ({ page }) => {
  const state = await setup(page);
  await calendarField(page).selectOption('other');
  await page.getByRole('button', { name: '削除…' }).click();
  await page.getByRole('button', { name: '削除する' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(state.deletes).toEqual(['main']);
  expect(state.moves).toHaveLength(0);
});
test('permission rejection preserves the source and does not save edits elsewhere', async ({ page }) => {
  const state = await setup(page);
  state.moveError = '403';
  await calendarField(page).selectOption('other');
  await page.getByLabel('件名').fill('未保存');
  await save(page);
  await expect(page.getByRole('alert')).toContainText('権限');
  expect(state.patches).toHaveLength(0);
  expect(state.events.has('main')).toBe(true);
  await page.getByRole('button', { name: 'キャンセル', exact: true }).click();
  await page.getByRole('button', { name: /移動する予定/ }).click();
  await expect(calendarField(page)).toHaveValue('main');
});
for (const outcome of ['abort-before', 'abort-after']) {
  test('reconciles uncertain move: ' + outcome, async ({ page }) => {
    const state = await setup(page);
    state.moveError = outcome;
    await calendarField(page).selectOption('other');
    await page.getByLabel('件名').fill('保持する入力');
    await save(page);
    await expect(page.getByRole('button', { name: '移動結果を確認', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: '保存', exact: true })).toBeDisabled();
    await expect(page.getByRole('button', { name: '削除…' })).toBeDisabled();
    state.readError = true;
    await page.getByRole('button', { name: '移動結果を確認', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('503');
    await expect(page.getByRole('button', { name: '保存', exact: true })).toBeDisabled();
    state.readError = false;
    await page.getByRole('button', { name: '移動結果を確認', exact: true }).click();
    await expect(page.getByRole('button', { name: '保存', exact: true })).toBeEnabled();
    await expect(page.getByLabel('件名')).toHaveValue('保持する入力');
    state.moveError = '';
    await save(page);
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(state.moves).toHaveLength(outcome === 'abort-before' ? 2 : 1);
    expect(state.patches.map(p => p.calendar)).toEqual(['other']);
    await expect(page.getByRole('button', { name: /保持する入力/ })).toHaveCount(1);
  });
}
for (const scenario of [
  { name: 'recurring', event: { recurringEventId: 'series' }, reason: '繰り返し予定の移動' },
  { name: 'special', event: { eventType: 'focusTime' }, reason: 'この種類の予定' },
  { name: 'invitation', event: { organizer: { self: false } }, reason: '主催カレンダー以外' },
  { name: 'read-only', readOnly: true, reason: '読み取り専用' },
]) {
  test('disables moving ' + scenario.name + ' events', async ({ page }) => {
    await setup(page, scenario);
    await expect(calendarField(page)).toBeDisabled();
    await expect(page.getByText(scenario.reason, { exact: false })).toBeVisible();
  });
}

test('delete after a partial save uses the completed move destination', async ({ page }) => {
  const state = await setup(page);
  state.patchError = 403;
  await calendarField(page).selectOption('other');
  await page.getByLabel('件名').fill('未保存の変更');
  await save(page);
  await expect(page.getByRole('alert')).toContainText('移動済み');
  await page.getByRole('button', { name: '削除…' }).click();
  await page.getByRole('button', { name: '削除する' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(state.deletes).toEqual(['other']);
  expect(state.events.size).toBe(0);
});
test('demo moves stay local and do not change the demo default', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-09-24T03:00:00Z') });
  await page.goto('/');
  await page.getByRole('button', { name: '設定', exact: true }).click();
  await page.getByLabel('予定追加時のデフォルトカレンダー').selectOption('sample-work');
  await page.getByRole('button', { name: '適用' }).click();
  await page.locator('[data-event-id="demo-1"]').click();
  await calendarField(page).selectOption('sample-personal');
  await save(page);
  await expect(page.locator('[data-event-id="demo-1"]')).toHaveCount(1);
  await page.locator('[data-event-id="demo-1"]').click();
  await expect(calendarField(page)).toHaveValue('sample-personal');
  await page.getByRole('button', { name: 'キャンセル', exact: true }).click();
  await page.getByRole('button', { name: '＋ 予定' }).click();
  await expect(calendarField(page)).toHaveValue('sample-work');
});
