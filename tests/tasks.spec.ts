import { expect, test, type Page } from '@playwright/test';
const calendarScopes = 'https://www.googleapis.com/auth/calendar.calendarlist.readonly https://www.googleapis.com/auth/calendar.events';
async function setup(page: Page, options: { grant?: boolean; enabled?: boolean; overflow?: boolean; assigned?: boolean; title?: string } = {}) {
  await page.clock.install({ time: new Date('2026-09-24T03:00:00Z') });
  await page.addInitScript(enabled => {
    localStorage.setItem('calendar95.tasks', JSON.stringify({ enabled, completed: false, lists: null }));
  }, options.enabled !== false);
  await page.route('https://accounts.google.com/gsi/client', route => route.fulfill({ contentType: 'application/javascript',
    body: `window.google={accounts:{oauth2:{initTokenClient:c=>({requestAccessToken:()=>c.callback({access_token:'fake-tasks-token',expires_in:3600,scope:${options.grant === false ? JSON.stringify(calendarScopes) : 'c.scope'}})})}}};` }));
  await page.route('https://www.googleapis.com/calendar/v3/**', route => route.fulfill({ json: { items:
    route.request().url().includes('/calendarList') ? [{ id: 'calendar', summary: '個人', accessRole: 'owner', primary: true }]
      : options.overflow ? [{ id: 'event', summary: '終日予定', start: { date: '2026-09-24' }, end: { date: '2026-09-25' } }] : [],
  } }));
  let stored: Record<string, unknown> = { id: 'task', title: options.title || '買い物', ...(options.assigned ? { assignmentInfo: {} } : {}), notes: '牛乳', due: '2026-09-24T00:00:00Z', status: 'needsAction', etag: 'v1' };
  const state = { hold: undefined as Promise<void> | undefined, fail: '', patches: [] as Record<string, unknown>[], queries: [] as URL[], gets: 0, deletes: 0, deleted: false };
  await page.route('https://tasks.googleapis.com/tasks/v1/**', async route => {
    const req = route.request(), url = new URL(req.url()); state.queries.push(url);
    if (state.fail === '401') return route.fulfill({ status: 401, json: {} });
    if (state.fail === '403') return route.fulfill({ status: 403, json: {} });
    if (url.pathname.endsWith('/users/@me/lists')) return route.fulfill({ json: url.searchParams.has('pageToken')
      ? { items: [{ id: 'list', title: 'マイタスク' }] } : { items: [], nextPageToken: 'lists2' } });
    if (req.method() === 'DELETE') {
      state.deletes++;
      if (state.fail === 'delete403') return route.fulfill({ status: 403, json: {} });
      if (state.fail !== 'deleteUnapplied') state.deleted = true;
      if (state.fail === 'deleteUncertain' || state.fail === 'deleteUnapplied') return route.abort();
      return route.fulfill({ status: 204 });
    }
    if (state.deleted && url.pathname.endsWith('/tasks/task')) return route.fulfill({ status: 404, json: {} });
    if (req.method() === 'PATCH') {
      await state.hold;
      const changes = req.postDataJSON(); state.patches.push(changes);
      if (state.fail === 'patch403') return route.fulfill({ status: 403, json: {} });
      stored = { ...stored, ...changes, etag: 'v2' };
      if (state.fail === 'uncertain') return route.abort();
      return route.fulfill({ json: stored });
    }
    if (url.pathname.endsWith('/tasks/task')) { state.gets++; return route.fulfill({ json: stored }); }
    return route.fulfill({ json: url.searchParams.has('pageToken') ? { items: [...(state.deleted ? [] : [stored]),
      { id: 'undated', title: '日付なし', status: 'needsAction' },
      { id: 'outside', title: '範囲外', status: 'needsAction', due: '2026-10-31T00:00:00Z' },
    ] } : { items: [], nextPageToken: 'tasks2' } });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Googleに接続', exact: true }).click();
  await expect(page.getByRole('button', { name: '接続解除', exact: true })).toBeVisible();
  return state;
}
async function settings(page: Page) { await page.getByRole('button', { name: '設定', exact: true }).click(); }
test('ToDo displays by date, edits without event creation, completes and restores', async ({ page }) => {
  const state = await setup(page);
  await expect(page.locator('.all-day-row').getByRole('button', { name: '買い物', exact: true })).toBeVisible();
  await page.screenshot({ path: '.runtime/tasks-desktop.png' });
  await expect(page.getByText('日付なし', { exact: true })).toHaveCount(0);
  await expect(page.getByText('範囲外', { exact: true })).toHaveCount(0);
  expect(state.queries.some(url => url.searchParams.get('pageToken') === 'lists2')).toBe(true);
  expect(state.queries.some(url => url.searchParams.get('pageToken') === 'tasks2')).toBe(true);
  await page.getByRole('button', { name: '買い物', exact: true }).click();
  await page.getByLabel('タイトル', { exact: true }).fill('夕食の買い物');
  await page.getByLabel('メモ', { exact: true }).fill('パン');
  await page.getByLabel('日付', { exact: true }).fill('2026-09-25');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(state.patches[0]).toEqual({ title: '夕食の買い物', notes: 'パン', due: '2026-09-25T00:00:00Z', status: 'needsAction' });
  await setStatus(page, '夕食の買い物', 'completed');
  await expect(page.getByRole('button', { name: '夕食の買い物', exact: true })).toHaveCount(0);
  await settings(page); await page.getByLabel('完了済みも表示').check();
  await page.getByRole('button', { name: '適用' }).click();
  await expect(page.locator('.task-row.completed')).toContainText('夕食の買い物');
  expect(state.queries.some(url => url.searchParams.get('showHidden') === 'true')).toBe(true);
  await setStatus(page, '夕食の買い物', 'needsAction');
  await expect(page.locator('.task-row.completed')).toHaveCount(0);
  await page.getByRole('button', { name: '月', exact: true }).click();
  await expect(page.locator('.month-cell').filter({ has: page.getByRole('button', { name: '2026-09-25の日表示' }) })).toContainText('夕食の買い物');
  await page.getByRole('button', { name: '夕食の買い物', exact: true }).click();
  await page.getByLabel('日付', { exact: true }).fill('');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.getByRole('button', { name: '夕食の買い物', exact: true })).toHaveCount(0);
  expect(state.patches.at(-1)?.due).toBeNull();
  expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain('夕食の買い物');
});
test('ToDo appears in overflow after all-day events and list filtering works', async ({ page }) => {
  await setup(page, { overflow: true });
  await expect(page.getByRole('button', { name: '終日予定', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'ほか1件', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: '買い物', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'ToDoの編集' })).toBeVisible();
  await page.getByRole('button', { name: '閉じる', exact: true }).last().click();
  await page.keyboard.press('Escape');
  await settings(page); await page.getByLabel('マイタスク', { exact: true }).uncheck();
  await page.getByRole('button', { name: '適用' }).click();
  await expect(page.getByRole('button', { name: 'ほか1件', exact: true })).toHaveCount(0);
});
test('optional permission denial keeps Calendar usable', async ({ page }) => {
  const state = await setup(page, { grant: false });
  await expect(page.getByText('設定からGoogle ToDoへのアクセスを許可してください。')).toBeVisible();
  expect(state.queries).toHaveLength(0);
  await page.getByRole('button', { name: '＋ 予定' }).click();
  await expect(page.getByLabel('件名')).toBeVisible();
});
test('Tasks can be enabled on an existing Calendar connection', async ({ page }) => {
  const state = await setup(page, { enabled: false });
  expect(state.queries).toHaveLength(0);
  await settings(page); await page.getByLabel('Google ToDoを表示', { exact: true }).check();
  await page.getByRole('button', { name: 'Google ToDoへのアクセスを許可', exact: true }).click();
  await expect(page.getByLabel('マイタスク', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '適用' }).click();
  await expect(page.getByRole('button', { name: '買い物', exact: true })).toBeVisible();
});
test('failed edits retain input; uncertain writes require confirmation; expiration reconnects', async ({ page }) => {
  const state = await setup(page);
  await page.getByRole('button', { name: '買い物', exact: true }).click();
  await page.getByLabel('タイトル', { exact: true }).fill('保持する入力');
  state.fail = 'patch403'; await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Google Tasks API');
  await expect(page.getByLabel('タイトル', { exact: true })).toHaveValue('保持する入力');
  state.fail = '401'; await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.getByRole('button', { name: '入力を保持してGoogleに再接続' })).toBeVisible();
  state.fail = ''; await page.getByRole('button', { name: '入力を保持してGoogleに再接続' }).click();
  await expect(page.getByLabel('タイトル', { exact: true })).toHaveValue('保持する入力');
  state.fail = 'uncertain'; await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.getByRole('button', { name: '保存結果を確認', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '保存', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '保存結果を確認', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '保持する入力', exact: true })).toBeVisible();
  expect(state.gets).toBe(1);
});
test('Tasks service failure does not remove calendar events', async ({ page }) => {
  const state = await setup(page, { overflow: true });
  await expect(page.getByRole('button', { name: 'ほか1件', exact: true })).toBeVisible();
  state.fail = '403'; await page.getByRole('button', { name: '予定を更新' }).click();
  await expect(page.getByRole('alert')).toContainText('Google Tasks API');
  await expect(page.getByRole('button', { name: '終日予定', exact: true })).toBeVisible();
});

test('mobile ToDo restores with saved authorization and remains within the viewport', async ({ page }) => {
  await setup(page);
  await expect(page.getByRole('button', { name: '買い物', exact: true })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await expect(page.getByRole('button', { name: '買い物', exact: true })).toBeVisible();
  await expect(page.locator('.day-column:not([inert])')).toHaveCount(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.screenshot({ path: '.runtime/tasks-mobile.png' });
  await page.getByRole('button', { name: '買い物', exact: true }).click();
  await page.screenshot({ path: '.runtime/tasks-editor.png' });
});

for (const operation of ['edit', 'complete', 'undate'] as const) {
  test(`ToDo optimistic ${operation} precedes response and restores on rejection`, async ({ page }) => {
    const state = await setup(page);
    let release!: () => void;
    state.hold = new Promise<void>(resolve => { release = resolve; });
    state.fail = 'patch403';
    if (operation === 'complete') await setStatus(page, '買い物', 'completed');
    else {
      await page.getByRole('button', { name: '買い物', exact: true }).click();
      await page.getByLabel('タイトル', { exact: true }).fill('保持するタイトル');
      await page.getByLabel('メモ', { exact: true }).fill('保持するメモ');
      await page.getByLabel('日付', { exact: true }).fill(operation === 'undate' ? '' : '2026-09-25');
      await page.getByRole('button', { name: '保存', exact: true }).click();
    }
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.locator('.statusbar')).toContainText('保存中');
    await expect(page.getByRole('button', { name: '買い物', exact: true })).toHaveCount(0);
    if (operation === 'edit') await expect(page.getByRole('button', { name: '保持するタイトル', exact: true })).toBeVisible();
    else await expect(page.locator('.task-row')).toHaveCount(0);
    release();
    await expect(page.getByRole('alert')).toContainText('Google Tasks API');
    await expect(page.getByRole('button', { name: '買い物', exact: true })).toBeVisible();
    if (operation === 'complete') await expect(page.getByLabel('状態', { exact: true })).toHaveValue('completed');
    if (operation !== 'complete') {
      await expect(page.getByLabel('タイトル', { exact: true })).toHaveValue('保持するタイトル');
      await expect(page.getByLabel('メモ', { exact: true })).toHaveValue('保持するメモ');
      await expect(page.getByLabel('日付', { exact: true })).toHaveValue(operation === 'undate' ? '' : '2026-09-25');
    }
  });
}

async function setStatus(page: Page, title: string, status: string) {
  await page.getByRole('button', { name: title, exact: true }).click();
  await page.getByLabel('状態', { exact: true }).selectOption(status);
  await page.getByRole('button', { name: '保存', exact: true }).click();
}

test('status is only saved on submit and calendar rows have no checkbox', async ({ page }) => {
  const state = await setup(page);
  await expect(page.locator('.all-day-row input')).toHaveCount(0);
  await page.getByRole('button', { name: '買い物', exact: true }).click();
  await page.getByLabel('状態', { exact: true }).selectOption('completed');
  await page.getByRole('dialog').getByRole('button', { name: '閉じる', exact: true }).last().click();
  expect(state.patches).toHaveLength(0);
  await page.getByRole('button', { name: '買い物', exact: true }).click();
  await expect(page.getByLabel('状態', { exact: true })).toHaveValue('needsAction');
});

for (const failure of ['', 'delete403', 'deleteUncertain', 'deleteUnapplied']) {
  test('delete confirmation and recovery: ' + (failure || 'success'), async ({ page }) => {
    const state = await setup(page);
    await page.getByRole('button', { name: '買い物', exact: true }).click();
    await page.getByRole('button', { name: '削除…', exact: true }).click();
    await page.getByRole('button', { name: 'キャンセル', exact: true }).click();
    expect(state.deletes).toBe(0);
    await page.getByRole('button', { name: '削除…', exact: true }).click();
    state.fail = failure;
    await page.getByRole('button', { name: '削除する', exact: true }).click();
    if (failure === 'delete403') {
      await expect(page.getByRole('alert').filter({ hasText: 'Google Tasks API' })).toBeVisible();
      await expect(page.locator('.task-row')).toBeVisible();
      state.fail = '';
      await page.getByRole('button', { name: '削除する', exact: true }).click();
    } else if (failure.startsWith('deleteU')) {
      await page.getByRole('button', { name: '削除結果を確認', exact: true }).click();
      if (failure === 'deleteUnapplied') {
        await expect(page.getByText('ToDoはまだ残っています。確認して再度削除してください。')).toBeVisible();
        state.fail = '';
        await page.getByRole('button', { name: '削除する', exact: true }).click();
      }
    }
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.locator('.task-row')).toHaveCount(0);
  });
}

for (const view of ['week', 'month']) {
  test('drag dates, ignore same day and roll back rejection: ' + view, async ({ page }) => {
    const state = await setup(page);
    if (view === 'month') await page.getByRole('button', { name: '月', exact: true }).click();
    const cells = page.locator(view === 'week' ? '.all-day-cell:not([inert])' : '.month-cell');
    const task = page.getByRole('button', { name: '買い物', exact: true });
    const origin = cells.filter({ has: task });
    const originIndex = await origin.evaluate(el => Array.from(el.parentElement!.children).filter(c => c.className === el.className && !c.hasAttribute('inert')).indexOf(el));
    const target = view === 'month'
      ? cells.filter({ has: page.getByRole('button', { name: '2026-09-25の日表示' }) })
      : cells.nth(originIndex + 1);
    await task.dragTo(origin, { targetPosition: { x: 10, y: 10 } });
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await task.dragTo(page.locator('.statusbar'));
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(state.patches).toHaveLength(0);
    await task.dragTo(target);
    await expect(target).toContainText('買い物');
    await expect.poll(() => state.patches.length).toBe(1);
    expect(state.patches[0]).toEqual({ due: '2026-09-25T00:00:00Z' });
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(task).toBeEnabled();
    state.fail = 'patch403';
    await task.dragTo(cells.nth(0));
    await expect(page.getByRole('alert')).toContainText('Google Tasks API');
    await expect(target).toContainText('買い物');
  });
}

test('task dimensions match all-day and month events', async ({ page }) => {
  await setup(page, { overflow: true });
  // Move the calendar fixture to the next date so both rows are visible.
  await page.route('https://www.googleapis.com/calendar/v3/calendars/**', route => route.fulfill({ json: { items: [
    { id: 'event', summary: '終日予定', start: { date: '2026-09-25' }, end: { date: '2026-09-26' } },
  ] } }));
  await page.getByRole('button', { name: '予定を更新' }).click();
  for (const month of [false, true]) {
    if (month) await page.getByRole('button', { name: '月', exact: true }).click();
    const task = page.getByRole('button', { name: '買い物', exact: true });
    const event = page.getByRole('button', { name: '終日予定', exact: true });
    await expect(task).toBeVisible();
    const metrics = (el: Element) => { const css = getComputedStyle(el); return [el.getBoundingClientRect().height, css.fontSize, css.padding]; };
    expect(await task.evaluate(metrics)).toEqual(await event.evaluate(metrics));
  }
});

test('uncertain drag saves can be checked without losing the destination date', async ({ page }) => {
  const state = await setup(page);
  state.fail = 'uncertain';
  const destination = page.locator('.all-day-cell:not([inert])').nth(4);
  await page.getByRole('button', { name: '買い物', exact: true }).dragTo(destination);
  await expect(page.getByLabel('日付', { exact: true })).toHaveValue('2026-09-25');
  await page.getByRole('button', { name: '保存結果を確認', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(destination).toContainText('買い物');
  expect(state.patches).toEqual([{ due: '2026-09-25T00:00:00Z' }]);
});

test('assigned task deletion explains the effect on the original task', async ({ page }) => {
  await setup(page, { assigned: true });
  await page.getByRole('button', { name: '買い物', exact: true }).click();
  await page.getByRole('button', { name: '削除…', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('元のDocs・Chat側のタスクも削除されます');
});

test('long task titles stay on one line within the day cell', async ({ page }) => {
  await setup(page, { title: '長いタイトル'.repeat(40) });
  const row = page.locator('.task-row');
  const layout = await row.evaluate(el => ({
    width: el.getBoundingClientRect().width,
    cellWidth: el.parentElement!.getBoundingClientRect().width,
    overflow: getComputedStyle(el).textOverflow,
    whiteSpace: getComputedStyle(el).whiteSpace,
  }));
  expect(layout.width).toBeLessThanOrEqual(layout.cellWidth);
  expect(layout.overflow).toBe('ellipsis');
  expect(layout.whiteSpace).toBe('nowrap');
});


test('rolling week keeps ToDo dates aligned and locks horizontal movement during a task drag', async ({ page }) => {
  const state = await setup(page);
  const task = page.getByRole('button', { name: '買い物', exact: true });
  await expect(task).toBeVisible();
  const requests = state.queries.length;
  await page.getByRole('button', { name: '1日後へ' }).click();
  await page.getByRole('button', { name: '1日後へ' }).click();
  await page.clock.runFor(400);
  await expect(page.locator('.day-column:not([inert])').first()).toHaveAttribute('data-day', '2026-09-23');
  const cells = page.locator('.all-day-cell:not([inert])');
  await expect(cells.nth(1)).toContainText('買い物');
  expect(state.queries).toHaveLength(requests);
  const transfer = await page.evaluateHandle(() => new DataTransfer());
  await task.dispatchEvent('dragstart', { dataTransfer: transfer });
  await page.locator('.week-viewport').dispatchEvent('wheel', { deltaX: 600 });
  await page.clock.runFor(400);
  await expect(page.locator('.day-column:not([inert])').first()).toHaveAttribute('data-day', '2026-09-23');
  await cells.nth(5).dispatchEvent('dragover', { dataTransfer: transfer });
  await cells.nth(5).dispatchEvent('drop', { dataTransfer: transfer });
  await expect.poll(() => state.patches.length).toBe(1);
  expect(state.patches[0].due).toBe('2026-09-28T00:00:00Z');
  await expect(cells.nth(5)).toContainText('買い物');
  await transfer.dispose();
});
