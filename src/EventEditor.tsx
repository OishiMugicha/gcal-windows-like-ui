import { useState } from 'react';
import { addDays, atMinute, dateKey, timeOf } from './calendar';
import Modal from './Modal';
import type { Calendar, CalendarEvent, EventDraft } from './types';
export function draftFrom(event: CalendarEvent): EventDraft {
  const { id, calendarId, title, description, location, recurring, htmlLink, etag, color } = event;
  return { id, calendarId, title, description, location, recurring, htmlLink, etag, color, allDay: event.allDay,
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
export default function EventEditor({ initial, calendars, busy, error, onSave, onDelete, onClose }: {
  initial: EventDraft; calendars: Calendar[]; busy: boolean; error: string;
  onSave: (event: CalendarEvent) => void; onDelete: (event: CalendarEvent) => void; onClose: () => void;
}) {
  const [draft, setDraft] = useState(initial);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const readOnly = !calendars.find(c => c.id === draft.calendarId)?.writable;
  const patch = (value: Partial<EventDraft>) => setDraft(d => ({ ...d, ...value }));
  const start = atMinute(draft.startDate, draft.allDay ? 0 : Number(draft.startTime.slice(0, 2)) * 60 + Number(draft.startTime.slice(3)));
  const end = atMinute(draft.endDate, draft.allDay ? 1440 : Number(draft.endTime.slice(0, 2)) * 60 + Number(draft.endTime.slice(3)));
  const valid = Number.isFinite(start) && Number.isFinite(end) && end > start;
  return <Modal title={readOnly ? '予定の詳細' : draft.id ? '予定の編集' : '新しい予定'} onClose={onClose} busy={busy}>
    <form className="dialog-body" onSubmit={e => { e.preventDefault(); if (valid && !readOnly && !busy) onSave(draftEvent(draft)); }}>
      {draft.recurring && <p className="notice">繰り返し予定の、この1回だけを変更します。</p>}
      <label className="field">件名<input autoFocus value={draft.title} onChange={e => patch({ title: e.target.value })} readOnly={readOnly} maxLength={1024} /></label>
      <label className="check"><input type="checkbox" checked={draft.allDay} disabled={readOnly || busy} onChange={e => patch({ allDay: e.target.checked })} />終日</label>
      <div className="date-input-row">
        <label className="field">開始日<input required type="date" value={draft.startDate} readOnly={readOnly} onChange={e => patch({ startDate: e.target.value })} /></label>
        {!draft.allDay && <label className="field">開始時刻<input required type="time" value={draft.startTime} readOnly={readOnly} onChange={e => patch({ startTime: e.target.value })} /></label>}
      </div>
      <div className="date-input-row">
        <label className="field">終了日<input required type="date" value={draft.endDate} readOnly={readOnly} onChange={e => patch({ endDate: e.target.value })} /></label>
        {!draft.allDay && <label className="field">終了時刻<input required type="time" value={draft.endTime} readOnly={readOnly} onChange={e => patch({ endTime: e.target.value })} /></label>}
      </div>
      <p className="field-note">{draft.allDay ? '終了日も含めて表示します。' : '日本標準時（JST）・日付は実際の日付です。'}</p>
      <label className="field">カレンダー<select value={draft.calendarId} disabled={!!draft.id || busy} onChange={e => patch({ calendarId: e.target.value })}>
        {calendars.filter(c => c.writable || c.id === draft.calendarId).map(c => <option key={c.id} value={c.id}>{c.title}</option>)}
      </select></label>
      <label className="field">場所<input value={draft.location || ''} readOnly={readOnly} onChange={e => patch({ location: e.target.value })} /></label>
      <label className="field">説明<textarea rows={3} value={draft.description || ''} readOnly={readOnly} onChange={e => patch({ description: e.target.value })} /></label>
      {!valid && <p className="error-text" role="alert">終了日時は開始日時より後にしてください。</p>}
      {error && <p className="error-text" role="alert">{error}</p>}
      {draft.htmlLink && <a href={draft.htmlLink} target="_blank" rel="noreferrer">Google Calendarで開く ↗</a>}
      {readOnly && <p className="notice">このカレンダーは読み取り専用です。</p>}
      {confirmDelete && <div className="delete-confirm" role="alert">
        <p>{draft.recurring ? 'この1回の予定を削除しますか？' : 'この予定を削除しますか？'}</p>
        <button type="button" disabled={busy} onClick={() => onDelete(draftEvent(draft))}>削除する</button>
        <button type="button" disabled={busy} onClick={() => setConfirmDelete(false)}>戻る</button>
      </div>}
      <div className="dialog-actions">
        {!!draft.id && !readOnly && <button type="button" className="delete-button" disabled={busy} onClick={() => setConfirmDelete(true)}>削除…</button>}
        <button type="button" disabled={busy} onClick={onClose}>{readOnly ? '閉じる' : 'キャンセル'}</button>
        {!readOnly && <button className="default-button" type="submit" disabled={busy || !valid || confirmDelete}>{busy ? '保存中…' : '保存'}</button>}
      </div>
    </form>
  </Modal>;
}
