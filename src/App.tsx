import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { addDays, atMinute, dateKey, isOnDay, rangeFor, readSettings, timeLabel, timeOf, visibleDays, weekday } from './calendar';
import { demoCalendars, demoEvents } from './demo';
import type { Calendar, CalendarEvent, EventDraft, Settings, View } from './types';
import TimeGrid from './TimeGrid';
import { useCalendarTools } from './useCalendarTools';
import SettingsDialog from './SettingsDialog';
import EventEditor, { draftFrom } from './EventEditor';
import Modal from './Modal';
import { ConnectionExpired, connectGoogle, deleteGoogleEvent, disconnectGoogle, loadCalendars, loadEvents, newEventId, prepareGoogle, saveGoogleEvent } from './google';
const weekdays = ['日', '月', '火', '水', '木', '金', '土'];
const sameEvent = (a: CalendarEvent, b: CalendarEvent) => a.id === b.id && a.calendarId === b.calendarId;
const errorMessage = (error: unknown) => error instanceof Error ? error.message : '操作に失敗しました。';
const initialSettings = () => {
  const value = readSettings();
  return matchMedia('(max-width: 680px)').matches ? { ...value, view: 'day' as const } : value;
};
export default function App() {
  const [settings, setSettings] = useState<Settings>(initialSettings);
  useCalendarTools(setSettings);
  const [anchor, setAnchor] = useState(dateKey());
  const [mode, setMode] = useState<'demo' | 'google'>('demo');
  const [calendars, setCalendars] = useState<Calendar[]>(demoCalendars);
  const [events, setEvents] = useState<CalendarEvent[]>(demoEvents);
  const [demoSelected, setDemoSelected] = useState(demoCalendars.map(c => c.id));
  const [showSettings, setShowSettings] = useState(false);
  const [draft, setDraft] = useState<EventDraft | null>(null);
  const [editorError, setEditorError] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [connectionVersion, setConnectionVersion] = useState(0);
  const [connecting, setConnecting] = useState(false);
  const [expired, setExpired] = useState(false);
  const [notice, setNotice] = useState('');
  const [listDay, setListDay] = useState<string | null>(null);
  const [disconnectPrompt, setDisconnectPrompt] = useState(false);
  const revision = useRef(0), pendingNewId = useRef(''), busyRef = useRef(false);
  const days = useMemo(() => visibleDays(anchor, settings), [anchor, settings]);
  const selected = mode === 'demo' ? demoSelected : settings.selectedCalendars;
  const selectedKey = selected.join('\n');
  const range = rangeFor(days, settings);
  const filtered = events.filter(e => selected.includes(e.calendarId));
  const gridStyle = { gridTemplateColumns: '58px repeat(' + days.length + ', minmax(0, 1fr))' };
  const clientId = settings.clientId || import.meta.env.VITE_GOOGLE_CLIENT_ID || '';
  useEffect(() => { if (clientId) prepareGoogle().catch(() => {}); }, [clientId]);
  useEffect(() => {
    try { localStorage.setItem('calendar95.settings', JSON.stringify(settings)); }
    catch { setNotice('設定を保存できません。このブラウザの保存領域を確認してください。'); }
  }, [settings]);
  useEffect(() => { if (!notice) return; const timer = setTimeout(() => setNotice(''), 5000); return () => clearTimeout(timer); }, [notice]);
  const refresh = useCallback(async () => {
    if (mode !== 'google' || busyRef.current) return;
    const requestId = ++revision.current;
    setLoading(true); setError('');
    try {
      const results = await Promise.all(settings.selectedCalendars.map(id => loadEvents(id, range.start, range.end)));
      if (requestId !== revision.current) return;
      setEvents(results.flat()); setExpired(false);
    } catch (e) {
      if (requestId !== revision.current) return;
      setError(errorMessage(e)); if (e instanceof ConnectionExpired) setExpired(true);
    } finally { if (requestId === revision.current) setLoading(false); }
  }, [mode, selectedKey, range.start, range.end, connectionVersion]);
  useEffect(() => { void refresh(); return () => { revision.current++; }; }, [refresh]);
  useEffect(() => {
    const handler = () => { if (document.visibilityState === 'visible') void refresh(); };
    window.addEventListener('focus', handler); document.addEventListener('visibilitychange', handler);
    return () => { window.removeEventListener('focus', handler); document.removeEventListener('visibilitychange', handler); };
  }, [refresh]);
  function navigate(direction: number) {
    if (settings.view === 'month') {
      const date = new Date(anchor.slice(0, 8) + '01T00:00:00Z');
      date.setUTCMonth(date.getUTCMonth() + direction); setAnchor(date.toISOString().slice(0, 10));
    } else setAnchor(addDays(anchor, direction * (settings.view === 'week' ? 7 : 1)));
  }
  function selectView(view: View) { setSettings(s => ({ ...s, view })); }
  function openEditor(event: CalendarEvent) { pendingNewId.current = ''; setEditorError(''); setDraft(draftFrom(event)); }
  function newDraft(start = atMinute(anchor, settings.startMinute), end = start + 60 * 60_000) {
    const calendar = calendars.find(c => c.writable && selected.includes(c.id)) || calendars.find(c => c.writable);
    if (!calendar) { setError('書き込み可能なカレンダーがありません。'); return; }
    pendingNewId.current = newEventId(); setEditorError('');
    setDraft(draftFrom({ id: '', calendarId: calendar.id, title: '', allDay: false, start: new Date(start).toISOString(), end: new Date(end).toISOString() }));
  }
  function markOutside(event: CalendarEvent) {
    const day = event.allDay ? event.startDate : dateKey(new Date(event.start));
    const visible = days.some(d => event.allDay ? isOnDay(event, d) : Date.parse(event.start) < atMinute(d, settings.endMinute) && Date.parse(event.end) > atMinute(d, settings.startMinute));
    setNotice(!selected.includes(event.calendarId) ? '保存しました。作成先カレンダーは現在非表示です。' : !visible ? '保存しました。予定は現在の表示範囲外です（' + day + '）。' : '保存しました。');
  }
  async function save(event: CalendarEvent, fromEditor = true) {
    if (busyRef.current) return;
    const isNew = !event.id, target = isNew ? { ...event, id: pendingNewId.current || newEventId() } : event;
    busyRef.current = true; setBusy(true); setEditorError(''); setError(''); revision.current++; setLoading(false);
    try {
      const saved = mode === 'demo' ? target : await saveGoogleEvent(target, isNew);
      setEvents(current => [...current.filter(e => !sameEvent(e, saved)), saved]);
      if (fromEditor) setDraft(null);
      markOutside(saved);
    } catch (e) {
      if (fromEditor) setEditorError(errorMessage(e)); else setError(errorMessage(e));
      if (e instanceof ConnectionExpired) setExpired(true);
    } finally { busyRef.current = false; setBusy(false); }
  }
  async function remove(event: CalendarEvent) {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true); setEditorError(''); revision.current++; setLoading(false);
    try {
      if (mode === 'google') await deleteGoogleEvent(event);
      setEvents(current => current.filter(e => !sameEvent(e, event))); setDraft(null); setNotice('予定を削除しました。');
    } catch (e) { setEditorError(errorMessage(e)); if (e instanceof ConnectionExpired) setExpired(true); }
    finally { busyRef.current = false; setBusy(false); }
  }
  async function connect() {
    if (!clientId) { setShowSettings(true); setNotice('Google接続設定にOAuthクライアントIDを入力してください。'); return; }
    setConnecting(true); setError(''); revision.current++;
    try {
      await connectGoogle(clientId);
      const list = await loadCalendars();
      setCalendars(list); setEvents([]); setMode('google'); setExpired(false);
      setSettings(current => {
        const saved = current.selectedCalendars.filter(id => list.some(c => c.id === id));
        return { ...current, selectedCalendars: saved.length ? saved : list.filter(c => c.primary).map(c => c.id) };
      });
      setConnectionVersion(v => v + 1);
      setNotice('Google Calendarに接続しました。');
    } catch (e) { setError(errorMessage(e)); }
    finally { setConnecting(false); }
  }
  function disconnect() {
    revision.current++; disconnectGoogle(); setMode('demo'); setCalendars(demoCalendars); setEvents(demoEvents());
    setExpired(false); setLoading(false); setError(''); setDisconnectPrompt(false);
  }
  function applySettings(next: Settings) {
    if (mode === 'demo') {
      setDemoSelected(next.selectedCalendars); setSettings({ ...next, selectedCalendars: settings.selectedCalendars });
    } else setSettings(next);
    setShowSettings(false);
  }
  const periodLabel = settings.view === 'month' ? Number(anchor.slice(0, 4)) + '年 ' + Number(anchor.slice(5, 7)) + '月'
    : settings.view === 'day' ? anchor.replaceAll('-', '.') + '（' + weekdays[weekday(anchor)] + '）'
    : days[0].replaceAll('-', '.') + ' — ' + days.at(-1)!.slice(5).replace('-', '.');
  const calendarColor = (e: CalendarEvent) => ({ '--event-color': e.color || calendars.find(c => c.id === e.calendarId)?.color || '#3159a6' }) as CSSProperties;
  return <main className="app-window">
    <header className="titlebar"><img src="/favicon.svg" alt="" /><strong>Calendar 95</strong><span>{mode === 'demo' ? 'サンプル' : 'Google Calendar'}</span></header>
    <nav className="toolbar" aria-label="カレンダー操作">
      <div className="nav-buttons"><button onClick={() => navigate(-1)} aria-label="前の期間">◀</button><button onClick={() => setAnchor(dateKey())}>今日</button><button onClick={() => navigate(1)} aria-label="次の期間">▶</button></div>
      <h1>{periodLabel}</h1>
      <div className="view-buttons" aria-label="表示切替">{(['day', 'week', 'month'] as View[]).map((view, i) => <button key={view} className={settings.view === view ? 'pressed' : ''} aria-pressed={settings.view === view} onClick={() => selectView(view)}>{['日', '週', '月'][i]}</button>)}</div>
      <span className="toolbar-divider" /><button onClick={() => newDraft()} disabled={busy || connecting}>＋ 予定</button>
      <button onClick={() => setShowSettings(true)} disabled={busy}>設定</button>
      {mode === 'google' && <button onClick={() => void refresh()} disabled={loading || busy || expired} aria-label="予定を更新">更新</button>}
      {mode === 'demo' || expired ? <button onClick={() => void connect()} disabled={connecting || busy}>{connecting ? '接続中…' : expired ? '再接続' : 'Googleに接続'}</button>
        : <button onClick={() => setDisconnectPrompt(true)} disabled={busy}>接続解除</button>}
    </nav>
    {error && <div className="error-banner" role="alert"><span>{error}</span><button onClick={() => setError('')} aria-label="エラーを閉じる">×</button></div>}
    <section className="calendar-surface" aria-label="カレンダー" aria-busy={loading || busy}>
      {settings.view === 'month' ? <>
        <div className="month-weekdays" style={{ gridTemplateColumns: 'repeat(' + (settings.showWeekends ? 7 : 5) + ', 1fr)' }}>
          {days.slice(0, settings.showWeekends ? 7 : 5).map(day => <span key={day}>{weekdays[weekday(day)]}</span>)}</div>
        <div className="month-grid" style={{ gridTemplateColumns: 'repeat(' + (settings.showWeekends ? 7 : 5) + ', minmax(0, 1fr))' }}>
          {days.map(day => {
            const onDay = filtered.filter(e => isOnDay(e, day)).sort((a, b) => Number(b.allDay) - Number(a.allDay) || (!a.allDay && !b.allDay ? a.start.localeCompare(b.start) : 0));
            return <div key={day} className={'month-cell' + (day.slice(0, 7) !== anchor.slice(0, 7) ? ' other-month' : '') + (day === dateKey() ? ' month-today' : '')}>
              <button className="month-date" aria-label={day + 'の日表示'} onClick={() => { setAnchor(day); selectView('day'); }}>{Number(day.slice(8))}</button>
              <div className="month-events">{onDay.slice(0, 3).map(e => <button key={e.calendarId + e.id} className="month-event" style={calendarColor(e)} onClick={() => openEditor(e)}>{!e.allDay && <span>{timeOf(e.start)} </span>}{e.title}</button>)}</div>
              {onDay.length > 3 && <button className="more-button" onClick={() => setListDay(day)}>ほか{onDay.length - 3}件</button>}
            </div>;
          })}
        </div>
      </> : <>
        <div className="date-head" style={gridStyle}><span className="zone-label">JST</span>{days.map(day => <button key={day} onClick={() => { setAnchor(day); selectView('day'); }}
          className={'day-heading' + (day === dateKey() ? ' today' : '') + (weekday(day) === 0 ? ' sunday' : '')} aria-label={day + 'の日表示'}><span>{weekdays[weekday(day)]}</span><strong>{Number(day.slice(8))}</strong></button>)}</div>
        <div className="all-day-row" style={gridStyle}><span className="zone-label">終日</span>{days.map(day => {
          const allDay = filtered.filter(e => e.allDay && isOnDay(e, day));
          return <div key={day} className="all-day-cell">{allDay.slice(0, 1).map(e => <button key={e.calendarId + e.id} style={calendarColor(e)} className="all-day-event" onClick={() => openEditor(e)}>{e.title}</button>)}
            {allDay.length > 1 && <button className="more-button" onClick={() => setListDay(day)}>ほか{allDay.length - 1}件</button>}</div>;
        })}</div>
        <TimeGrid days={days} settings={settings} events={filtered} calendars={calendars} busy={busy || loading} onCreate={newDraft} onEdit={openEditor} onChange={e => void save(e, false)} />
      </>}
      {!selected.length && <div className="empty-selection"><span>表示するカレンダーが選択されていません。</span><button onClick={() => setShowSettings(true)}>設定を開く</button></div>}
    </section>
    <footer className="statusbar" aria-live="polite"><span>{loading ? '予定を取得中…' : busy ? '保存中…' : notice || (mode === 'demo' ? 'サンプル表示 · 変更はGoogleに送信されません' : 'Google Calendarに接続済み')}</span>
      <span>{settings.view === 'month' ? '月表示' : timeLabel(settings.startMinute) + ' – ' + timeLabel(settings.endMinute) + ' · 表示時間を固定'}</span><span>日本標準時</span></footer>
    {showSettings && <SettingsDialog initial={{ ...settings, selectedCalendars: selected, clientId }} calendars={calendars} onSave={applySettings} onClose={() => setShowSettings(false)} />}
    {draft && <EventEditor initial={draft} calendars={calendars} busy={busy} error={editorError} onSave={e => void save(e)} onDelete={e => void remove(e)} onClose={() => { if (!busy) setDraft(null); }} />}
    {listDay && <Modal title={listDay.replaceAll('-', '.') + ' の予定'} onClose={() => setListDay(null)}>
      <div className="dialog-body agenda-list">{filtered.filter(e => isOnDay(e, listDay) && (settings.view === 'month' || e.allDay)).map(e => <button key={e.calendarId + e.id} style={calendarColor(e)} className="agenda-item" onClick={() => { setListDay(null); openEditor(e); }}><span>{e.allDay ? '終日' : timeOf(e.start)}</span>{e.title}</button>)}</div>
    </Modal>}
    {disconnectPrompt && <Modal title="Googleとの接続を解除" onClose={() => setDisconnectPrompt(false)}><div className="dialog-body"><p>この画面から予定を消し、サンプル表示に戻ります。Google Calendarの予定は削除されません。</p>
      <div className="dialog-actions"><button onClick={() => setDisconnectPrompt(false)}>キャンセル</button><button onClick={disconnect}>接続解除</button></div></div></Modal>}
  </main>;
}
