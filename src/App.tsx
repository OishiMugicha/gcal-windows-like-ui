import { useTasks } from './useTasks';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { addDays, atMinute, dateKey, defaultCalendar, isOnDay, moveUnavailableReason, rangeFor, readSettings, sameEventContent, timeLabel, timeOf, visibleDays, weekday } from './calendar';
import { demoCalendars, demoEvents } from './demo';
import type { Calendar, CalendarEvent, EventDraft, Settings, View } from './types';
import TimeGrid from './TimeGrid';
import { useCalendarTools } from './useCalendarTools';
import SettingsDialog from './SettingsDialog';
import EventEditor, { draftEvent, draftFrom } from './EventEditor';
import Modal from './Modal';
import { ConnectionExpired, OperationUncertain, connectGoogle, deleteGoogleEvent, disconnectGoogle, getGoogleEvent, loadCalendars, loadEvents, moveGoogleEvent, newEventId, prepareGoogle, restoreGoogle, saveGoogleEvent } from './google';
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
  const [demoDefault, setDemoDefault] = useState('');
  const [showSettings, setShowSettings] = useState(false);
  const [draft, setDraft] = useState<EventDraft | null>(null);
  const [editingSource, setEditingSource] = useState<CalendarEvent | null>(null);
  const [uncertainMove, setUncertainMove] = useState<{ source: CalendarEvent; destination: string } | null>(null);
  const [editorError, setEditorError] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [connectionVersion, setConnectionVersion] = useState(0);
  const [connecting, setConnecting] = useState(false);
  const [restoreFailed, setRestoreFailed] = useState(false);
  const connectionAttempt = useRef(0);
  const [expired, setExpired] = useState(false);
  const [notice, setNotice] = useState('');
  const [listDay, setListDay] = useState<string | null>(null);
  const [disconnectPrompt, setDisconnectPrompt] = useState(false);
  const revision = useRef(0), pendingNewId = useRef(''), busyRef = useRef(false);
  const days = useMemo(() => visibleDays(anchor, settings), [anchor, settings]);
  const selected = mode === 'demo' ? demoSelected : settings.selectedCalendars;
  const preferredCalendar = mode === 'demo' ? demoDefault : settings.defaultCalendarId;
  const selectedKey = selected.join('\n');
  const range = rangeFor(days, settings);
  const filtered = events.filter(e => selected.includes(e.calendarId));
  const gridStyle = { gridTemplateColumns: '58px repeat(' + days.length + ', minmax(0, 1fr))' };
  const clientId = (import.meta.env.VITE_GOOGLE_CLIENT_ID || '').trim();
  const todo = useTasks({ connected: mode === 'google', connecting, blocked: busy, version: connectionVersion, days,
    onExpired: () => setExpired(true), onReconnect: () => void connect(false, true) });
  useEffect(() => { if (clientId) prepareGoogle().catch(() => {}); }, [clientId]);
  useEffect(() => {
    const state = restoreGoogle(clientId);
    if (state === 'connected') void connect(true);
    else if (state === 'expired') { setExpired(true); setError(new ConnectionExpired().message); }
    return () => { connectionAttempt.current++; };
  }, [clientId]);
  useEffect(() => {
    try { localStorage.setItem('calendar95.settings', JSON.stringify(settings)); }
    catch { setNotice('設定を保存できません。このブラウザの保存領域を確認してください。'); }
  }, [settings]);
  useEffect(() => { if (!notice) return; const timer = setTimeout(() => setNotice(''), 5000); return () => clearTimeout(timer); }, [notice]);
  const deferredRefresh = useRef(false);
  const refresh = useCallback(async (clearError = true) => {
    if (mode !== 'google' || connecting) return;
    if (busyRef.current) { deferredRefresh.current = true; return; }
    deferredRefresh.current = false;
    const requestId = ++revision.current;
    setLoading(true); if (clearError) setError('');
    try {
      const results = await Promise.all(settings.selectedCalendars.map(id => loadEvents(id, range.start, range.end)));
      if (requestId !== revision.current) return;
      setEvents(results.flat()); setExpired(false);
    } catch (e) {
      if (requestId !== revision.current) return;
      setError(errorMessage(e)); if (e instanceof ConnectionExpired) setExpired(true);
    } finally { if (requestId === revision.current) setLoading(false); }
  }, [mode, selectedKey, range.start, range.end, connectionVersion, connecting]);
  const latestRefresh = useRef(refresh);
  latestRefresh.current = refresh;
  function finishOperation() {
    busyRef.current = false; setBusy(false);
    if (deferredRefresh.current) void latestRefresh.current(false);
  }
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
  function openEditor(event: CalendarEvent) { if (busyRef.current || todo.busy || connecting) return; pendingNewId.current = ''; setEditingSource(event); setUncertainMove(null); setEditorError(''); setDraft(draftFrom(event)); }
  function newDraft(start = atMinute(anchor, settings.startMinute), end = start + 60 * 60_000) {
    if (busyRef.current || todo.busy || connecting) return;
    const calendar = defaultCalendar(calendars, selected, preferredCalendar);
    if (!calendar) { setError('書き込み可能なカレンダーがありません。'); return; }
    pendingNewId.current = newEventId(); setEditingSource(null); setUncertainMove(null); setEditorError('');
    setDraft(draftFrom({ id: '', calendarId: calendar.id, title: '', allDay: false, start: new Date(start).toISOString(), end: new Date(end).toISOString() }));
  }
  function markOutside(event: CalendarEvent) {
    const day = event.allDay ? event.startDate : dateKey(new Date(event.start));
    const visible = days.some(d => event.allDay ? isOnDay(event, d) : Date.parse(event.start) < atMinute(d, settings.endMinute) && Date.parse(event.end) > atMinute(d, settings.startMinute));
    setNotice(!selected.includes(event.calendarId) ? '保存しました。作成先カレンダーは現在非表示です。' : !visible ? '保存しました。予定は現在の表示範囲外です（' + day + '）。' : '保存しました。');
  }
  function replaceEvent(source: CalendarEvent, saved: CalendarEvent) {
    setEvents(current => [...current.filter(e => !sameEvent(e, source) && !sameEvent(e, saved)), saved]);
  }
  function adoptMovedEvent(saved: CalendarEvent, wanted: CalendarEvent) {
    setEditingSource(saved);
    setDraft(draftFrom({ ...wanted, id: saved.id, calendarId: saved.calendarId, etag: saved.etag,
      htmlLink: saved.htmlLink, organizerSelf: saved.organizerSelf, eventType: saved.eventType }));
  }
  async function save(event: CalendarEvent, fromEditor = true) {
    if (busyRef.current || todo.busy || connecting || (fromEditor && uncertainMove)) return;
    const source = fromEditor ? editingSource : events.find(current => sameEvent(current, event));
    const savedDraft = draft;
    const isNew = !event.id;
    let target = isNew ? { ...event, id: pendingNewId.current || newEventId() } : { ...event, etag: source?.etag ?? event.etag };
    const moving = !!source && source.calendarId !== event.calendarId;
    if (!calendars.some(c => c.id === target.calendarId && c.writable)
      || (source && !calendars.some(c => c.id === source.calendarId && c.writable))) {
      setEditorError('書き込み可能なカレンダーを選択してください。'); return;
    }
    if (moving && moveUnavailableReason(source)) { setEditorError(moveUnavailableReason(source)); return; }
    busyRef.current = true; setBusy(true); setEditorError(''); setError(''); revision.current++; setLoading(false);
    const optimistic = target;
    replaceEvent(source || target, target);
    if (fromEditor) { setDraft(null); setEditingSource(null); }
    let moved: CalendarEvent | undefined;
    try {
      if (moving) {
        try { moved = mode === 'demo' ? { ...source, calendarId: target.calendarId } : await moveGoogleEvent(source, target.calendarId); }
        catch (error) {
          if (error instanceof OperationUncertain) {
            setUncertainMove({ source, destination: target.calendarId });
            throw new Error('移動結果を確認できません。「移動結果を確認」を押してください。確認できない場合は閉じて更新してください。');
          }
          throw error;
        }
        // Keep the requested content visible until both operations settle.
        target = { ...target, id: moved.id, etag: moved.etag, htmlLink: moved.htmlLink,
          organizerSelf: moved.organizerSelf, eventType: moved.eventType };
      }
      const saved = mode === 'demo' ? target : moved && sameEventContent(source!, target) ? moved : await saveGoogleEvent(target, isNew);
      replaceEvent(optimistic, saved);
      if (fromEditor) { setDraft(null); setEditingSource(null); }
      markOutside(saved);
    } catch (e) {
      if (moved) replaceEvent(optimistic, moved);
      else if (source) replaceEvent(optimistic, source);
      else setEvents(current => current.filter(item => !sameEvent(item, target)));
      if (fromEditor) {
        if (moved) adoptMovedEvent(moved, event);
        else { setDraft(savedDraft); setEditingSource(source || null); }
      }
      const message = (moved ? e instanceof OperationUncertain ? '移動済みですが、内容変更の保存結果は不明です。' : '移動済みですが、内容変更は未保存です。' : '') + errorMessage(e);
      if (fromEditor) setEditorError(message); else setError(message);
      if (e instanceof ConnectionExpired) setExpired(true);
    } finally { finishOperation(); }
  }
  async function checkMove() {
    if (!uncertainMove || !draft || busyRef.current) return;
    const { source, destination } = uncertainMove;
    busyRef.current = true; setBusy(true); revision.current++; setLoading(false);
    try {
      const [original, moved] = await Promise.all([
        getGoogleEvent(source.calendarId, source.id), getGoogleEvent(destination, source.id),
      ]);
      // A guest copy can remain in the source calendar after ownership changes.
      if (moved?.organizerSelf && (!original || !original.organizerSelf)) {
        replaceEvent(source, moved);
        adoptMovedEvent(moved, draftEvent(draft));
        setUncertainMove(null);
        setEditorError('移動を確認しました。内容変更がある場合は保存してください。');
      } else if (original?.organizerSelf && !moved) {
        setEditingSource(original); replaceEvent(source, original);
        setUncertainMove(null);
        setEditorError('予定は元のカレンダーにあります。移動は未完了です。');
      } else setEditorError('移動結果を確定できません。閉じてカレンダーを更新してください。');
    } catch (e) {
      setEditorError('移動結果を確認できません。' + errorMessage(e));
      if (e instanceof ConnectionExpired) setExpired(true);
    } finally { finishOperation(); }
  }
  async function remove() {
    if (busyRef.current || todo.busy || connecting || uncertainMove || !editingSource) return;
    const event = editingSource;
    const savedDraft = draft;
    if (!calendars.some(c => c.id === event.calendarId && c.writable)) return;
    busyRef.current = true; setBusy(true); setEditorError(''); revision.current++; setLoading(false);
    setEvents(current => current.filter(e => !sameEvent(e, event)));
    setDraft(null); setEditingSource(null);
    try {
      if (mode === 'google') await deleteGoogleEvent(event);
      setEvents(current => current.filter(e => !sameEvent(e, event))); setDraft(null); setEditingSource(null); setNotice('予定を削除しました。');
    } catch (e) { replaceEvent(event, event); setDraft(savedDraft); setEditingSource(event); setEditorError(errorMessage(e)); if (e instanceof ConnectionExpired) setExpired(true); }
    finally { finishOperation(); }
  }
  async function connect(restore = false, includeTasks = todo.enabled) {
    if (!clientId) { setNotice('Google接続はまだ設定されていません。サイトの管理者にお問い合わせください。'); return; }
    const attempt = ++connectionAttempt.current;
    setConnecting(true); setRestoreFailed(false); setError(''); revision.current++;
    if (restore) { setCalendars([]); setEvents([]); }
    let authenticated = restore;
    try {
      const persisted = restore || await connectGoogle(clientId, includeTasks);
      authenticated = true;
      if (attempt !== connectionAttempt.current) return;
      const list = await loadCalendars();
      if (attempt !== connectionAttempt.current) return;
      setCalendars(list); setEvents([]); setMode('google'); setExpired(false);
      setSettings(current => {
        const saved = current.selectedCalendars.filter(id => list.some(c => c.id === id));
        return { ...current, selectedCalendars: saved.length ? saved : list.filter(c => c.primary).map(c => c.id) };
      });
      setEditorError('');
      setConnectionVersion(v => v + 1);
      setNotice(persisted ? 'Google Calendarに接続しました。' : '接続しましたが、接続情報を保存できません。次回は再接続が必要です。');
    } catch (e) {
      if (attempt !== connectionAttempt.current) return;
      setError(errorMessage(e));
      if (e instanceof ConnectionExpired) { setExpired(true); setRestoreFailed(false); }
      else if (authenticated) setRestoreFailed(true);
    }
    finally { if (attempt === connectionAttempt.current) setConnecting(false); }
  }
  function disconnect() {
    connectionAttempt.current++; setConnecting(false); setRestoreFailed(false); setDraft(null); setEditingSource(null); setUncertainMove(null); setListDay(null);
    revision.current++; disconnectGoogle(); setMode('demo'); setCalendars(demoCalendars); setEvents(demoEvents());
    setExpired(false); setLoading(false); setError(''); setDisconnectPrompt(false);
  }
  function closeEditor() {
    if (busyRef.current || connecting) return;
    setDraft(null); setEditingSource(null); setUncertainMove(null);
    void refresh();
  }
  function applySettings(next: Settings) {
    if (mode === 'demo') {
      setDemoSelected(next.selectedCalendars); setDemoDefault(next.defaultCalendarId);
      setSettings({ ...next, selectedCalendars: settings.selectedCalendars, defaultCalendarId: settings.defaultCalendarId });
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
      <span className="toolbar-divider" /><button onClick={() => newDraft()} disabled={busy || todo.busy || connecting}>＋ 予定</button>
      <button onClick={() => setShowSettings(true)} disabled={busy || todo.busy}>設定</button>
      {mode === 'google' && <button onClick={() => { void refresh(); void todo.refresh(); }} disabled={loading || todo.loading || busy || todo.busy || expired || connecting || restoreFailed} aria-label="予定を更新">更新</button>}
      {mode === 'demo' || expired ? <button onClick={() => void connect()} disabled={connecting || busy || todo.busy}>{connecting ? '接続中…' : expired ? '再接続' : 'Googleに接続'}</button>
        : <button onClick={() => setDisconnectPrompt(true)} disabled={busy || todo.busy}>接続解除</button>}
    </nav>
    {restoreFailed && <div className="error-banner"><button onClick={() => void connect(true)} disabled={connecting}>接続の復元を再試行</button><button onClick={disconnect}>接続解除</button></div>}
    {error && <div className="error-banner" role="alert"><span>{error}</span><button onClick={() => setError('')} aria-label="エラーを閉じる">×</button></div>}
    {todo.banner}
    <section className="calendar-surface" aria-label="カレンダー" aria-busy={loading || todo.loading || busy || todo.busy || connecting}>
      {settings.view === 'month' ? <>
        <div className="month-weekdays" style={{ gridTemplateColumns: 'repeat(' + (settings.showWeekends ? 7 : 5) + ', 1fr)' }}>
          {days.slice(0, settings.showWeekends ? 7 : 5).map(day => <span key={day}>{weekdays[weekday(day)]}</span>)}</div>
        <div className="month-grid" style={{ gridTemplateColumns: 'repeat(' + (settings.showWeekends ? 7 : 5) + ', minmax(0, 1fr))' }}>
          {days.map(day => {
            const onDay = filtered.filter(e => isOnDay(e, day)).sort((a, b) => Number(b.allDay) - Number(a.allDay) || (!a.allDay && !b.allDay ? a.start.localeCompare(b.start) : 0));
            const renderEvent = (e: CalendarEvent) => <button key={e.calendarId + e.id} className="month-event" style={calendarColor(e)} onClick={() => openEditor(e)}>{!e.allDay && <span>{timeOf(e.start)} </span>}{e.title}</button>;
            const items = [...onDay.filter(e => e.allDay).map(renderEvent), ...todo.rows(day), ...onDay.filter(e => !e.allDay).map(renderEvent)];
            return <div key={day} className={'month-cell' + (day.slice(0, 7) !== anchor.slice(0, 7) ? ' other-month' : '') + (day === dateKey() ? ' month-today' : '')}>
              <button className="month-date" aria-label={day + 'の日表示'} onClick={() => { setAnchor(day); selectView('day'); }}>{Number(day.slice(8))}</button>
              <div className="month-events">{items.slice(0, 3)}</div>
              {items.length > 3 && <button className="more-button" onClick={() => setListDay(day)}>ほか{items.length - 3}件</button>}
            </div>;
          })}
        </div>
      </> : <>
        <div className="date-head" style={gridStyle}><span className="zone-label">JST</span>{days.map(day => <button key={day} onClick={() => { setAnchor(day); selectView('day'); }}
          className={'day-heading' + (day === dateKey() ? ' today' : '') + (weekday(day) === 0 ? ' sunday' : '')} aria-label={day + 'の日表示'}><span>{weekdays[weekday(day)]}</span><strong>{Number(day.slice(8))}</strong></button>)}</div>
        <div className="all-day-row" style={gridStyle}><span className="zone-label">終日</span>{days.map(day => {
          const allDay = filtered.filter(e => e.allDay && isOnDay(e, day));
          const items = [...allDay.map(e => <button key={e.calendarId + e.id} style={calendarColor(e)} className="all-day-event" onClick={() => openEditor(e)}>{e.title}</button>), ...todo.rows(day)];
          return <div key={day} className="all-day-cell">{items.slice(0, 1)}
            {items.length > 1 && <button className="more-button" onClick={() => setListDay(day)}>ほか{items.length - 1}件</button>}</div>;
        })}</div>
        <TimeGrid days={days} settings={settings} events={filtered} calendars={calendars} busy={busy || todo.busy || loading || connecting} onCreate={newDraft} onEdit={openEditor} onChange={e => void save(e, false)} />
      </>}
      {!selected.length && !todo.enabled && <div className="empty-selection"><span>表示するカレンダーが選択されていません。</span><button onClick={() => setShowSettings(true)}>設定を開く</button></div>}
    </section>
    <footer className="statusbar" aria-live="polite"><span>{connecting ? 'Googleへの接続を確認中…' : loading || todo.loading ? '予定・ToDoを取得中…' : busy || todo.busy ? '保存中…' : notice || (expired ? 'Googleへの再接続が必要です' : mode === 'demo' ? 'サンプル表示 · 変更はGoogleに送信されません' : 'Google Calendarに接続済み')}</span>
      <span>{settings.view === 'month' ? '月表示' : timeLabel(settings.startMinute) + ' – ' + timeLabel(settings.endMinute) + ' · 表示時間を固定'}</span><span>日本標準時</span></footer>
    {showSettings && <SettingsDialog tasksSettings={todo.settings} initial={{ ...settings, selectedCalendars: selected, defaultCalendarId: preferredCalendar }} calendars={calendars} onSave={applySettings} onClose={() => setShowSettings(false)} />}
    {draft && <EventEditor draft={draft} source={editingSource} onChange={setDraft} calendars={calendars}
      busy={busy || connecting} blocked={!!uncertainMove} error={editorError}
      onReconnect={expired ? () => void connect() : undefined}
      onCheckMove={uncertainMove ? () => void checkMove() : undefined}
      onSave={e => void save(e)} onDelete={() => void remove()} onClose={closeEditor} />}
    {listDay && <Modal title={listDay.replaceAll('-', '.') + ' の予定'} busy={todo.busy} onClose={() => { if (!todo.busy) setListDay(null); }}>
      <div className="dialog-body agenda-list">{filtered.filter(e => isOnDay(e, listDay) && (settings.view === 'month' || e.allDay)).map(e => <button key={e.calendarId + e.id} style={calendarColor(e)} className="agenda-item" onClick={() => { setListDay(null); openEditor(e); }}><span>{e.allDay ? '終日' : timeOf(e.start)}</span>{e.title}</button>)}{todo.rows(listDay)}</div>
    </Modal>}
    {todo.editor}
    {disconnectPrompt && <Modal title="Googleとの接続を解除" onClose={() => setDisconnectPrompt(false)}><div className="dialog-body"><p>この画面から予定を消し、サンプル表示に戻ります。Google Calendarの予定は削除されません。</p>
      <div className="dialog-actions"><button onClick={() => setDisconnectPrompt(false)}>キャンセル</button><button onClick={disconnect}>接続解除</button></div></div></Modal>}
  </main>;
}
