import { useEffect, useRef, useState } from 'react';
import { HOUR_HEIGHT, shortDayLabel, snapMinute, timeFromMinute } from './calendar-view';

/** Пустая поверхность — один фокус на день, без ряда невидимых кнопок часов.
 * События лежат рядом поверх неё и сохраняют собственные нажатия и переносы. */
export function CalendarCreateSurface({
  day,
  allDay = false,
  disabled,
  onCreate,
}: {
  day: string;
  allDay?: boolean;
  disabled: boolean;
  onCreate: (day: string, minute?: number, allDay?: boolean, duration?: number) => void;
}) {
  const surface = useRef<HTMLDivElement>(null);
  const preview = useRef<HTMLDivElement>(null);
  const previewTime = useRef<HTMLDivElement>(null);
  const cursor = useRef<HTMLDivElement>(null);
  const followCursor = useRef(false);
  const [minute, setMinute] = useState(9 * 60);

  useEffect(() => {
    const el = surface.current;
    const block = preview.current;
    const time = previewTime.current;
    if (!el || !block || !time || disabled) return;
    let gesture: {
      id: number;
      touch: boolean;
      x: number;
      y: number;
      top: number;
      start: number;
      end: number;
      active: boolean;
    } | null = null;
    let hold: ReturnType<typeof setTimeout> | undefined;
    let muteUntil = 0;
    const at = (y: number, top: number) => snapMinute(((y - top) / HOUR_HEIGHT) * 60);
    const draw = () => {
      if (!gesture || allDay) return;
      block.style.transform = `translateY(${(gesture.start / 60) * HOUR_HEIGHT}px) scaleY(${((gesture.end - gesture.start) / 60) * HOUR_HEIGHT})`;
      block.style.opacity = '0.3';
      // Время протяжки — в верху заготовки, как в Google: видно, до скольки тянешь.
      time.textContent = `${timeFromMinute(gesture.start)}–${timeFromMinute(gesture.end)}`;
      time.style.transform = `translateY(${(gesture.start / 60) * HOUR_HEIGHT}px)`;
      time.style.opacity = '1';
    };
    const unlisten = () => {
      clearTimeout(hold);
      globalThis.removeEventListener('pointermove', pointerMove);
      globalThis.removeEventListener('pointerup', pointerUp);
      globalThis.removeEventListener('pointercancel', pointerCancel);
      globalThis.removeEventListener('touchstart', extraTouch);
      globalThis.removeEventListener('touchmove', touchMove);
      globalThis.removeEventListener('touchend', touchEnd);
      globalThis.removeEventListener('touchcancel', cancel);
      globalThis.removeEventListener('scroll', cancel, true);
      globalThis.removeEventListener('blur', cancel);
      globalThis.removeEventListener('keydown', key, true);
      block.style.opacity = '0';
      time.style.opacity = '0';
    };
    const cancel = () => {
      if (!gesture) return;
      gesture = null;
      muteUntil = Date.now() + 500;
      unlisten();
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        cancel();
      }
    };
    const update = (x: number, y: number, event: Event) => {
      if (!gesture) return;
      if (!gesture.active) {
        if (Math.hypot(x - gesture.x, y - gesture.y) < 6) return;
        // До удержания движение принадлежит прокрутке, не календарю.
        if (gesture.touch || allDay) {
          cancel();
          return;
        }
        gesture.active = true;
      }
      if (event.cancelable) event.preventDefault();
      const end = Math.max(
        15,
        Math.min(1440, Math.round(((y - gesture.top) / HOUR_HEIGHT) * 4) * 15),
      );
      gesture.end = Math.max(gesture.start + 15, end);
      draw();
    };
    const end = () => {
      const g = gesture;
      if (!g) return;
      gesture = null;
      muteUntil = Date.now() + 500;
      unlisten();
      onCreate(day, g.start, allDay, g.active ? g.end - g.start : 60);
    };
    const pointerMove = (event: PointerEvent) => {
      if (gesture && !gesture.touch && event.pointerId === gesture.id)
        update(event.clientX, event.clientY, event);
    };
    const pointerUp = (event: PointerEvent) => {
      if (gesture && !gesture.touch && event.pointerId === gesture.id) {
        update(event.clientX, event.clientY, event);
        end();
      }
    };
    const pointerCancel = (event: PointerEvent) => {
      if (gesture && !gesture.touch && event.pointerId === gesture.id) cancel();
    };
    const extraTouch = (event: TouchEvent) => {
      if (event.touches.length !== 1) cancel();
    };
    const touchMove = (event: TouchEvent) => {
      if (event.touches.length !== 1) {
        cancel();
        return;
      }
      const touch = [...event.touches].find((entry) => entry.identifier === gesture?.id);
      if (touch) update(touch.clientX, touch.clientY, event);
    };
    const touchEnd = (event: TouchEvent) => {
      const touch = [...event.changedTouches].find((entry) => entry.identifier === gesture?.id);
      if (!touch) return;
      // Гасим совместимый click: событие создаётся только один раз.
      if (event.cancelable) event.preventDefault();
      update(touch.clientX, touch.clientY, event);
      end();
    };
    const begin = (id: number, x: number, y: number, touch: boolean) => {
      if (gesture) return;
      const top = el.getBoundingClientRect().top;
      const start = allDay ? 0 : at(y, top);
      gesture = { id, touch, x, y, top, start, end: start + 15, active: false };
      if (touch && !allDay)
        hold = setTimeout(() => {
          if (!gesture) return;
          gesture.active = true;
          draw();
        }, 400);
      globalThis.addEventListener('pointermove', pointerMove, { passive: false });
      globalThis.addEventListener('pointerup', pointerUp);
      globalThis.addEventListener('pointercancel', pointerCancel);
      globalThis.addEventListener('touchstart', extraTouch, { passive: true });
      globalThis.addEventListener('touchmove', touchMove, { passive: false });
      globalThis.addEventListener('touchend', touchEnd, { passive: false });
      globalThis.addEventListener('touchcancel', cancel);
      globalThis.addEventListener('scroll', cancel, true);
      globalThis.addEventListener('blur', cancel);
      globalThis.addEventListener('keydown', key, true);
    };
    const down = (event: PointerEvent) => {
      if (event.pointerType !== 'touch' && event.button === 0)
        begin(event.pointerId, event.clientX, event.clientY, false);
    };
    const touchStart = (event: TouchEvent) => {
      if (event.touches.length !== 1) {
        cancel();
        return;
      }
      const touch = event.touches[0]!;
      begin(touch.identifier, touch.clientX, touch.clientY, true);
    };
    const click = (event: MouseEvent) => {
      if (Date.now() < muteUntil) return;
      // Без pointer-событий click приходит также от экранного диктора.
      const start = allDay
        ? 0
        : event.detail
          ? at(event.clientY, el.getBoundingClientRect().top)
          : minute;
      onCreate(day, start, allDay);
    };
    const context = (event: Event) => {
      if (gesture) event.preventDefault();
    };
    el.addEventListener('pointerdown', down);
    el.addEventListener('touchstart', touchStart, { passive: true });
    el.addEventListener('click', click);
    el.addEventListener('contextmenu', context);
    return () => {
      gesture = null;
      unlisten();
      el.removeEventListener('pointerdown', down);
      el.removeEventListener('touchstart', touchStart);
      el.removeEventListener('click', click);
      el.removeEventListener('contextmenu', context);
    };
  }, [day, allDay, disabled, onCreate, minute]);

  // Выбранный с клавиатуры час должен оставаться в видимой части шкалы.
  useEffect(() => {
    if (!followCursor.current) return;
    followCursor.current = false;
    cursor.current?.scrollIntoView?.({ block: 'nearest' });
  }, [minute]);

  return (
    <>
      <div
        ref={surface}
        className="calendar-create-surface"
        role="button"
        tabIndex={disabled ? -1 : 0}
        aria-disabled={disabled}
        aria-label={`Новое событие, ${shortDayLabel(day)}, ${allDay ? 'весь день' : timeFromMinute(minute)}`}
        onKeyDown={(event) => {
          if (disabled || event.target !== event.currentTarget) return;
          if (!allDay && ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) {
            event.preventDefault();
            event.stopPropagation();
            const direction = event.key === 'ArrowUp' || event.key === 'ArrowLeft' ? -1 : 1;
            followCursor.current = true;
            setMinute((current) => snapMinute(current + direction * 60));
          } else if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            event.stopPropagation();
            onCreate(day, allDay ? 0 : minute, allDay);
          }
        }}
      >
        {!allDay && (
          <div
            ref={cursor}
            className="calendar-create-cursor"
            style={{ transform: `translateY(${(minute / 60) * HOUR_HEIGHT}px)` }}
            aria-hidden="true"
          />
        )}
      </div>
      <div ref={preview} className="calendar-create-preview" aria-hidden="true" />
      <div ref={previewTime} className="calendar-create-time" aria-hidden="true" />
    </>
  );
}
