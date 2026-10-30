import { loop, MASS } from '@qubite/motion';
import { patchTask, plannerData } from '@qubite/sync-client';
import { Button, Note, Presence, Segmented, Swap, useMedia, useSpring } from '@qubite/ui';
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { Fail, say, usePlatform } from '../../auth/client';
import { useCalendar, useCalendarEvents } from '../calendar';
import { CalendarEventSheet, type CalendarSelection } from '../CalendarEventSheet';
import { usePlanner } from '../planner-context';
import { useSync } from '../sync-context';
import {
  CALENDAR_MODES,
  HOUR_HEIGHT,
  KIND_COLOR,
  KIND_LABEL,
  addDays,
  localInstant,
  minuteTime,
  moveTimes,
  snapMinute,
  calendarDay,
  calendarTime,
  dateWindow,
  itemKey,
  intersects,
  itemsOnDay,
  layoutBlocks,
  nowPosition,
  periodLabel,
  shiftPeriod,
  shortDayLabel,
  type CalendarBlock,
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
  const events = useCalendarEvents();
  const planner = usePlanner();
  const sync = useSync();
  const [selection, setSelection] = useState<CalendarSelection | null>(null);
  const serial = useRef(0);
  const moving = useRef(false);
  const [notice, setNotice] = useState<{
    text: string;
    bad?: boolean;
    undo?: () => Promise<void>;
  } | null>(null);
  const [undoing, setUndoing] = useState(false);
  // Дела берём из того же локального хранилища, что Planner: перенос виден и без сети.
  const items = useMemo(() => {
    const localIds = new Set(planner.data.tasks.map((task) => task.id));
    const result = (calendar.data ?? []).filter(
      (item) => item.kind !== 'task' || !localIds.has(item.source_id),
    );
    for (const task of planner.data.tasks) {
      if (!task.due_date) continue;
      const start = localInstant(task.due_date, task.due_time ?? '00:00', timeZone);
      result.push({
        kind: 'task',
        source_id: task.id,
        title: task.title,
        place: '',
        all_day: !task.due_time,
        starts_at: start,
        ends_at: task.due_time ? start : localInstant(addDays(task.due_date, 1), '00:00', timeZone),
      });
    }
    return result.filter((item) => intersects(item, window.from, window.to));
  }, [calendar.data, planner.data.tasks, timeZone, window.from, window.to]);

  function create(day: string, minute = 540, allDay = false) {
    setSelection({ key: ++serial.current, day, minute, allDay });
  }

  function openItem(item: CalendarItem) {
    if (item.kind === 'lesson') {
      setNotice({ text: 'Правится в расписании' });
      return;
    }
    if (item.kind !== 'event' || moving.current) return;
    setSelection({
      key: ++serial.current,
      day: calendarDay(item.starts_at, timeZone),
      minute: 540,
      id: item.source_id,
      event: events.known(item.source_id),
    });
  }

  async function move(item: CalendarItem, times: MoveTarget): Promise<boolean> {
    if (moving.current || item.kind === 'lesson') return false;
    if (times.starts_at === item.starts_at) return false;
    moving.current = true;
    setNotice(null);
    try {
      if (item.kind === 'event') {
        const event = events.known(item.source_id);
        if (!event) {
          setNotice({
            bad: true,
            text: 'Перенос недоступен: не удалось получить полные данные события для безопасной правки.',
          });
          return false;
        }
        const delta = times.starts_at - item.starts_at;
        const saved = await events.patch(event, {
          starts_at: event.starts_at + delta,
          ends_at: event.ends_at + delta,
        });
        // API не возвращает action/batch для useRevert; откат — PATCH с новой revision.
        setNotice({
          text: event.recurrence ? 'Перенесена вся серия.' : 'Событие перенесено.',
          undo: async () => {
            await events.patch(saved, { starts_at: event.starts_at, ends_at: event.ends_at });
          },
        });
      } else {
        const client = await sync.ready();
        const task = (await plannerData(client)).tasks.find((value) => value.id === item.source_id);
        if (!task) throw new Error('Дело не найдено на устройстве');
        const patch = {
          due_date: calendarDay(times.starts_at, timeZone),
          due_time: calendarTime(times.starts_at, timeZone),
        };
        await patchTask(client, task.id, patch);
        void client
          .sync()
          .then(() => events.refresh())
          .catch(() => {});
        setNotice({
          text: 'Срок сохранён на устройстве и отправится при связи.',
          undo: async () => {
            const current = (await plannerData(client)).tasks.find((value) => value.id === task.id);
            if (
              !current ||
              current.due_date !== patch.due_date ||
              current.due_time !== patch.due_time
            ) {
              throw new Error('Дело уже изменили — отмена недоступна');
            }
            await patchTask(client, task.id, { due_date: task.due_date, due_time: task.due_time });
            void client
              .sync()
              .then(() => events.refresh())
              .catch(() => {});
          },
        });
      }
      return true;
    } catch (error) {
      setNotice({
        bad: true,
        text:
          error instanceof Fail && error.status === 409
            ? 'Событие уже изменили — перечитано. Шкала обновлена; повторная правка требует полной записи.'
            : error instanceof Error && !(error instanceof Fail)
              ? error.message
              : say(error),
      });
      return false;
    } finally {
      moving.current = false;
    }
  }

  async function undo() {
    if (!notice?.undo || undoing || moving.current) return;
    moving.current = true;
    setUndoing(true);
    try {
      await notice.undo();
      setNotice({ text: 'Перенос отменён.' });
    } catch (error) {
      setNotice({
        bad: true,
        text: error instanceof Error && !(error instanceof Fail) ? error.message : say(error),
      });
    } finally {
      moving.current = false;
      setUndoing(false);
    }
  }

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
        <Button variant="fill" onClick={() => create(anchor)}>
          Новое событие
        </Button>
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
      <Presence show={notice !== null}>
        <Note tone={notice?.bad ? 'bad' : undefined}>
          {notice?.text}
          {notice?.undo && (
            <Button size="sm" disabled={undoing} onClick={() => void undo()}>
              Отменить
            </Button>
          )}
        </Note>
      </Presence>
      <CalendarEventSheet
        selection={selection}
        timeZone={timeZone}
        onClose={() => setSelection(null)}
      />
      <Swap view={mode} order={CALENDAR_MODES}>
        {mode === 'month' ? (
          <Month
            days={window.days}
            anchor={anchor}
            today={today}
            items={items}
            timeZone={timeZone}
            onDay={openDay}
            onCreate={create}
          />
        ) : (
          <Timeline
            key={`${mode}:${window.from}:${weekDays}`}
            days={window.days}
            items={items}
            timeZone={timeZone}
            now={now}
            onCreate={create}
            onItem={openItem}
            onMove={move}
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
  onCreate,
  onItem,
  onMove,
}: {
  days: string[];
  items: CalendarItem[];
  timeZone: string;
  now: number;
  onCreate: (day: string, minute: number, allDay?: boolean) => void;
  onItem: (item: CalendarItem) => void;
  onMove: (item: CalendarItem, times: MoveTarget) => Promise<boolean>;
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
              <Button
                dot={false}
                onClick={() => onItem(item)}
                key={itemKey(item)}
                className="calendar-all-item"
                style={{ '--calendar-color': `var(--q-${KIND_COLOR[item.kind]})` } as CSSProperties}
                aria-label={description(item, timeZone)}
                title={description(item, timeZone)}
                tabIndex={0}
              >
                {item.title}
              </Button>
            ))}
            <Button
              dot={false}
              size="sm"
              className="calendar-add-day"
              aria-label={`Новое событие на весь день: ${shortDayLabel(day)}`}
              onClick={() => onCreate(day, 0, true)}
            >
              Добавить
            </Button>
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
              <div
                className="calendar-day-track"
                key={day}
                data-calendar-day={day}
                aria-label={shortDayLabel(day)}
              >
                {Array.from({ length: 24 }, (_, hour) => (
                  <Button
                    className="calendar-hour-row"
                    key={hour}
                    dot={false}
                    aria-label={`Новое событие: ${shortDayLabel(day)}, ${minuteTime(hour * 60)}`}
                    onClick={() => onCreate(day, hour * 60)}
                  >
                    {''}
                  </Button>
                ))}
                {blocks.map((block) => (
                  <TimedBlock
                    key={itemKey(block.item)}
                    block={block}
                    day={day}
                    days={days}
                    timeZone={timeZone}
                    onItem={onItem}
                    onMove={onMove}
                  />
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
  onCreate,
}: {
  days: string[];
  anchor: string;
  today: string;
  items: CalendarItem[];
  timeZone: string;
  onDay: (day: string) => void;
  onCreate: (day: string) => void;
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
            onClick={() => (own.length === 0 ? onCreate(day) : onDay(day))}
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

type MoveTarget = { starts_at: number; ends_at: number };

/** Положение блока во время жеста меняется только transform, без React на каждом кадре. */
function TimedBlock({
  block,
  day,
  days,
  timeZone,
  onItem,
  onMove,
}: {
  block: CalendarBlock;
  day: string;
  days: string[];
  timeZone: string;
  onItem: (item: CalendarItem) => void;
  onMove: (item: CalendarItem, times: MoveTarget) => Promise<boolean>;
}) {
  const el = useRef<HTMLDivElement>(null);
  const cleanup = useRef<(() => void) | null>(null);
  const muted = useRef(false);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const draw = () => {
    if (el.current) el.current.style.transform = `translate(${x.x}px, ${block.top + y.x}px)`;
  };
  const x = useSpring(0, MASS.row, draw);
  const y = useSpring(0, MASS.row, draw);
  const home = () => {
    loop().to(x, 0);
    loop().to(y, 0);
  };
  useEffect(() => () => cleanup.current?.(), []);

  async function save(times: MoveTarget) {
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    try {
      await onMove(block.item, times);
    } finally {
      savingRef.current = false;
      setSaving(false);
      home();
    }
  }

  function down(e: ReactPointerEvent<HTMLDivElement>) {
    if (block.item.kind === 'lesson' || e.button !== 0 || !e.isPrimary) return;
    // У Button есть собственный короткий жест нажатия; шкалу ведёт этот внешний блок.
    e.stopPropagation();
    if (savingRef.current || cleanup.current) return;
    muted.current = false;
    const element = e.currentTarget;
    const grid = element.closest('.calendar-hours-grid');
    const tracks = [...(grid?.querySelectorAll<HTMLElement>('[data-calendar-day]') ?? [])].map(
      (track) => ({
        day: track.dataset.calendarDay!,
        rect: track.getBoundingClientRect(),
      }),
    );
    const own = tracks.find((track) => track.day === day);
    if (!own) return;
    const pointer = e.pointerId;
    const startX = e.clientX;
    const startY = e.clientY;
    let moving = false;
    let ended = false;
    let target: MoveTarget | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const arm = () => {
      moving = true;
      muted.current = true;
      element.classList.add('is-dragging');
      getSelection()?.removeAllRanges();
      try {
        element.setPointerCapture(pointer);
      } catch {
        /* указатель мог уже уйти */
      }
    };
    const stop = () => {
      clearTimeout(timer);
      globalThis.removeEventListener('pointermove', move);
      globalThis.removeEventListener('pointerup', end);
      globalThis.removeEventListener('pointercancel', cancel);
      globalThis.removeEventListener('blur', cancel);
      globalThis.removeEventListener('keydown', key);
      globalThis.removeEventListener('touchmove', touch);
      globalThis.removeEventListener('scroll', cancel, true);
      element.classList.remove('is-dragging');
      try {
        if (element.hasPointerCapture(pointer)) element.releasePointerCapture(pointer);
      } catch {
        /* уже отпущен */
      }
      cleanup.current = null;
    };
    const cancel = () => {
      if (ended) return;
      ended = true;
      muted.current = true;
      stop();
      home();
    };
    const key = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        cancel();
      }
    };
    const touch = (event: TouchEvent) => {
      if (event.touches.length !== 1) {
        cancel();
        return;
      }
      // До удержания скролл свободен. После 250 мс первый touchmove уже отменяется.
      if (moving && event.cancelable) event.preventDefault();
    };
    const update = (event: globalThis.PointerEvent) => {
      const dx = event.clientX - startX;
      const dy = event.clientY - startY;
      const over = tracks.find(
        (track) => event.clientX >= track.rect.left && event.clientX < track.rect.right,
      );
      const minute = snapMinute(block.start + (dy * 60) / HOUR_HEIGHT);
      target =
        over && event.clientY >= own.rect.top && event.clientY <= own.rect.bottom
          ? moveTimes(block.item, day, block.start, over.day, minute, timeZone)
          : null;
      loop().set(x, over ? over.rect.left - own.rect.left : dx);
      loop().set(y, ((minute - block.start) * HOUR_HEIGHT) / 60);
    };
    const move = (event: globalThis.PointerEvent) => {
      if (event.pointerId !== pointer) return;
      if (!moving) {
        if (Math.hypot(event.clientX - startX, event.clientY - startY) < 6) return;
        if (e.pointerType === 'touch') {
          cancel();
          return;
        }
        arm();
      }
      update(event);
    };
    const end = (event: globalThis.PointerEvent) => {
      if (event.pointerId !== pointer || ended) return;
      ended = true;
      if (moving) update(event);
      stop();
      if (moving && target && target.starts_at !== block.item.starts_at) void save(target);
      else home();
    };
    if (e.pointerType === 'touch') timer = setTimeout(arm, 250);
    globalThis.addEventListener('pointermove', move);
    globalThis.addEventListener('pointerup', end);
    globalThis.addEventListener('pointercancel', cancel);
    globalThis.addEventListener('blur', cancel);
    globalThis.addEventListener('keydown', key);
    globalThis.addEventListener('touchmove', touch, { passive: false });
    globalThis.addEventListener('scroll', cancel, true);
    cleanup.current = cancel;
  }

  return (
    <div
      ref={el}
      className="calendar-block"
      data-kind={block.item.kind}
      style={
        {
          '--calendar-color': `var(--q-${KIND_COLOR[block.item.kind]})`,
          transform: `translateY(${block.top}px)`,
          height: block.height,
          left: `min(${(block.column / block.columns) * 100}%, calc(100% - 44px))`,
          width: `${100 / block.columns}%`,
        } as CSSProperties
      }
      onPointerDownCapture={down}
      onClickCapture={(e) => {
        if (muted.current && e.detail > 0) {
          e.preventDefault();
          e.stopPropagation();
        }
      }}
    >
      <Button
        dot={false}
        className="calendar-block-content"
        disabled={saving}
        aria-label={`${description(block.item, timeZone)}${block.item.kind !== 'lesson' ? '. Перенос: стрелки вверх/вниз на 15 минут, влево/вправо между днями' : '. Правится в расписании'}`}
        title={
          block.item.kind === 'lesson' ? 'Правится в расписании' : description(block.item, timeZone)
        }
        onClick={() => onItem(block.item)}
        onKeyDown={(e) => {
          if (block.item.kind === 'lesson' || saving || !e.key.startsWith('Arrow')) return;
          const index = days.indexOf(day);
          const targetDay =
            e.key === 'ArrowLeft'
              ? days[index - 1]
              : e.key === 'ArrowRight'
                ? days[index + 1]
                : day;
          if (!targetDay) return;
          e.preventDefault();
          const minute = snapMinute(
            block.start + (e.key === 'ArrowUp' ? -15 : e.key === 'ArrowDown' ? 15 : 0),
          );
          void save(moveTimes(block.item, day, block.start, targetDay, minute, timeZone));
        }}
      >
        <time>{calendarTime(block.item.starts_at, timeZone)}</time>
        <span>{block.item.title}</span>
        {block.item.place && <small>{block.item.place}</small>}
      </Button>
    </div>
  );
}
