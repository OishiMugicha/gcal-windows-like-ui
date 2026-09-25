import type { ReactNode } from 'react';
import { useState } from 'react';
import { timeLabel } from './calendar';
import Modal from './Modal';
import type { Calendar, Settings } from './types';
export default function SettingsDialog({ initial, calendars, onSave, onClose, tasksSettings }: {
  tasksSettings?: ReactNode; initial: Settings; calendars: Calendar[]; onSave: (settings: Settings) => void; onClose: () => void;
}) {
  const [value, setValue] = useState(initial);
  const [nextDay, setNextDay] = useState(initial.endMinute >= 1440);
  const patch = (next: Partial<Settings>) => setValue(v => ({ ...v, ...next }));
  const endTime = value.endMinute % 1440;
  const actualEnd = endTime + (nextDay ? 1440 : 0);
  const valid = actualEnd > value.startMinute && actualEnd - value.startMinute <= 1440;
  const times = Array.from({ length: 48 }, (_, i) => i * 30);
  const unavailableDefault = !!value.defaultCalendarId && !calendars.some(c => c.id === value.defaultCalendarId && c.writable);
  return <Modal title="表示設定" onClose={onClose}>
    <form className="dialog-body" onSubmit={e => { e.preventDefault(); if (valid) onSave({ ...value, endMinute: actualEnd }); }}>
      <fieldset><legend>表示する時間帯</legend>
        <div className="date-input-row">
          <label className="field">上端（開始）<select value={value.startMinute} onChange={e => patch({ startMinute: Number(e.target.value) })}>
            {times.map(m => <option key={m} value={m}>{timeLabel(m)}</option>)}</select></label>
          <label className="field">下端（終了）<select value={endTime} onChange={e => patch({ endMinute: Number(e.target.value) + (nextDay ? 1440 : 0) })}>
            {times.map(m => <option key={m} value={m}>{timeLabel(m)}</option>)}</select></label>
        </div>
        <label className="check"><input type="checkbox" checked={nextDay} onChange={e => setNextDay(e.target.checked)} />終了は翌日</label>
        <p className="field-note">指定した時間帯を画面の上下に固定します。時間外の予定は表示されません。</p>
        {!valid && <p className="error-text" role="alert">開始から終了までを30分〜24時間にしてください。</p>}
      </fieldset>
      <fieldset><legend>週表示</legend>
        <label className="field">週の始まり<select value={value.weekStartsOn} onChange={e => patch({ weekStartsOn: Number(e.target.value) as 0 | 1 })}>
          <option value={1}>月曜日</option><option value={0}>日曜日</option></select></label>
        <label className="check"><input type="checkbox" checked={value.showWeekends} onChange={e => patch({ showWeekends: e.target.checked })} />土曜日・日曜日を表示</label>
      </fieldset>
      <fieldset><legend>予定の追加</legend>
        <label className="field">予定追加時のデフォルトカレンダー<select value={value.defaultCalendarId} onChange={e => patch({ defaultCalendarId: e.target.value })}>
          <option value="">自動（従来の動作）</option>
          {unavailableDefault && <option value={value.defaultCalendarId} disabled>設定済みのカレンダー（利用不可）</option>}
          {calendars.filter(c => c.writable).map(c => <option key={c.id} value={c.id}>{c.title}</option>)}
        </select></label>
        <p className="field-note">{unavailableDefault ? '設定済みのカレンダーは利用できません。現在は自動選択します。' : '指定したカレンダーは非表示でも作成先になります。'}</p>
      </fieldset>
      <fieldset><legend>表示するカレンダー</legend>
        {calendars.map(c => <label key={c.id} className="check"><input type="checkbox" checked={value.selectedCalendars.includes(c.id)}
          onChange={e => patch({ selectedCalendars: e.target.checked ? [...value.selectedCalendars, c.id] : value.selectedCalendars.filter(id => id !== c.id) })} />
          <span className="calendar-color" style={{ background: c.color }} />{c.title}{!c.writable && <small>（閲覧のみ）</small>}</label>)}
        {!value.selectedCalendars.length && <p className="field-note">カレンダーが未選択のため、予定は表示されません。</p>}
      </fieldset>
      {tasksSettings}
      <div className="dialog-actions"><button type="button" onClick={onClose}>キャンセル</button><button className="default-button" disabled={!valid}>適用</button></div>
    </form>
  </Modal>;
}
