import { useState } from 'react';
import { addDays, atMinute, dateKey, moveUnavailableReason, timeOf } from './calendar';
import Modal from './Modal';
import type { Calendar, CalendarEvent, EventDraft } from './types';
export function draftFrom(event: CalendarEvent): EventDraft {
  const { id, calendarId, title, description, location, recurring, htmlLink, etag, color, eventType, organizerSelf } = event;
  return { id, calendarId, title, description, location, recurring, htmlLink, etag, color, eventType, organizerSelf, allDay: event.allDay,
    startDate: event.allDay ? event.startDate : dateKey(new Date(event.start)),
    endDate: event.allDay ? addDays(event.endDate, -1) : dateKey(new Date(event.end)),
    startTime: event.allDay ? '09:00' : timeOf(event.start),
    endTime: event.allDay ? '10:00' : timeOf(event.end) };
}
export function draftEvent(draft: EventDraft): CalendarEvent {
  const { startDate, endDate, startTime, endTime, allDay, ...base } = draft;
  const common = { ...base, id: draft.id || '', title: draft.title.trim() || '（タイトルなし）' };
  return allDay
    ? { ...common, allDay: true, startDate, endDate: addDays(endDate, 1) }
    : { ...common, allDay: false, start: new Date(startDate + 'T' + startTime + ':00+09:00').toISOString(), end: new Date(endDate + 'T' + endTime + ':00+09:00').toISOString() };
}
export default function EventEditor({ draft, calendars, busy, error, onSave, onDelete, onClose, onReconnect, source, onChange, blocked, onCheckMove }: {
  draft: EventDraft; calendars: Calendar[]; busy: boolean; error: string; onReconnect?: () => void;
  source: CalendarEvent | null; onChange: (draft: EventDraft) => void; blocked: boolean; onCheckMove?: () => void;
  onSave: (event: CalendarEvent) => void; onDelete: () => void; onClose: () => void;
}) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const readOnly = !calendars.find(c => c.id === (source?.calendarId || draft.calendarId))?.writable;
  const moveReason = source ? moveUnavailableReason(source) : '';
  const moving = !!source && source.calendarId !== draft.calendarId;
  const patch = (value: Partial<EventDraft>) => onChange({ ...draft, ...value });
  const start = atMinute(draft.startDate, draft.allDay ? 0 : Number(draft.startTime.slice(0, 2)) * 60 + Number(draft.startTime.slice(3)));
  const end = atMinute(draft.endDate, draft.allDay ? 1440 : Number(draft.endTime.slice(0, 2)) * 60 + Number(draft.endTime.slice(3)));
  const valid = Number.isFinite(start) && Number.isFinite(end) && end > start;
  return <Modal title={readOnly ? '予定の詳細' : draft.id ? '予定の編集' : '新しい予定'} onClose={onClose} busy={busy}>
    <form className="dialog-body" onSubmit={e => { e.preventDefault(); if (valid && !readOnly && !busy && !blocked) onSave(draftEvent(draft)); }}>
      {draft.recurring && <p className="notice">繰り返し予定の、この1回だけを変更します。</p>}
      <label className="field">件名<input autoFocus value={draft.title} onChange={e => patch({ title: e.target.value })} readOnly={readOnly || busy || blocked} maxLength={1024} /></label>
      <label className="check"><input type="checkbox" checked={draft.allDay} disabled={readOnly || busy || blocked} onChange={e => patch({ allDay: e.target.checked })} />終日</label>
      <div className="date-input-row">
        <label className="field">開始日<input required type="date" value={draft.startDate} readOnly={readOnly || busy || blocked} onChange={e => patch({ startDate: e.target.value })} /></label>
        {!draft.allDay && <label className="field">開始時刻<input required type="time" value={draft.startTime} readOnly={readOnly || busy || blocked} onChange={e => patch({ startTime: e.target.value })} /></label>}
      </div>
      <div className="date-input-row">
        <label className="field">終了日<input required type="date" value={draft.endDate} readOnly={readOnly || busy || blocked} onChange={e => patch({ endDate: e.target.value })} /></label>
        {!draft.allDay && <label className="field">終了時刻<input required type="time" value={draft.endTime} readOnly={readOnly || busy || blocked} onChange={e => patch({ endTime: e.target.value })} /></label>}
      </div>
      <p className="field-note">{draft.allDay ? '終了日も含めて表示します。' : '日本標準時（JST）・日付は実際の日付です。'}</p>
      <label className="field">カレンダー<select value={draft.calendarId} disabled={readOnly || busy || blocked || !!moveReason} onChange={e => patch({ calendarId: e.target.value })}>
        {calendars.filter(c => c.writable || c.id === draft.calendarId).map(c => <option key={c.id} value={c.id}>{c.title}</option>)}
      </select></label>
      {source && moveReason && <p className="field-note">{moveReason}</p>}
      {moving && <p className="notice">保存すると主催カレンダーが変わり、参加者に通知されます。</p>}
      <label className="field">場所<input value={draft.location || ''} readOnly={readOnly || busy || blocked} onChange={e => patch({ location: e.target.value })} /></label>
      <label className="field">説明<textarea rows={3} value={draft.description || ''} readOnly={readOnly || busy || blocked} onChange={e => patch({ description: e.target.value })} /></label>
      {!valid && <p className="error-text" role="alert">終了日時は開始日時より後にしてください。</p>}
      {error && <p className="error-text" role="alert">{error}</p>}
      {onCheckMove && <button type="button" disabled={busy} onClick={onCheckMove}>移動結果を確認</button>}
      {onReconnect && <button type="button" disabled={busy} onClick={onReconnect}>入力を保持してGoogleに再接続</button>}
      {draft.htmlLink && <a href={draft.htmlLink} target="_blank" rel="noreferrer">Google Calendarで開く ↗</a>}
      {readOnly && <p className="notice">このカレンダーは読み取り専用です。</p>}
      {confirmDelete && <div className="delete-confirm" role="alert">
        <p>{draft.recurring ? 'この1回の予定を削除しますか？' : 'この予定を削除しますか？'}</p>
        <button type="button" disabled={busy || blocked} onClick={onDelete}>削除する</button>
        <button type="button" disabled={busy} onClick={() => setConfirmDelete(false)}>戻る</button>
      </div>}
      <div className="dialog-actions">
        {!!draft.id && !readOnly && <button type="button" className="delete-button" disabled={busy || blocked} onClick={() => setConfirmDelete(true)}>削除…</button>}
        <button type="button" disabled={busy} onClick={onClose}>{readOnly ? '閉じる' : 'キャンセル'}</button>
        {!readOnly && <button className="default-button" type="submit" disabled={busy || blocked || !valid || confirmDelete}>{busy ? '保存中…' : '保存'}</button>}
      </div>
    </form>
  </Modal>;
}
