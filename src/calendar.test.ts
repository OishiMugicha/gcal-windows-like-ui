import { describe, expect, it } from 'vitest';
import { addDays, atMinute, defaultCalendar, defaults, isOnDay, layoutEvents, rangeFor, timeLabel, validateSettings, visibleDays, startOfWeek, consecutiveDays } from './calendar';
import type { CalendarEvent } from './types';
const event = (id: string, start: number, end: number): CalendarEvent => ({ id, title: id, calendarId: 'test', allDay: false,
  start: new Date(atMinute('2026-09-21', start)).toISOString(), end: new Date(atMinute('2026-09-21', end)).toISOString() });
describe('overnight view', () => {
  it('places Tuesday 01:00 in Monday and keeps its real date', () => {
    const e = event('night', 1500, 1530);
    const [segment] = layoutEvents([e], '2026-09-21', defaults);
    expect(segment.top).toBeCloseTo(94.444);
    expect(layoutEvents([e], '2026-09-22', defaults)).toEqual([]);
    expect(timeLabel(1500)).toBe('01:00');
    expect(e.allDay ? '' : e.start).toBe('2026-09-21T16:00:00.000Z');
  });
  it('clips boundaries and excludes events exactly outside the interval', () => {
    const result = layoutEvents([event('early', 420, 510), event('late', 1530, 1590), event('before', 300, 480), event('after', 1560, 1620)], '2026-09-21', defaults);
    expect(result.map(s => s.event.id)).toEqual(['early', 'late']);
    expect(result[0].clippedStart).toBe(true); expect(result[0].top).toBe(0);
    expect(result[1].clippedEnd).toBe(true); expect(result[1].top + result[1].height).toBeCloseTo(100);
  });
  it('packs overlapping events and reuses a lane at exact end times', () => {
    const result = layoutEvents([event('a', 540, 660), event('b', 600, 630), event('c', 630, 700), event('d', 720, 750)], '2026-09-21', defaults);
    expect(result.slice(0, 3).map(s => s.columns)).toEqual([2, 2, 2]);
    expect(result[1].column).toBe(result[2].column);
    expect(result[3].columns).toBe(1);
  });
  it('fetches the last column through the next day', () => {
    const range = rangeFor(visibleDays('2026-09-24', defaults), defaults);
    expect(range.end).toBe('2026-09-27T17:00:00.000Z');
  });
});
describe('civil dates and settings', () => {
  it('uses exclusive end dates for all-day events', () => {
    const e: CalendarEvent = { id: 'a', title: '', calendarId: '', allDay: true, startDate: '2026-09-21', endDate: '2026-09-23' };
    expect(isOnDay(e, '2026-09-22')).toBe(true);
    expect(isOnDay(e, '2026-09-23')).toBe(false);
  });
  it('handles month/year boundaries and always includes weekends', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(visibleDays('2026-09-27', defaults)).toEqual(consecutiveDays('2026-09-21'));
    expect(visibleDays('2026-09-24', { ...defaults, view: 'month' })).toHaveLength(42);
  });
  it('rejects invalid stored time ranges and accepts a full 24 hours', () => {
    expect(validateSettings({ startMinute: 600, endMinute: 600 }).endMinute).toBe(1560);
    expect(validateSettings({ startMinute: 480, endMinute: 1950 }).endMinute).toBe(1560);
    expect(validateSettings({ startMinute: 480, endMinute: 1920 }).endMinute).toBe(1920);
    expect(validateSettings({ startMinute: 0, endMinute: 1440 }).startMinute).toBe(0);
  });
});

describe('default calendar', () => {
  const calendars = [
    { id: 'read', title: 'Read', color: '', writable: false },
    { id: 'a', title: 'A', color: '', writable: true },
    { id: 'b', title: 'B', color: '', writable: true },
  ];
  it('validates old and malformed settings without discarding a saved ID', () => {
    expect(validateSettings({}).defaultCalendarId).toBe('');
    expect(validateSettings({ defaultCalendarId: 42 as unknown as string }).defaultCalendarId).toBe('');
    expect(validateSettings({ defaultCalendarId: 'missing' }).defaultCalendarId).toBe('missing');
  });
  it('prefers the configured writable calendar even when hidden', () => {
    expect(defaultCalendar(calendars, ['a'], 'b')?.id).toBe('b');
  });
  it('falls back for missing or read-only preferences and empty selections', () => {
    for (const id of ['', 'missing', 'read']) expect(defaultCalendar(calendars, ['b'], id)?.id).toBe('b');
    expect(defaultCalendar(calendars, [], '')?.id).toBe('a');
    expect(defaultCalendar(calendars.slice(0, 1), ['read'], 'read')).toBeUndefined();
  });
});


describe('rolling week', () => {
  it('shows Wednesday through Tuesday and includes the final overnight hours', () => {
    const days = consecutiveDays('2026-09-23');
    expect(days).toEqual(['2026-09-23', '2026-09-24', '2026-09-25', '2026-09-26', '2026-09-27', '2026-09-28', '2026-09-29']);
    expect(rangeFor(days, defaults)).toEqual({ start: '2026-09-22T15:00:00.000Z', end: '2026-09-29T17:00:00.000Z' });
  });
  it('aligns explicit resets to the configured weekday', () => {
    expect(startOfWeek('2026-09-24', 0)).toBe('2026-09-20');
    expect(startOfWeek('2026-09-24', 1)).toBe('2026-09-21');
  });
  it('crosses years and leap days without skipping dates', () => {
    expect(consecutiveDays('2026-12-30').at(-1)).toBe('2027-01-05');
    expect(consecutiveDays('2028-02-28').slice(0, 3)).toEqual(['2028-02-28', '2028-02-29', '2028-03-01']);
  });
  it('drops the obsolete weekend preference from saved settings', () => {
    const settings = validateSettings(JSON.parse('{"showWeekends":false,"weekStartsOn":0}'));
    expect(settings).not.toHaveProperty('showWeekends');
    expect(visibleDays('2026-09-24', settings)).toHaveLength(7);
  });
});
