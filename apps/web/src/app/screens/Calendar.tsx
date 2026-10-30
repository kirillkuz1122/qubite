import { loop, MASS } from '@qubite/motion';
import { patchTask, toTask } from '@qubite/sync-client';
import { Button, Note, Presence, Segmented, Swap, useMedia, useSpring } from '@qubite/ui';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { Fail, say, usePlatform } from '../../auth/client';
import { EVENT_READ_UNAVAILABLE, useCalendar, useCalendarEvents } from '../calendar';
import { CalendarEventSheet } from '../CalendarEventSheet';
import { usePlanner } from '../planner-context';
import { useSync } from '../sync-context';
import {
  CALENDAR_MODES,
  HOUR_HEIGHT,
  KIND_COLOR,
  KIND_LABEL,
  calendarDay,
  calendarTime,
  dateWindow,
  eventForm,
  eventMovePatch,
  intersects,
  itemKey,
  itemsOnDay,
  layoutBlocks,
  localInstant,
  moveCalendarItem,
  newEventForm,
  nowPosition,
  periodLabel,
  shiftPeriod,
  shortDayLabel,
  snapMinute,
  type CalendarBlock,
  type EventForm,
  type CalendarEvent,
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
  const [sheet, setSheet] = useState<{
    key: number;
    initial: EventForm;
    item?: CalendarItem;
    event?: CalendarEvent;
  } | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [notice, setNotice] = useState<{ text: string; bad?: boolean } | null>(null);
  const [undo, setUndo] = useState<(() => Promise<void>) | null>(null);
  const [moving, setMoving] = useState(false);
  const [activeTask, setActiveTask] = useState<string | null>(null);
  const locked = useRef(false);
  // Как в Planner: неподтверждённый срок виден сразу и не пропадает без сети.
  const items = useMemo(() => {
    const pending = planner.data.tasks.filter((task) => task.pending && task.id !== activeTask);
    const ids = new Set(pending.map((task) => task.id));
    const server = (calendar.data ?? []).filter(
      (item) => item.kind !== 'task' || !ids.has(item.source_id),
    );
    const local = pending.flatMap((task): CalendarItem[] => {
      if (!task.due_date || task.status === 'done') return [];
      const start = localInstant(task.due_date, task.due_time ?? '00:00', timeZone);
      const item: CalendarItem = {
        kind: 'task',
        source_id: task.id,
        title: task.title,
        place: '',
        starts_at: start,
        ends_at: task.due_time ? start : localInstant(task.due_date, '23:59', timeZone) + 60_000,
        all_day: !task.due_time,
      };
      return intersects(item, window.from, window.to) ? [item] : [];
    });
    return [...server, ...local];
  }, [calendar.data, planner.data.tasks, activeTask, timeZone, window.from, window.to]);

  useEffect(() => {
    void calendar.refetch();
    // Новые подтверждённые сроки приходят через существующую синхронизацию Planner.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sync.version]);

  function createAt(day: string, minute = 9 * 60, allDay = false) {
    if (locked.current) return;
    setSheet({ key: Date.now(), initial: newEventForm(day, minute, allDay) });
    setSheetOpen(true);
  }

  function openItem(item: CalendarItem) {
    if (locked.current) return;
    if (item.kind === 'lesson') {
      setNotice({ text: 'Правится в расписании' });
      return;
    }
    if (item.kind !== 'event') return;
    const event = events.known[item.source_id];
    setSheet({
      key: Date.now(),
      item,
      ...(event ? { event } : {}),
      initial: event
        ? eventForm(event, timeZone)
        : {
            ...newEventForm(calendarDay(item.starts_at, timeZone)),
            title: item.title,
            place: item.place,
            allDay: item.all_day,
            startTime: calendarTime(item.starts_at, timeZone),
            endDay: calendarDay(item.all_day ? item.ends_at - 1 : item.ends_at, timeZone),
            endTime: calendarTime(item.ends_at, timeZone),
          },
    });
    setSheetOpen(true);
  }

  async function failed(error: unknown, id?: string) {
    if (error instanceof Fail && error.status === 409) {
      if (id) events.forget(id);
      setSheet((current) => {
        if (!current || current.event?.id !== id) return current;
        const next = { ...current };
        delete next.event;
        return next;
      });
      await events.refresh();
      return 'Событие уже изменили — календарь перечитан. Для правки нужен запрос чтения полного события.';
    }
    return say(error);
  }

  async function moveItem(
    item: CalendarItem,
    fromDay: string,
    toDay: string,
    minuteDelta: number,
  ): Promise<boolean> {
    if (locked.current) return false;
    locked.current = true;
    setMoving(true);
    try {
      const moved = moveCalendarItem(item, fromDay, toDay, minuteDelta, timeZone);
      if (!Number.isFinite(moved.starts_at))
        throw new Fail('invalid', 'Это время не существует в выбранном часовом поясе', 400);
      if (moved.starts_at === item.starts_at) return false;
      setUndo(null);
      if (item.kind === 'event') {
        const event = events.known[item.source_id];
        if (!event) throw new Fail('unavailable', EVENT_READ_UNAVAILABLE, 0);
        const saved = await events.patch(event, eventMovePatch(event, item, moved));
        setUndo(() => async () => {
          try {
            await events.patch(saved, { starts_at: event.starts_at, ends_at: event.ends_at });
          } catch (error) {
            throw new Fail('calendar', await failed(error, event.id), 0);
          }
        });
        setNotice({ text: event.recurrence ? 'Вся серия перенесена' : 'Событие перенесено' });
      } else if (item.kind === 'task') {
        setActiveTask(item.source_id);
        const client = await sync.ready();
        const object = await client.get(item.source_id);
        if (!object || object.deleted)
          throw new Fail('not_found', 'Дело не найдено на устройстве', 404);
        const before = toTask(object);
        const next = {
          due_date: calendarDay(moved.starts_at, timeZone),
          due_time: calendarTime(moved.starts_at, timeZone),
        };
        const oldProblems = new Set((await client.problems()).map((problem) => problem.op.op_id));
        await patchTask(client, item.source_id, next);
        const state = await client.sync();
        const problem = (await client.problems()).find(
          (entry) => entry.op.object_id === item.source_id && !oldProblems.has(entry.op.op_id),
        );
        if (problem) {
          if (problem.result.status === 'rejected') {
            // Компенсирующая операция тем же путём Planner: не оставляем на устройстве
            // отклонённый сервером срок. Сама проблема остаётся видна в sync.
            await patchTask(client, item.source_id, {
              due_date: before.due_date,
              due_time: before.due_time,
            });
            void client.sync();
          }
          await events.refresh();
          throw new Fail(
            'task_conflict',
            'Срок не сохранён: сервер отклонил перенос или дело уже изменили',
            400,
          );
        }
        await events.refresh();
        setUndo(() => async () => {
          const current = await client.get(item.source_id);
          if (
            !current ||
            current.deleted ||
            current.fields?.due_date !== next.due_date ||
            current.fields?.due_time !== next.due_time
          )
            throw new Fail('task_conflict', 'Срок уже изменили — откат отменён', 400);
          const priorProblems = new Set((await client.problems()).map((p) => p.op.op_id));
          await patchTask(client, item.source_id, {
            due_date: before.due_date,
            due_time: before.due_time,
          });
          await client.sync();
          const rejected = (await client.problems()).find(
            (p) => p.op.object_id === item.source_id && !priorProblems.has(p.op.op_id),
          );
          if (rejected?.result.status === 'rejected') {
            await patchTask(client, item.source_id, next);
            void client.sync();
          }
          await events.refresh();
          if (rejected)
            throw new Fail('task_conflict', 'Срок уже изменили или сервер отклонил отмену', 400);
        });
        setNotice({
          text: state.pending
            ? 'Срок сохранён на устройстве, отправим при появлении связи'
            : 'Дело перенесено',
        });
      }
      return true;
    } catch (error) {
      setNotice({
        text: await failed(error, item.kind === 'event' ? item.source_id : undefined),
        bad: true,
      });
      return false;
    } finally {
      locked.current = false;
      setMoving(false);
      setActiveTask(null);
    }
  }

  async function revertMove() {
    if (!undo || locked.current) return;
    locked.current = true;
    setMoving(true);
    try {
      await undo();
      setUndo(null);
      setNotice({ text: 'Перенос отменён' });
    } catch (error) {
      setUndo(null);
      setNotice({ text: await failed(error), bad: true });
    } finally {
      locked.current = false;
      setMoving(false);
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
        <p className="calendar-period" aria-live="polite" aria-atomic="true">
          {periodLabel(mode, anchor, window.days)}
        </p>
        <div className="calendar-actions" role="group" aria-label="Выбрать период">
          <Button variant="fill" disabled={moving} onClick={() => createAt(anchor)}>
            Новое событие
          </Button>
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
      <Presence show={!!notice}>
        <Note tone={notice?.bad ? 'bad' : 'info'}>
          {notice?.text}{' '}
          {undo && (
            <Button size="sm" disabled={moving} onClick={() => void revertMove()}>
              Отменить
            </Button>
          )}
        </Note>
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
            onCreate={createAt}
            onOpen={openItem}
            onMove={moveItem}
            moving={moving}
          />
        )}
      </Swap>
      {sheet && (
        <CalendarEventSheet
          key={sheet.key}
          open={sheetOpen}
          initial={sheet.initial}
          existing={!!sheet.item}
          readable={!sheet.item || !!sheet.event}
          timeZone={timeZone}
          onClose={() => setSheetOpen(false)}
          onSave={async (body) => {
            setUndo(null);
            try {
              if (sheet.event) await events.patch(sheet.event, body);
              else if (!sheet.item) await events.create(body);
              else throw new Fail('unavailable', EVENT_READ_UNAVAILABLE, 0);
            } catch (error) {
              throw new Fail('calendar', await failed(error, sheet.item?.source_id), 0);
            }
          }}
          onDelete={async () => {
            if (sheet.item) {
              setUndo(null);
              await events.remove(sheet.item.source_id);
            }
          }}
        />
      )}
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
  onOpen,
  onMove,
  moving,
}: {
  days: string[];
  items: CalendarItem[];
  timeZone: string;
  now: number;
  onCreate: (day: string, minute?: number, allDay?: boolean) => void;
  onOpen: (item: CalendarItem) => void;
  onMove: (
    item: CalendarItem,
    fromDay: string,
    toDay: string,
    minuteDelta: number,
  ) => Promise<boolean>;
  moving: boolean;
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
            <Button
              className="calendar-all-create"
              dot={false}
              disabled={moving}
              aria-label={`Новое событие на весь день, ${shortDayLabel(day)}`}
              onClick={() => onCreate(day, 0, true)}
            >
              Создать
            </Button>
            {allDay.map((item) => (
              <Button
                key={itemKey(item)}
                className="calendar-all-item"
                style={{ '--calendar-color': `var(--q-${KIND_COLOR[item.kind]})` } as CSSProperties}
                aria-label={description(item, timeZone)}
                title={description(item, timeZone)}
                dot={false}
                onClick={() => onOpen(item)}
              >
                {item.title}
              </Button>
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
              <div
                className="calendar-day-track"
                key={day}
                data-day={day}
                aria-label={shortDayLabel(day)}
              >
                {Array.from({ length: 24 }, (_, hour) => (
                  <Button
                    className="calendar-hour-row"
                    key={hour}
                    dot={false}
                    disabled={moving}
                    aria-label={`Новое событие, ${shortDayLabel(day)}, ${String(hour).padStart(2, '0')}:00`}
                    onClick={(e) => {
                      const rect = e.currentTarget.getBoundingClientRect();
                      const minute =
                        e.detail === 0
                          ? hour * 60
                          : hour * 60 + ((e.clientY - rect.top) / HOUR_HEIGHT) * 60;
                      onCreate(day, snapMinute(minute));
                    }}
                  >
                    <span className="calendar-create-label">Создать</span>
                  </Button>
                ))}
                {blocks.map((block) => (
                  <EventBlock
                    key={itemKey(block.item)}
                    block={block}
                    day={day}
                    days={days}
                    timeZone={timeZone}
                    onOpen={onOpen}
                    onMove={onMove}
                    disabled={moving}
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

/** Двигается наружный блок; пружина Button остаётся внутри и не меняет геометрию шкалы. */
function EventBlock({
  block,
  day,
  days,
  timeZone,
  onOpen,
  onMove,
  disabled,
}: {
  block: CalendarBlock;
  day: string;
  days: string[];
  timeZone: string;
  onOpen: (item: CalendarItem) => void;
  onMove: (
    item: CalendarItem,
    fromDay: string,
    toDay: string,
    minuteDelta: number,
  ) => Promise<boolean>;
  disabled: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const muted = useRef(false);
  const latest = useRef({ block, onMove, disabled });
  useEffect(() => {
    latest.current = { block, onMove, disabled };
  });
  const pos = useRef({ x: 0, y: 0 });
  const draw = () => {
    if (ref.current)
      ref.current.style.transform = `translate(${pos.current.x}px, ${latest.current.block.top + pos.current.y}px)`;
  };
  const x = useSpring(0, MASS.row, (v) => {
    pos.current.x = v;
    draw();
  });
  const y = useSpring(0, MASS.row, (v) => {
    pos.current.y = v;
    draw();
  });

  useEffect(() => {
    const el = ref.current;
    const { item, start } = latest.current.block;
    if (!el || item.kind === 'lesson') return;
    const L = loop();
    let gesture: {
      id: number;
      touch: boolean;
      sx: number;
      sy: number;
      active: boolean;
      toDay: string | null;
      delta: number;
    } | null = null;
    let hold: ReturnType<typeof setTimeout> | undefined;
    let saving = false;
    let alive = true;
    const home = () => {
      L.to(x, 0);
      L.to(y, 0);
    };
    // Даже при размонтировании перенесённого блока поздний click не откроет час под ним.
    const muteClick = () => {
      muted.current = true;
      const suppress = (event: MouseEvent) => {
        if (!event.detail) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        removeEventListener('click', suppress, true);
      };
      addEventListener('click', suppress, true);
      setTimeout(() => removeEventListener('click', suppress, true), 500);
    };
    const unlisten = () => {
      clearTimeout(hold);
      removeEventListener('pointermove', pointerMove);
      removeEventListener('pointerup', pointerUp);
      removeEventListener('pointercancel', pointerCancel);
      removeEventListener('touchmove', touchMove);
      removeEventListener('touchend', touchEnd);
      removeEventListener('touchcancel', cancel);
      removeEventListener('keydown', key, true);
      removeEventListener('blur', cancel);
      removeEventListener('scroll', cancel, true);
      el.classList.remove('is-dragging');
    };
    const cancel = () => {
      if (!gesture) return;
      muteClick();
      gesture = null;
      unlisten();
      home();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        cancel();
      }
    };
    const update = (cx: number, cy: number, e: Event) => {
      const g = gesture;
      if (!g) return;
      const dx = cx - g.sx;
      const dy = cy - g.sy;
      if (!g.active) {
        if (Math.hypot(dx, dy) < 6) return;
        if (g.touch) {
          cancel();
          return;
        }
        g.active = true;
        muted.current = true;
      }
      if (e.cancelable) e.preventDefault();
      el.classList.add('is-dragging');
      const tracks = [
        ...(el
          .closest('.calendar-timeline')
          ?.querySelectorAll<HTMLElement>('.calendar-day-track') ?? []),
      ];
      const target = tracks.find((track) => {
        const r = track.getBoundingClientRect();
        return cx >= r.left && cx < r.right;
      });
      const viewport = el.closest('.calendar-scroll')?.getBoundingClientRect();
      g.toDay =
        viewport && cy >= viewport.top && cy <= viewport.bottom
          ? (target?.dataset.day ?? null)
          : null;
      const own = el.parentElement!.getBoundingClientRect();
      const targetRect = target?.getBoundingClientRect();
      const minute = snapMinute(start + (dy / HOUR_HEIGHT) * 60);
      g.delta = minute - start;
      L.hold(x, targetRect ? targetRect.left - own.left : dx);
      L.hold(y, (g.delta / 60) * HOUR_HEIGHT);
    };
    const end = () => {
      const g = gesture;
      gesture = null;
      unlisten();
      if (!g?.active) return;
      muteClick();
      if (!g.toDay || (g.toDay === day && g.delta === 0)) {
        home();
        return;
      }
      saving = true;
      el.classList.add('is-saving');
      void latest.current.onMove(item, day, g.toDay, g.delta).finally(() => {
        saving = false;
        if (alive) {
          el.classList.remove('is-saving');
          home();
        }
      });
    };
    const pointerMove = (e: PointerEvent) => {
      if (gesture && !gesture.touch && e.pointerId === gesture.id) update(e.clientX, e.clientY, e);
    };
    const pointerUp = (e: PointerEvent) => {
      if (gesture && !gesture.touch && e.pointerId === gesture.id) end();
    };
    const pointerCancel = (e: PointerEvent) => {
      if (gesture && !gesture.touch && e.pointerId === gesture.id) cancel();
    };
    const touchMove = (e: TouchEvent) => {
      if (e.touches.length !== 1) {
        cancel();
        return;
      }
      const touch = [...e.touches].find((t) => t.identifier === gesture?.id);
      if (touch) update(touch.clientX, touch.clientY, e);
    };
    const touchEnd = (e: TouchEvent) => {
      if (![...e.changedTouches].some((t) => t.identifier === gesture?.id)) return;
      if (gesture?.active && e.cancelable) e.preventDefault();
      end();
    };
    const begin = (id: number, cx: number, cy: number, touch: boolean) => {
      if (gesture || saving || latest.current.disabled) return;
      muted.current = false;
      gesture = { id, touch, sx: cx, sy: cy, active: false, toDay: day, delta: 0 };
      if (touch)
        hold = setTimeout(() => {
          if (!gesture) return;
          gesture.active = true;
          muted.current = true;
          el.classList.add('is-dragging');
        }, 250);
      addEventListener('pointermove', pointerMove, { passive: false });
      addEventListener('pointerup', pointerUp);
      addEventListener('pointercancel', pointerCancel);
      addEventListener('touchmove', touchMove, { passive: false });
      addEventListener('touchend', touchEnd, { passive: false });
      addEventListener('touchcancel', cancel);
      addEventListener('keydown', key, true);
      addEventListener('blur', cancel);
      addEventListener('scroll', cancel, true);
    };
    const down = (e: PointerEvent) => {
      if (e.pointerType !== 'touch' && e.button === 0)
        begin(e.pointerId, e.clientX, e.clientY, false);
    };
    const touchStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) {
        cancel();
        return;
      }
      const touch = e.touches[0]!;
      begin(touch.identifier, touch.clientX, touch.clientY, true);
    };
    const context = (e: Event) => {
      if (gesture) e.preventDefault();
    };
    el.addEventListener('pointerdown', down);
    el.addEventListener('touchstart', touchStart, { passive: true });
    el.addEventListener('contextmenu', context);
    return () => {
      alive = false;
      if (gesture?.active) muteClick();
      gesture = null;
      unlisten();
      L.set(x, 0);
      L.set(y, 0);
      el.removeEventListener('pointerdown', down);
      el.removeEventListener('touchstart', touchStart);
      el.removeEventListener('contextmenu', context);
    };
  }, [
    block.item.kind,
    block.item.source_id,
    block.item.starts_at,
    block.item.ends_at,
    block.start,
    day,
    x,
    y,
  ]);

  return (
    <div
      ref={ref}
      className="calendar-block"
      style={
        {
          '--calendar-color': `var(--q-${KIND_COLOR[block.item.kind]})`,
          transform: `translateY(${block.top}px)`,
          height: Math.max(44, block.height),
          left: `${(block.column / block.columns) * 100}%`,
          width: `${100 / block.columns}%`,
        } as CSSProperties
      }
    >
      <Button
        className="calendar-block-hit"
        dot={false}
        disabled={disabled}
        aria-label={description(block.item, timeZone)}
        title={
          block.item.kind === 'lesson' ? 'Правится в расписании' : description(block.item, timeZone)
        }
        onClickCapture={(e) => {
          if (muted.current && e.detail > 0) {
            e.preventDefault();
            e.stopPropagation();
          }
        }}
        onClick={() => onOpen(block.item)}
        onKeyDown={(e) => {
          if (block.item.kind === 'lesson' || disabled || !e.altKey) return;
          const index = days.indexOf(day);
          const toDay =
            e.key === 'ArrowLeft'
              ? days[index - 1]
              : e.key === 'ArrowRight'
                ? days[index + 1]
                : day;
          const delta = e.key === 'ArrowUp' ? -15 : e.key === 'ArrowDown' ? 15 : 0;
          if (!toDay || (!delta && toDay === day)) return;
          e.preventDefault();
          void onMove(block.item, day, toDay, delta);
        }}
      >
        <time>{calendarTime(block.item.starts_at, timeZone)}</time>
        <span>{block.item.title}</span>
        {block.item.place && <small>{block.item.place}</small>}
      </Button>
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
