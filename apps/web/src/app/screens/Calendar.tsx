import { Button, Note, Presence, Segmented, Swap, useMedia } from '@qubite/ui';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { say, usePlatform } from '../../auth/client';
import { useCalendar } from '../calendar';
import {
  CALENDAR_MODES,
  HOUR_HEIGHT,
  KIND_COLOR,
  KIND_LABEL,
  calendarDay,
  calendarTime,
  dateWindow,
  itemKey,
  itemsOnDay,
  layoutBlocks,
  nowPosition,
  periodLabel,
  shiftPeriod,
  shortDayLabel,
  type CalendarItem,
  type CalendarMode,
} from '../calendar-view';
import '../calendar.css';

const KINDS = ['event', 'task', 'lesson'] as const;
const WEEKDAYS = ['пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс'];

/** Часовой пояс приходит из того же состояния платформы, что у остальных экранов. */
export function CalendarScreen() {
  const platform = usePlatform();
  if (!platform.data) {
    return platform.isError ? (
      <Note tone="bad">
        {say(platform.error)}{' '}
        <Button size="sm" onClick={() => void platform.refetch()}>
          Повторить
        </Button>
      </Note>
    ) : (
      <Note>Загружаем календарь…</Note>
    );
  }
  return <Calendar key={platform.data.timezone} timeZone={platform.data.timezone} />;
}

function Calendar({ timeZone }: { timeZone: string }) {
  const [now, setNow] = useState(Date.now);
  const today = calendarDay(now, timeZone);
  const [anchor, setAnchor] = useState(today);
  const [mode, setMode] = useState<CalendarMode>('week');
  const narrow = useMedia('(max-width: 599px)');
  const weekDays = narrow ? 3 : 7;
  const window = useMemo(
    () => dateWindow(mode, anchor, timeZone, weekDays),
    [mode, anchor, timeZone, weekDays],
  );
  const calendar = useCalendar(window);
  const items = calendar.data ?? [];

  useEffect(() => {
    const tick = () => setNow(Date.now());
    const timer = setInterval(tick, 60_000);
    // После сна телефона сразу возвращаем линию к текущему времени.
    globalThis.addEventListener('focus', tick);
    document.addEventListener('visibilitychange', tick);
    return () => {
      clearInterval(timer);
      globalThis.removeEventListener('focus', tick);
      document.removeEventListener('visibilitychange', tick);
    };
  }, []);

  function openDay(day: string) {
    setAnchor(day);
    setMode('day');
  }

  return (
    <section className="calendar" aria-label="Календарь">
      <Segmented<CalendarMode>
        label="Вид календаря"
        value={mode}
        onChange={setMode}
        options={[
          { value: 'day', label: 'День' },
          { value: 'week', label: 'Неделя' },
          { value: 'month', label: 'Месяц' },
        ]}
      />
      <div className="calendar-toolbar">
        <p className="calendar-period" aria-live="polite" aria-atomic="true">
          {periodLabel(mode, anchor, window.days)}
        </p>
        <div className="calendar-actions" role="group" aria-label="Выбрать период">
          <Button
            size="sm"
            dot={false}
            onClick={() => setAnchor(shiftPeriod(mode, anchor, -1, weekDays))}
          >
            Назад
          </Button>
          <Button size="sm" onClick={() => setAnchor(calendarDay(Date.now(), timeZone))}>
            Сегодня
          </Button>
          <Button
            size="sm"
            dot={false}
            onClick={() => setAnchor(shiftPeriod(mode, anchor, 1, weekDays))}
          >
            Вперёд
          </Button>
        </div>
      </div>
      <div className="calendar-legend" aria-label="Виды записей">
        {KINDS.map((kind) => (
          <span key={kind}>
            <i className="q-dot" style={{ background: `var(--q-${KIND_COLOR[kind]})` }} />
            {KIND_LABEL[kind]}
          </span>
        ))}
        <span className="calendar-zone">{timeZone}</span>
      </div>
      <Presence show={calendar.isPending}>
        <Note>Загружаем записи…</Note>
      </Presence>
      <Presence show={calendar.isError}>
        <Note tone="bad">
          {say(calendar.error)}{' '}
          <Button size="sm" onClick={() => void calendar.refetch()}>
            Повторить
          </Button>
        </Note>
      </Presence>
      <Presence show={calendar.isSuccess && items.length === 0}>
        <p className="calendar-empty">В этом периоде записей нет.</p>
      </Presence>
      <Swap view={mode} order={CALENDAR_MODES}>
        {mode === 'month' ? (
          <Month
            days={window.days}
            anchor={anchor}
            today={today}
            items={items}
            timeZone={timeZone}
            onDay={openDay}
          />
        ) : (
          <Timeline
            key={`${mode}:${window.from}:${weekDays}`}
            days={window.days}
            items={items}
            timeZone={timeZone}
            now={now}
          />
        )}
      </Swap>
    </section>
  );
}

function description(item: CalendarItem, timeZone: string): string {
  const time = item.all_day
    ? 'весь день'
    : item.starts_at === item.ends_at
      ? calendarTime(item.starts_at, timeZone)
      : `${calendarTime(item.starts_at, timeZone)}–${calendarTime(item.ends_at, timeZone)}`;
  return `${KIND_LABEL[item.kind]}: ${item.title}, ${time}${item.place ? `, ${item.place}` : ''}`;
}

function Timeline({
  days,
  items,
  timeZone,
  now,
}: {
  days: string[];
  items: CalendarItem[];
  timeZone: string;
  now: number;
}) {
  const scroll = useRef<HTMLDivElement>(null);
  const initialNow = useRef(now);
  const columns = useMemo(
    () =>
      days.map((day) => ({
        day,
        allDay: itemsOnDay(items, day, timeZone).filter((item) => item.all_day),
        blocks: layoutBlocks(items, day, timeZone),
      })),
    [days, items, timeZone],
  );

  useLayoutEffect(() => {
    const el = scroll.current;
    if (!el) return;
    const day = calendarDay(initialNow.current, timeZone);
    const position = nowPosition(day, initialNow.current, timeZone)!;
    el.scrollTop = Math.max(0, position - el.clientHeight / 3);
  }, [timeZone]);

  return (
    <div className="calendar-timeline" style={{ '--calendar-days': days.length } as CSSProperties}>
      <div className="calendar-day-heads">
        <span aria-hidden="true" />
        {days.map((day) => (
          <div key={day} className={calendarDay(now, timeZone) === day ? 'is-today' : undefined}>
            <time dateTime={day}>{shortDayLabel(day)}</time>
          </div>
        ))}
      </div>
      <div className="calendar-all-day" aria-label="Записи на весь день">
        <span className="calendar-all-label">весь день</span>
        {columns.map(({ day, allDay }) => (
          <div className="calendar-all-items" key={day}>
            {allDay.map((item) => (
              <article
                key={itemKey(item)}
                className="calendar-all-item"
                style={{ '--calendar-color': `var(--q-${KIND_COLOR[item.kind]})` } as CSSProperties}
                aria-label={description(item, timeZone)}
                title={description(item, timeZone)}
                tabIndex={0}
              >
                {item.title}
              </article>
            ))}
          </div>
        ))}
      </div>
      <div
        className="calendar-scroll"
        ref={scroll}
        tabIndex={0}
        role="region"
        aria-label="Шкала времени от 00 до 24 часов"
      >
        <div className="calendar-hours-grid">
          <div className="calendar-hours" aria-hidden="true">
            {Array.from({ length: 25 }, (_, hour) => (
              <span key={hour} style={{ transform: `translateY(${hour * HOUR_HEIGHT}px)` }}>
                {String(hour).padStart(2, '0')}:00
              </span>
            ))}
          </div>
          {columns.map(({ day, blocks }) => {
            const position = nowPosition(day, now, timeZone);
            return (
              <div className="calendar-day-track" key={day} aria-label={shortDayLabel(day)}>
                {Array.from({ length: 24 }, (_, hour) => (
                  <div className="calendar-hour-row" key={hour} aria-hidden="true" />
                ))}
                {blocks.map((block) => (
                  <article
                    key={itemKey(block.item)}
                    className="calendar-block"
                    style={
                      {
                        '--calendar-color': `var(--q-${KIND_COLOR[block.item.kind]})`,
                        transform: `translateY(${block.top}px)`,
                        height: block.height,
                        left: `${(block.column / block.columns) * 100}%`,
                        width: `${100 / block.columns}%`,
                      } as CSSProperties
                    }
                    aria-label={description(block.item, timeZone)}
                    title={description(block.item, timeZone)}
                    tabIndex={0}
                  >
                    <time>{calendarTime(block.item.starts_at, timeZone)}</time>
                    <span>{block.item.title}</span>
                    {block.item.place && <small>{block.item.place}</small>}
                  </article>
                ))}
                {position !== null && (
                  <div
                    className="calendar-now"
                    style={{ transform: `translateY(${position}px)` }}
                    role="img"
                    aria-label={`Сейчас ${calendarTime(now, timeZone)}`}
                  >
                    {Array.from({ length: 60 }, (_, i) => (
                      <i key={i} />
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function Month({
  days,
  anchor,
  today,
  items,
  timeZone,
  onDay,
}: {
  days: string[];
  anchor: string;
  today: string;
  items: CalendarItem[];
  timeZone: string;
  onDay: (day: string) => void;
}) {
  const cells = useMemo(
    () => days.map((day) => ({ day, items: itemsOnDay(items, day, timeZone) })),
    [days, items, timeZone],
  );
  return (
    <div className="calendar-month" role="group" aria-label="Дни месяца">
      {WEEKDAYS.map((day) => (
        <span className="calendar-weekday" key={day} aria-hidden="true">
          {day}
        </span>
      ))}
      {cells.map(({ day, items: own }) => {
        const counts = KINDS.map((kind) => ({
          kind,
          count: own.filter((item) => item.kind === kind).length,
        }));
        const label = `${periodLabel('day', day, [day])}${
          day === today ? ', сегодня' : ''
        }. ${counts.map(({ kind, count }) => `${KIND_LABEL[kind]}: ${count}`).join(', ')}`;
        return (
          <Button
            key={day}
            dot={false}
            className={[
              'calendar-month-day',
              day.slice(0, 7) !== anchor.slice(0, 7) && 'other-month',
              day === today && 'is-today',
            ]
              .filter(Boolean)
              .join(' ')}
            aria-label={label}
            aria-current={day === today ? 'date' : undefined}
            title={label}
            onClick={() => onDay(day)}
          >
            <time dateTime={day}>{Number(day.slice(8))}</time>
            <span className="calendar-month-dots" aria-hidden="true">
              {counts
                .filter(({ count }) => count > 0)
                .map(({ kind }) => (
                  <i
                    key={kind}
                    className="q-dot"
                    style={{ background: `var(--q-${KIND_COLOR[kind]})` }}
                  />
                ))}
            </span>
          </Button>
        );
      })}
    </div>
  );
}
