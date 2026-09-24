import { useEffect, useRef, useState } from 'react';
import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react';
import { atMinute, layoutEvents, MINUTE, timeLabel, timeOf } from './calendar';
import type { Calendar, CalendarEvent, Settings } from './types';

type TimedEvent = CalendarEvent & { allDay: false };
interface Props {
  days: string[]; settings: Settings; events: CalendarEvent[]; calendars: Calendar[];
  busy: boolean;
  onCreate: (start: number, end: number) => void;
  onEdit: (event: CalendarEvent) => void;
  onChange: (event: TimedEvent) => void;
}
interface Drag {
  kind: 'create' | 'move' | 'start' | 'end';
  event?: TimedEvent; origin: number; current: number;
  x: number; y: number; moved: boolean; column: number;
}
export default function TimeGrid({ days, settings, events, calendars, busy, onCreate, onEdit, onChange }: Props) {
  const container = useRef<HTMLDivElement>(null);
  const dragRef = useRef<Drag | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const id = window.setInterval(() => setNow(Date.now()), 60_000); return () => clearInterval(id); }, []);
  const duration = settings.endMinute - settings.startMinute;
  function point(e: ReactPointerEvent, fixedColumn?: number) {
    const rect = container.current!.getBoundingClientRect();
    const column = fixedColumn ?? Math.max(0, Math.min(days.length - 1, Math.floor((e.clientX - rect.left - 58) / (rect.width - 58) * days.length)));
    const ratio = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));
    const minute = Math.max(settings.startMinute, Math.min(settings.endMinute, settings.startMinute + Math.round(ratio * duration / 15) * 15));
    return { column, stamp: atMinute(days[column], minute) };
  }
  function start(e: ReactPointerEvent, column: number, kind: Drag['kind'], event?: TimedEvent) {
    if (e.button !== 0 || busy || (event && !calendars.find(c => c.id === event.calendarId)?.writable)) return;
    // Touch users edit with a tap; avoid hijacking page gestures.
    if (e.pointerType === 'touch' && kind !== 'create') return;
    e.preventDefault(); e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    const p = point(e, column);
    const next: Drag = { kind, event, origin: p.stamp, current: p.stamp, x: e.clientX, y: e.clientY, moved: false, column };
    dragRef.current = next; setDrag(next);
  }
  function move(e: ReactPointerEvent) {
    const current = dragRef.current;
    if (!current) return;
    const p = point(e, current.kind === 'create' ? current.column : undefined);
    const next = { ...current, current: p.stamp, moved: current.moved || Math.hypot(e.clientX - current.x, e.clientY - current.y) > 5 };
    dragRef.current = next; setDrag(next);
  }
  function changed(d: Drag): TimedEvent | undefined {
    if (!d.event) return;
    const delta = d.current - d.origin;
    let start = Date.parse(d.event.start), end = Date.parse(d.event.end);
    if (d.kind === 'move') { start += delta; end += delta; }
    if (d.kind === 'start') start = Math.min(start + delta, end - 15 * MINUTE);
    if (d.kind === 'end') end = Math.max(end + delta, start + 15 * MINUTE);
    return { ...d.event, start: new Date(start).toISOString(), end: new Date(end).toISOString() };
  }
  function finish() {
    const d = dragRef.current;
    dragRef.current = null; setDrag(null);
    if (!d) return;
    if (d.kind === 'create') {
      const lo = atMinute(days[d.column], settings.startMinute), hi = atMinute(days[d.column], settings.endMinute);
      let start = Math.min(d.origin, d.current), end = Math.max(d.origin, d.current);
      if (end === start) { start = Math.min(start, hi - 30 * MINUTE); end = Math.min(start + 60 * MINUTE, hi); }
      onCreate(Math.max(start, lo), Math.min(end, hi));
    } else if (!d.moved && d.event) onEdit(d.event);
    else {
      const updated = changed(d);
      if (updated && (updated.start !== d.event!.start || updated.end !== d.event!.end)) onChange(updated);
    }
  }
  function cancel() { dragRef.current = null; setDrag(null); }
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') { dragRef.current = null; setDrag(null); } };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);
  const ghost = drag?.moved ? changed(drag) : undefined;
  const displayEvents = ghost ? events.map(e => e.id === ghost.id && e.calendarId === ghost.calendarId ? ghost : e) : events;
  const ticks = [settings.startMinute];
  for (let m = Math.ceil((settings.startMinute + 1) / 60) * 60; m < settings.endMinute; m += 60) ticks.push(m);
  ticks.push(settings.endMinute);
  const labelStep = duration > 1200 ? 120 : 60;
  return <div ref={container} className="time-grid" style={{ gridTemplateColumns: '58px repeat(' + days.length + ', minmax(0, 1fr))' }}
    onPointerMove={move} onPointerUp={finish} onPointerCancel={cancel}>
    <div className="time-axis" aria-hidden="true">{ticks.filter((m, i) => i === 0 || i === ticks.length - 1 || (m % labelStep === 0 && m - settings.startMinute >= 30 && settings.endMinute - m >= 30))
      .map(m => <span key={m} data-time={timeLabel(m)} style={{ top: (m - settings.startMinute) / duration * 100 + '%' }}>{timeLabel(m)}</span>)}</div>
    {days.map((day, index) => {
      const lo = atMinute(day, settings.startMinute), hi = atMinute(day, settings.endMinute);
      const inNow = now >= lo && now < hi;
      return <div key={day} data-day={day} className={'day-column' + (inNow ? ' today-column' : '')}
        onPointerDown={e => { if (e.target === e.currentTarget) start(e, index, 'create'); }}>
        {ticks.map(m => <div className="hour-line" key={m} style={{ top: (m - settings.startMinute) / duration * 100 + '%' }} />)}
        {layoutEvents(displayEvents, day, settings).map(s => {
          const calendar = calendars.find(c => c.id === s.event.calendarId);
          const compact = s.height < 5;
          return <button key={s.event.calendarId + s.event.id}
            data-event-id={s.event.id}
            className={'event-block' + (compact ? ' compact' : '') + (s.clippedStart ? ' clipped-start' : '') + (s.clippedEnd ? ' clipped-end' : '')}
            aria-label={s.event.title + ' ' + timeOf(s.event.start) + '〜' + timeOf(s.event.end)}
            title={s.event.title + '\n' + timeOf(s.event.start) + ' – ' + timeOf(s.event.end)}
            style={{ top: s.top + '%', height: s.height + '%', left: s.column / s.columns * 100 + '%',
              width: 100 / s.columns + '%', '--event-color': s.event.color || calendar?.color || '#3159a6',
            } as CSSProperties}
            onPointerDown={e => start(e, index, 'move', s.event)}
            onClick={e => { if (e.detail === 0 || !calendar?.writable || (e.nativeEvent as PointerEvent).pointerType === 'touch') onEdit(s.event); }}>
            {calendar?.writable && !s.clippedStart && <span className="resize-handle resize-start" aria-hidden="true" onPointerDown={e => start(e, index, 'start', s.event)} />}
            {!compact && <span className="event-time">{timeOf(s.event.start)} – {timeOf(s.event.end)}</span>}
            <strong>{s.event.recurring ? '↻ ' : ''}{s.event.title}</strong>
            {calendar?.writable && !s.clippedEnd && <span className="resize-handle resize-end" aria-hidden="true" onPointerDown={e => start(e, index, 'end', s.event)} />}
          </button>;
        })}
        {inNow && <div className="now-line" style={{ top: (now - lo) / (hi - lo) * 100 + '%' }}><span /></div>}
        {drag?.kind === 'create' && drag.column === index && <div className="selection" style={{
          top: (Math.min(drag.origin, drag.current) - lo) / (hi - lo) * 100 + '%',
          height: Math.max(15 * MINUTE, Math.abs(drag.current - drag.origin)) / (hi - lo) * 100 + '%',
        }} />}
      </div>;
    })}
  </div>;
}
