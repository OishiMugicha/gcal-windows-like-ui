import { test, expect, type Page } from '@playwright/test';
const scope = 'https://www.googleapis.com/auth/calendar.calendarlist.readonly https://www.googleapis.com/auth/calendar.events';
async function mockGoogle(page: Page) {
  await page.clock.install({ time: new Date('2026-09-24T03:00:00Z') });
  await page.route('https://accounts.google.com/gsi/client', route => route.fulfill({
    contentType: 'application/javascript',
    body: 'window.google={accounts:{oauth2:{initTokenClient: c => {if(c.client_id!=="test.apps.googleusercontent.com")throw new Error("Unexpected client ID");return ({requestAccessToken:()=>c.callback({access_token:"fake-token",expires_in:3600,scope:' + JSON.stringify(scope) + '})});}}}};',
  }));
}
const instance = { id: 'instance1', recurringEventId: 'master1', summary: '深夜の繰り返し', etag: '"v1"',
  start: { dateTime: '2026-09-22T01:00:00+09:00' }, end: { dateTime: '2026-09-22T01:30:00+09:00' } };
test('Google pagination, recurring instance update, failure recovery and reconnection', async ({ page }) => {
  await mockGoogle(page);
  let stored = { ...instance }, failPatch = false, expire = false;
  const patches: { url: string; body: Record<string, unknown>; etag?: string }[] = [];
  const fetchedPages: string[] = [];
  await page.route('https://www.googleapis.com/calendar/v3/**', async route => {
    const req = route.request(), url = new URL(req.url());
    if (expire) { await route.fulfill({ status: 401, json: {} }); return; }
    if (url.pathname.endsWith('/calendarList')) {
      await route.fulfill({ json: { items: [{ id: 'main@example.com', summary: '仕事', accessRole: 'owner', primary: true }] } }); return;
    }
    if (req.method() === 'PATCH') {
      patches.push({ url: url.pathname, body: req.postDataJSON(), etag: req.headers()['if-match'] });
      if (failPatch) { await route.fulfill({ status: 503, json: {} }); return; }
      stored = { ...stored, ...req.postDataJSON(), etag: '"v2"' };
      await route.fulfill({ json: stored }); return;
    }
    fetchedPages.push(url.searchParams.get('pageToken') || 'first');
    expect(url.searchParams.get('singleEvents')).toBe('true');
    await route.fulfill({ json: url.searchParams.has('pageToken') ? { items: [stored] } : { items: [], nextPageToken: 'second' } });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Googleに接続' }).click();
  await expect(page.getByRole('button', { name: /深夜の繰り返し/ })).toBeVisible();
  expect(fetchedPages).toContain('second');
  await page.getByRole('button', { name: /深夜の繰り返し/ }).click();
  await expect(page.getByText('繰り返し予定の、この1回だけを変更します。')).toBeVisible();
  await expect(page.getByLabel('開始日', { exact: true })).toHaveValue('2026-09-22');
  await page.getByLabel('件名').fill('変更した今回分');
  failPatch = true;
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('503');
  await expect(page.getByLabel('件名')).toHaveValue('変更した今回分');
  failPatch = false;
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(patches[1].url).toContain('/events/instance1');
  expect(patches[1].body).not.toHaveProperty('recurrence');
  expect(patches[1].etag).toBe('"v1"');
  expire = true;
  await page.getByRole('button', { name: '予定を更新' }).click();
  await expect(page.getByRole('button', { name: '再接続' })).toBeVisible();
  expire = false;
  await page.getByRole('button', { name: '再接続' }).click();
  await expect(page.getByRole('button', { name: /変更した今回分/ })).toBeVisible();
  await page.getByRole('button', { name: /変更した今回分/ }).click();
  await page.getByLabel('件名').fill('接続が切れても保持');
  expire = true;
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.getByRole('button', { name: '入力を保持してGoogleに再接続' })).toBeVisible();
  expire = false;
  await page.getByRole('button', { name: '入力を保持してGoogleに再接続' }).click();
  await expect(page.getByLabel('件名')).toHaveValue('接続が切れても保持');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const localData = await page.evaluate(() => JSON.stringify(localStorage));
  expect(localData).toContain('fake-token');
  expect(localData).not.toContain('変更した今回分');
});
test('create retries use a stable id so an uncertain response cannot duplicate an event', async ({ page }) => {
  await mockGoogle(page);
  const ids: string[] = [];
  await page.route('https://www.googleapis.com/calendar/v3/**', async route => {
    const req = route.request();
    if (req.url().includes('/calendarList')) {
      await route.fulfill({ json: { items: [{ id: 'main', summary: '個人', accessRole: 'owner', primary: true }] } }); return;
    }
    if (req.method() === 'POST') {
      ids.push(req.postDataJSON().id);
      if (ids.length === 1) await route.abort();
      else await route.fulfill({ status: 409, json: {} });
      return;
    }
    await route.fulfill({ json: { items: [] } });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Googleに接続' }).click();
  await expect(page.getByRole('button', { name: '接続解除' })).toBeVisible();
  await page.getByRole('button', { name: '＋ 予定' }).click();
  await page.getByLabel('件名').fill('ネットワークエラー');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('保存結果を確認できません');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('すでに保存されています');
  expect(ids).toHaveLength(2); expect(ids[0]).toBe(ids[1]);
});
test('read-only calendars cannot be edited', async ({ page }) => {
  await mockGoogle(page);
  await page.route('https://www.googleapis.com/calendar/v3/**', async route => {
    if (route.request().url().includes('/calendarList')) {
      await route.fulfill({ json: { items: [{ id: 'readonly', summary: '共有', accessRole: 'reader', primary: true }] } }); return;
    }
    await route.fulfill({ json: { items: [instance] } });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Googleに接続' }).click();
  await page.getByRole('button', { name: /深夜の繰り返し/ }).click();
  await expect(page.getByText('このカレンダーは読み取り専用です。')).toBeVisible();
  await expect(page.getByRole('button', { name: '保存', exact: true })).toHaveCount(0);
});

async function mockCalendar(page: Page) {
  await page.route('https://www.googleapis.com/calendar/v3/**', route => route.fulfill({ json: {
    items: route.request().url().includes('/calendarList')
      ? [{ id: 'main', summary: '仕事', accessRole: 'owner', primary: true }] : [instance],
  } }));
}

test('saved connection restores after reload and in another page, and disconnect clears it', async ({ page, context }) => {
  await mockGoogle(page); await mockCalendar(page);
  await page.goto('/');
  await page.getByRole('button', { name: 'Googleに接続' }).click();
  await expect(page.getByRole('button', { name: /深夜の繰り返し/ })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('button', { name: /深夜の繰り返し/ })).toBeVisible();
  const other = await context.newPage();
  await mockGoogle(other); await mockCalendar(other);
  await other.goto('/');
  await expect(other.getByRole('button', { name: /深夜の繰り返し/ })).toBeVisible();
  await other.close();
  await page.getByRole('button', { name: '接続解除', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: '接続解除' }).click();
  expect(await page.evaluate(() => localStorage.getItem('calendar95.connection'))).toBeNull();
  await page.reload();
  await expect(page.getByRole('button', { name: 'Googleに接続' })).toBeVisible();
});

for (const kind of ['expired', 'corrupt', 'different-client', 'unauthorized'] as const) {
  test(`saved connection rejects ${kind}`, async ({ page }) => {
    await mockGoogle(page);
    await page.addInitScript(kind => localStorage.setItem('calendar95.connection', kind === 'corrupt' ? '{invalid' : JSON.stringify({
      version: 1, token: 'fake-token', clientId: kind === 'different-client' ? 'other-client' : 'test.apps.googleusercontent.com',
      expiresAt: Date.now() + (kind === 'expired' ? -1 : 3600000),
    })), kind);
    let requests = 0;
    await page.route('https://www.googleapis.com/calendar/v3/**', route => { requests++; return route.fulfill({ status: 401, json: {} }); });
    await page.goto('/');
    await expect(page.getByRole('button', { name: kind === 'expired' || kind === 'unauthorized' ? '再接続' : 'Googleに接続', exact: true })).toBeVisible();
    expect(await page.evaluate(() => localStorage.getItem('calendar95.connection'))).toBeNull();
    if (kind !== 'unauthorized') expect(requests).toBe(0);
  });
}

test('restoration can retry after network failure without another authorization', async ({ page }) => {
  await mockGoogle(page); await mockCalendar(page);
  await page.goto('/');
  await page.getByRole('button', { name: 'Googleに接続' }).click();
  await expect(page.getByRole('button', { name: /深夜の繰り返し/ })).toBeVisible();
  await page.route('https://www.googleapis.com/calendar/v3/**', route => route.abort());
  await page.reload();
  await expect(page.getByRole('button', { name: '接続の復元を再試行' })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('calendar95.connection'))).toContain('fake-token');
  await mockCalendar(page);
  await page.getByRole('button', { name: '接続の復元を再試行' }).click();
  await expect(page.getByRole('button', { name: /深夜の繰り返し/ })).toBeVisible();
});

test('unavailable storage still allows connection in memory', async ({ page }) => {
  await mockGoogle(page); await mockCalendar(page);
  await page.addInitScript(() => {
    const setItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function(key, value) {
      if (key === 'calendar95.connection') throw new DOMException('Unavailable', 'QuotaExceededError');
      return setItem.call(this, key, value);
    };
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Googleに接続' }).click();
  await expect(page.getByRole('button', { name: /深夜の繰り返し/ })).toBeVisible();
  await expect(page.getByText('接続しましたが、接続情報を保存できません。次回は再接続が必要です。')).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('calendar95.connection'))).toBeNull();
});

test('legacy client ID is ignored and display settings preserve the connection', async ({ page }) => {
  await mockGoogle(page); await mockCalendar(page);
  await page.addInitScript(() => localStorage.setItem('calendar95.settings', JSON.stringify({
    clientId: 'legacy.apps.googleusercontent.com', startMinute: 540, endMinute: 1200,
  })));
  await page.goto('/');
  await page.getByRole('button', { name: 'Googleに接続' }).click();
  await expect(page.getByRole('button', { name: /深夜の繰り返し/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '接続解除', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '設定', exact: true }).click();
  await expect(page.getByText('Google接続設定', { exact: true })).toHaveCount(0);
  await expect(page.getByLabel('OAuthクライアントID')).toHaveCount(0);
  await expect(page.getByLabel('上端（開始）')).toHaveValue('540');
  await page.getByRole('button', { name: '適用' }).click();
  await expect(page.getByRole('button', { name: '接続解除', exact: true })).toBeVisible();
  const saved = await page.evaluate(() => ({
    settings: JSON.parse(localStorage.getItem('calendar95.settings')!),
    connection: JSON.parse(localStorage.getItem('calendar95.connection')!),
  }));
  expect(saved.settings).not.toHaveProperty('clientId');
  expect(saved.connection.clientId).toBe('test.apps.googleusercontent.com');
});

test('token expiration during use clears storage and offers reconnect', async ({ page }) => {
  await mockGoogle(page); await mockCalendar(page);
  await page.goto('/');
  await page.getByRole('button', { name: 'Googleに接続' }).click();
  await expect(page.getByRole('button', { name: /深夜の繰り返し/ })).toBeVisible();
  await page.clock.fastForward(3_570_000);
  await page.getByRole('button', { name: '予定を更新' }).click();
  await expect(page.getByRole('button', { name: '再接続', exact: true })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('calendar95.connection'))).toBeNull();
});

for (const reject of [false, true]) {
  test(`new event appears before response and ${reject ? 'rolls back' : 'settles once'}`, async ({ page }) => {
    await mockGoogle(page);
    let release!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; });
    let submittedId = '';
    await page.route('https://www.googleapis.com/calendar/v3/**', async route => {
      const req = route.request();
      if (req.url().includes('/calendarList')) return route.fulfill({ json: { items: [
        { id: 'main', summary: '個人', accessRole: 'owner', primary: true },
      ] } });
      if (req.method() === 'POST') {
        const body = req.postDataJSON(); submittedId = body.id;
        await held;
        return route.fulfill(reject ? { status: 403, json: {} } : { json: { ...body, etag: 'saved' } });
      }
      return route.fulfill({ json: { items: [] } });
    });
    await page.goto('/');
    await page.getByRole('button', { name: 'Googleに接続' }).click();
    await expect(page.getByRole('button', { name: '予定を更新' })).toBeEnabled();
    await page.getByRole('button', { name: '＋ 予定' }).click();
    await page.getByLabel('件名').fill('すぐに作成');
    await page.getByRole('button', { name: '保存', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByRole('button', { name: /すぐに作成/ })).toHaveCount(1);
    await expect(page.locator('.statusbar')).toContainText('保存中');
    await expect.poll(() => submittedId).not.toBe('');
    await expect(page.locator('[data-event-id]')).toHaveAttribute('data-event-id', submittedId);
    release();
    await expect(page.locator('.statusbar')).not.toContainText('保存中');
    if (reject) {
      await expect(page.getByLabel('件名')).toHaveValue('すぐに作成');
      await expect(page.getByRole('button', { name: /すぐに作成/ })).toHaveCount(0);
    } else await expect(page.getByRole('button', { name: /すぐに作成/ })).toHaveCount(1);
  });
}

test('a read started before editing cannot overwrite the optimistic event', async ({ page }) => {
  await mockGoogle(page);
  let releaseRead!: () => void, releaseWrite!: () => void;
  const heldRead = new Promise<void>(resolve => { releaseRead = resolve; });
  const heldWrite = new Promise<void>(resolve => { releaseWrite = resolve; });
  let holdReads = false;
  await page.route('https://www.googleapis.com/calendar/v3/**', async route => {
    const req = route.request();
    if (req.url().includes('/calendarList')) return route.fulfill({ json: { items: [
      { id: 'main', summary: '個人', accessRole: 'owner', primary: true },
    ] } });
    if (req.method() === 'PATCH') {
      await heldWrite;
      return route.fulfill({ json: { ...instance, ...req.postDataJSON(), etag: 'saved' } });
    }
    if (holdReads) await heldRead;
    return route.fulfill({ json: { items: [instance] } });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Googleに接続' }).click();
  await page.getByRole('button', { name: /深夜の繰り返し/ }).click();
  holdReads = true;
  const readStarted = page.waitForRequest(req => req.method() === 'GET' && req.url().includes('/events?'));
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await readStarted;
  await page.getByLabel('件名').fill('新しい表示');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.getByRole('button', { name: /新しい表示/ })).toBeVisible();
  const readFinished = page.waitForResponse(res => res.request().method() === 'GET' && res.url().includes('/events?'));
  releaseRead();
  await readFinished;
  // A browser round trip lets the completed fetch update React before checking the view.
  await page.getByRole('button', { name: '月', exact: true }).click();
  await expect(page.getByRole('button', { name: /新しい表示/ })).toBeVisible();
  releaseWrite();
  await expect(page.locator('.statusbar')).not.toContainText('保存中');
});
