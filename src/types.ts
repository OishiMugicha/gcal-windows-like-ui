export type View = 'day' | 'week' | 'month';
export interface Settings {
  startMinute: number;
  endMinute: number;
  weekStartsOn: 0 | 1;
  showWeekends: boolean;
  view: View;
  selectedCalendars: string[];
  clientId: string;
}
export interface Calendar {
  id: string;
  title: string;
  color: string;
  writable: boolean;
  primary?: boolean;
}
interface EventBase {
  id: string;
  calendarId: string;
  title: string;
  description?: string;
  location?: string;
  color?: string;
  recurring?: boolean;
  htmlLink?: string;
  etag?: string;
}
export type CalendarEvent = EventBase & (
  { allDay: false; start: string; end: string } |
  { allDay: true; startDate: string; endDate: string }
);
export type EventDraft = Omit<EventBase, 'id'> & {
  id?: string;
  allDay: boolean;
  startDate: string;
  endDate: string;
  startTime: string;
  endTime: string;
};
