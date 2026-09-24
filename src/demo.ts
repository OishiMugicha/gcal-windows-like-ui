import { addDays, atMinute, dateKey, weekday } from './calendar';
import type { Calendar, CalendarEvent } from './types';
export const demoCalendars: Calendar[] = [
  { id: 'sample-work', title: '仕事', color: '#3159a6', writable: true, primary: true },
  { id: 'sample-personal', title: '個人', color: '#34816b', writable: true },
];
export function demoEvents(anchor = dateKey()): CalendarEvent[] {
  const monday = addDays(anchor, -((weekday(anchor) + 6) % 7));
  const timed = (id: string, offset: number, start: number, end: number, title: string, personal = false): CalendarEvent => ({
    id, calendarId: personal ? 'sample-personal' : 'sample-work', title, allDay: false,
    start: new Date(atMinute(addDays(monday, offset), start)).toISOString(),
    end: new Date(atMinute(addDays(monday, offset), end)).toISOString(),
  });
  return [
    timed('demo-1', 0, 540, 615, '週間プランニング'),
    timed('demo-2', 0, 840, 960, '制作の時間'),
    timed('demo-3', 1, 600, 690, 'プロジェクト定例'),
    timed('demo-4', 1, 1080, 1140, '散歩', true),
    timed('demo-5', 2, 540, 720, '集中作業'),
    timed('demo-6', 2, 630, 690, 'デザインレビュー'),
    timed('demo-7', 3, 780, 900, '資料をまとめる'),
    timed('demo-8', 4, 600, 660, '進捗の確認'),
    timed('demo-9', 4, 1170, 1290, '映画', true),
    timed('demo-10', 5, 660, 780, 'ランチ', true),
    timed('demo-11', 6, 900, 990, '来週の準備', true),
    timed('demo-12', 0, 1470, 1530, '読書', true),
    { id: 'demo-all', calendarId: 'sample-personal', title: 'サンプルの予定', allDay: true,
      startDate: monday, endDate: addDays(monday, 1) },
  ];
}
