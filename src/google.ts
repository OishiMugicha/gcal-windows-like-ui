import { ZONE } from './calendar';
import type { Calendar, CalendarEvent } from './types';
interface TokenResponse { access_token?: string; expires_in?: number; error?: string; scope?: string; }
interface GoogleIdentity { accounts: { oauth2: {
  initTokenClient: (config: { client_id: string; scope: string; callback: (r: TokenResponse) => void; error_callback: (e: { type: string }) => void }) => { requestAccessToken: (options?: { prompt?: string }) => void };
} }; }
declare global { interface Window { google?: GoogleIdentity; } }
const scopes = ['https://www.googleapis.com/auth/calendar.calendarlist.readonly', 'https://www.googleapis.com/auth/calendar.events'];
let token = '', expiresAt = 0;
let identityPromise: Promise<void> | undefined;
export class ConnectionExpired extends Error {
  constructor() { super('Googleとの接続が切れました。「再接続」を押してください。'); }
}
export function prepareGoogle(): Promise<void> {
  if (window.google?.accounts.oauth2) return Promise.resolve();
  if (identityPromise) return identityPromise;
  identityPromise = new Promise<void>((resolve, reject) => {
    const script = document.createElement('script');
    const timeout = window.setTimeout(() => { script.remove(); identityPromise = undefined; reject(new Error('Google認証を読み込めません。通信環境を確認してください。')); }, 15_000);
    script.src = 'https://accounts.google.com/gsi/client'; script.async = true;
    script.onload = () => { clearTimeout(timeout); resolve(); };
    script.onerror = () => { clearTimeout(timeout); script.remove(); identityPromise = undefined; reject(new Error('Google認証を読み込めませんでした。')); };
    document.head.appendChild(script);
  });
  return identityPromise;
}
export function connectGoogle(clientId: string): Promise<void> {
  if (!window.google?.accounts.oauth2) return Promise.reject(new Error('Google認証を準備しています。少し待ってからもう一度押してください。'));
  return new Promise((resolve, reject) => {
    const client = window.google!.accounts.oauth2.initTokenClient({
      client_id: clientId, scope: scopes.join(' '),
      callback: response => {
        if (response.error || !response.access_token) { reject(new Error('Googleへの接続が許可されませんでした。')); return; }
        const granted = new Set((response.scope || '').split(' '));
        if (!scopes.every(s => granted.has(s))) { reject(new Error('予定とカレンダー一覧へのアクセスを許可してください。')); return; }
        token = response.access_token;
        expiresAt = Date.now() + Math.max(0, (Number(response.expires_in) || 3600) - 30) * 1000;
        resolve();
      },
      error_callback: e => reject(new Error(e.type === 'popup_closed' ? 'Googleへの接続をキャンセルしました。' : '認証画面を開けません。ポップアップを許可してください。')),
    });
    client.requestAccessToken({ prompt: '' });
  });
}
export function disconnectGoogle() { token = ''; expiresAt = 0; }
async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  if (!token || Date.now() >= expiresAt) throw new ConnectionExpired();
  let response: Response;
  try {
    response = await fetch('https://www.googleapis.com/calendar/v3/' + path, { ...init, signal: AbortSignal.timeout(25_000),
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json', ...init.headers } });
  } catch { throw new Error(init.method ? '保存結果を確認できません。二重登録を防ぐため、再試行の前に更新して予定を確認してください。' : '予定を取得できません。通信環境を確認して再試行してください。'); }
  if (response.status === 401) { disconnectGoogle(); throw new ConnectionExpired(); }
  if (response.status === 412) throw new Error('この予定は別の場所で変更されています。一度閉じて更新してから編集してください。');
  if (response.status === 403) throw new Error('操作の権限がないか、APIの利用制限に達しています。カレンダーの権限とGoogle Cloud設定を確認してください。');
  if (response.status === 404 || response.status === 410) throw new Error('予定が見つかりません。一度閉じてカレンダーを更新してください。');
  if (response.status === 409) throw new Error('同じ予定がすでに保存されています。一度閉じて更新してください。');
  if (response.status === 429) throw new Error('アクセスが集中しています。少し待ってから再試行してください。');
  if (!response.ok) throw new Error('Google Calendarへの操作に失敗しました（' + response.status + '）。');
  return response.status === 204 ? undefined as T : response.json() as Promise<T>;
}
interface Page<T> { items?: T[]; nextPageToken?: string; }
interface GoogleCalendar { id: string; summary?: string; summaryOverride?: string; backgroundColor?: string; accessRole?: string; primary?: boolean; }
export async function loadCalendars(): Promise<Calendar[]> {
  const items: GoogleCalendar[] = []; let pageToken = '';
  do {
    const params = new URLSearchParams({ maxResults: '250' });
    if (pageToken) params.set('pageToken', pageToken);
    const page = await request<Page<GoogleCalendar>>('users/me/calendarList?' + params);
    items.push(...(page.items || [])); pageToken = page.nextPageToken || '';
  } while (pageToken);
  return items.map(c => ({ id: c.id, title: c.summaryOverride || c.summary || c.id, color: c.backgroundColor || '#3159a6', writable: c.accessRole === 'owner' || c.accessRole === 'writer', primary: c.primary }));
}
interface GoogleEvent {
  id: string; summary?: string; description?: string; location?: string; status?: string;
  start?: { date?: string; dateTime?: string }; end?: { date?: string; dateTime?: string };
  recurringEventId?: string; htmlLink?: string; etag?: string;
}
function fromGoogle(raw: GoogleEvent, calendarId: string): CalendarEvent | undefined {
  if (raw.status === 'cancelled' || !raw.start || !raw.end) return;
  const base = { id: raw.id, calendarId, title: raw.summary || '（タイトルなし）', description: raw.description, location: raw.location, recurring: !!raw.recurringEventId, htmlLink: raw.htmlLink, etag: raw.etag };
  if (raw.start.date && raw.end.date) return { ...base, allDay: true, startDate: raw.start.date, endDate: raw.end.date };
  if (raw.start.dateTime && raw.end.dateTime) return { ...base, allDay: false, start: raw.start.dateTime, end: raw.end.dateTime };
}
export async function loadEvents(calendarId: string, start: string, end: string): Promise<CalendarEvent[]> {
  const items: CalendarEvent[] = []; let pageToken = '';
  do {
    const params = new URLSearchParams({ timeMin: start, timeMax: end, singleEvents: 'true', orderBy: 'startTime', maxResults: '2500', timeZone: ZONE });
    if (pageToken) params.set('pageToken', pageToken);
    const page = await request<Page<GoogleEvent>>('calendars/' + encodeURIComponent(calendarId) + '/events?' + params);
    for (const raw of page.items || []) { const e = fromGoogle(raw, calendarId); if (e) items.push(e); }
    pageToken = page.nextPageToken || '';
  } while (pageToken);
  return items;
}
export function newEventId() { return crypto.randomUUID().replaceAll('-', ''); }
export async function saveGoogleEvent(event: CalendarEvent, isNew: boolean): Promise<CalendarEvent> {
  const body = { ...(isNew ? { id: event.id } : {}), summary: event.title, description: event.description || '', location: event.location || '',
    start: event.allDay ? { date: event.startDate } : { dateTime: event.start, timeZone: ZONE },
    end: event.allDay ? { date: event.endDate } : { dateTime: event.end, timeZone: ZONE } };
  const path = 'calendars/' + encodeURIComponent(event.calendarId) + '/events' + (isNew ? '' : '/' + encodeURIComponent(event.id));
  const raw = await request<GoogleEvent>(path, { method: isNew ? 'POST' : 'PATCH', body: JSON.stringify(body), headers: !isNew && event.etag ? { 'If-Match': event.etag } : {} });
  const result = fromGoogle(raw, event.calendarId);
  if (!result) throw new Error('保存した予定を確認できません。更新してください。');
  return result;
}
export async function deleteGoogleEvent(event: CalendarEvent): Promise<void> {
  await request<void>('calendars/' + encodeURIComponent(event.calendarId) + '/events/' + encodeURIComponent(event.id), { method: 'DELETE', headers: event.etag ? { 'If-Match': event.etag } : {} });
}
