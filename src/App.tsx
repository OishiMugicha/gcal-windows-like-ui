import { useState } from 'react';
import { addDays, dateKey, defaults, layoutEvents, timeLabel, timeOf, visibleDays, weekday } from './calendar';
import { demoCalendars, demoEvents } from './demo';
const weekdays = ['日', '月', '火', '水', '木', '金', '土'];
export default function App() {
  const [anchor, setAnchor] = useState(dateKey());
  const days = visibleDays(anchor, defaults), events = demoEvents();
  return <main className="app-window">
    <header className="titlebar"><img src="/favicon.svg" alt="" /><strong>Calendar 95</strong><span>Google Calendar</span></header>
    <nav className="toolbar" aria-label="カレンダー操作">
      <button onClick={() => setAnchor(addDays(anchor, -7))} aria-label="前の週">◀</button>
      <button onClick={() => setAnchor(dateKey())}>今日</button>
      <button onClick={() => setAnchor(addDays(anchor, 7))} aria-label="次の週">▶</button>
      <h1>{days[0].replaceAll('-', '.')} — {days[6].slice(5).replace('-', '.')}</h1>
      <button>日</button><button className="pressed">週</button><button>月</button>
      <span className="toolbar-divider" /><button>＋ 予定</button><button>設定</button><button>Googleに接続</button>
    </nav>
    <section className="calendar-surface">
      <div className="date-head" style={{ gridTemplateColumns: '58px repeat(7, minmax(0, 1fr))' }}>
        <span className="zone-label">JST</span>{days.map(day => <div key={day} className={'day-heading ' + (day === dateKey() ? 'today' : '')}>
          <span>{weekdays[weekday(day)]}</span><strong>{Number(day.slice(8))}</strong>
        </div>)}
      </div>
      <div className="all-day-row" style={{ gridTemplateColumns: '58px repeat(7, minmax(0, 1fr))' }}>
        <span className="zone-label">終日</span>{days.map(day => <div key={day} className="all-day-cell" />)}
      </div>
      <div className="time-grid" style={{ gridTemplateColumns: '58px repeat(7, minmax(0, 1fr))' }}>
        <div className="time-axis">{Array.from({ length: 19 }, (_, i) => <span key={i} style={{ top: i / 18 * 100 + '%' }}>{timeLabel(480 + i * 60)}</span>)}</div>
        {days.map(day => <div key={day} className={'day-column ' + (day === dateKey() ? 'today-column' : '')}>
          {Array.from({ length: 19 }, (_, i) => <div className="hour-line" key={i} style={{ top: i / 18 * 100 + '%' }} />)}
          {layoutEvents(events, day, defaults).map(s => <button key={s.event.id} className="event-block" style={{
            top: s.top + '%', height: s.height + '%', left: s.column / s.columns * 100 + '%',
            width: 100 / s.columns + '%', '--event-color': demoCalendars.find(c => c.id === s.event.calendarId)!.color,
          } as React.CSSProperties}><span className="event-time">{timeOf(s.event.start)} – {timeOf(s.event.end)}</span><strong>{s.event.title}</strong></button>)}
        </div>)}
      </div>
    </section>
    <footer className="statusbar"><span>サンプル表示</span><span>8:00 – 2:00 · 表示時間を固定</span><span>日本標準時</span></footer>
  </main>;
}
