import type { CalendarEvent, Settings } from './types';
export const ZONE = 'Asia/Tokyo';
export const MINUTE = 60_000;
export const defaults: Settings = {
  startMinute: 480, endMinute: 1560, weekStartsOn: 1,
  showWeekends: true, view: 'week', selectedCalendars: [], clientId: '',
};
export const pad = (n: number) => String(n).padStart(2, '0');
export function dateKey(date: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date);
  const get = (type: string) => parts.find(p => p.type === type)!.value;
  return get('year') + '-' + get('month') + '-' + get('day');
}
export function addDays(day: string, amount: number): string {
  const value = new Date(day + 'T00:00:00Z');
  value.setUTCDate(value.getUTCDate() + amount);
  return value.toISOString().slice(0, 10);
}
export function weekday(day: string): number { return new Date(day + 'T00:00:00Z').getUTCDay(); }
export function atMinute(day: string, minute: number): number {
  return Date.parse(day + 'T00:00:00+09:00') + minute * MINUTE;
}
export function timeLabel(minute: number): string {
  const value = ((minute % 1440) + 1440) % 1440;
  return pad(Math.floor(value / 60)) + ':' + pad(value % 60);
}
export function timeOf(iso: string): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone: ZONE, hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(iso));
}
export function visibleDays(anchor: string, settings: Settings): string[] {
  if (settings.view === 'day') return [anchor];
  let first = anchor, count = 7;
  if (settings.view === 'month') {
    first = anchor.slice(0, 8) + '01';
    first = addDays(first, -((weekday(first) - settings.weekStartsOn + 7) % 7));
    count = 42;
  } else first = addDays(anchor, -((weekday(anchor) - settings.weekStartsOn + 7) % 7));
  return Array.from({ length: count }, (_, i) => addDays(first, i))
    .filter(d => settings.showWeekends || (weekday(d) !== 0 && weekday(d) !== 6));
}
export function rangeFor(days: string[], settings: Settings) {
  // Include both the full civil dates (all-day events) and the extended last night.
  return {
    start: new Date(atMinute(days[0], 0)).toISOString(),
    end: new Date(atMinute(days.at(-1)!, Math.max(1440, settings.endMinute))).toISOString(),
  };
}
export function isOnDay(event: CalendarEvent, day: string): boolean {
  return event.allDay
    ? event.startDate <= day && event.endDate > day
    : Date.parse(event.start) < atMinute(day, 1440) && Date.parse(event.end) > atMinute(day, 0);
}
export interface Segment {
  event: CalendarEvent & { allDay: false };
  start: number; end: number;
  top: number; height: number;
  column: number; columns: number;
  clippedStart: boolean; clippedEnd: boolean;
}
export function layoutEvents(events: CalendarEvent[], day: string, settings: Settings): Segment[] {
  const lo = atMinute(day, settings.startMinute), hi = atMinute(day, settings.endMinute);
  const result: Segment[] = events.flatMap(event => {
    if (event.allDay) return [];
    const rawStart = Date.parse(event.start), rawEnd = Date.parse(event.end);
    const start = Math.max(rawStart, lo), end = Math.min(rawEnd, hi);
    if (start >= end) return [];
    return [{ event, start, end, top: (start - lo) / (hi - lo) * 100,
      height: (end - start) / (hi - lo) * 100, column: 0, columns: 1,
      clippedStart: rawStart < lo, clippedEnd: rawEnd > hi }];
  }).sort((a, b) => a.start - b.start || b.end - a.end);
  let group: Segment[] = [], groupEnd = -Infinity, ends: number[] = [];
  const finish = () => { for (const s of group) s.columns = ends.length; };
  for (const segment of result) {
    if (segment.start >= groupEnd) { finish(); group = []; ends = []; groupEnd = -Infinity; }
    let col = ends.findIndex(end => end <= segment.start);
    if (col === -1) col = ends.length;
    ends[col] = segment.end;
    segment.column = col;
    group.push(segment);
    groupEnd = Math.max(groupEnd, segment.end);
  }
  finish();
  return result;
}
export function validateSettings(value: Partial<Settings>): Settings {
  const start = Number(value.startMinute), end = Number(value.endMinute);
  const validRange = Number.isInteger(start) && Number.isInteger(end) &&
    start >= 0 && start < 1440 && start % 30 === 0 && end % 30 === 0 && end > start && end - start <= 1440;
  return {
    ...defaults,
    startMinute: validRange ? start : defaults.startMinute,
    endMinute: validRange ? end : defaults.endMinute,
    weekStartsOn: value.weekStartsOn === 0 ? 0 : 1,
    showWeekends: value.showWeekends !== false,
    view: ['day', 'week', 'month'].includes(value.view ?? '') ? value.view! : 'week',
    selectedCalendars: Array.isArray(value.selectedCalendars) ? value.selectedCalendars.filter(x => typeof x === 'string') : [],
    clientId: typeof value.clientId === 'string' ? value.clientId : '',
  };
}
export function readSettings(): Settings {
  try { return validateSettings(JSON.parse(localStorage.getItem('calendar95.settings') || '{}')); }
  catch { return { ...defaults }; }
}
