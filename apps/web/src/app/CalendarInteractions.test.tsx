import { DEFAULT_LOOK, LookProvider } from '@qubite/ui';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CalendarCreateSurface } from './CalendarCreateSurface';
import { CalendarEventSheet } from './CalendarEventSheet';
import { HOUR_HEIGHT, newEventForm, type CalendarItem } from './calendar-view';
import { CalendarScreen } from './screens/Calendar';

const calendar = vi.hoisted(() => ({
  items: [] as CalendarItem[],
  create: vi.fn(),
  read: vi.fn(),
  refetch: vi.fn(),
}));
vi.mock('../auth/client', async (original) => ({
  ...(await original<typeof import('../auth/client')>()),
  useMe: () => ({ data: { id: 'owner' } }),
  usePlatform: () => ({ data: { timezone: 'UTC' } }),
}));
vi.mock('./calendar', () => ({
  useCalendar: () => ({ data: calendar.items, isSuccess: true, refetch: calendar.refetch }),
  useCalendarEvents: () => ({ known: {}, create: calendar.create, read: calendar.read }),
}));
vi.mock('./planner-context', () => ({
  usePlanner: () => ({ data: { tasks: [], projects: [] } }),
}));
vi.mock('./sync-context', () => ({ useSync: () => ({ version: 0 }) }));

const DAY = '2026-10-30';
const y = (minute: number) => 100 + (minute / 60) * HOUR_HEIGHT;
const wrap = (children: ReactNode) =>
  render(<LookProvider initial={{ ...DEFAULT_LOOK, motion: 'less' }}>{children}</LookProvider>);

function pointer(target: Element | Window, type: string, minute: number) {
  const event = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    button: 0,
    clientX: 20,
    clientY: y(minute),
  });
  Object.defineProperties(event, {
    pointerId: { value: 1 },
    pointerType: { value: 'mouse' },
  });
  fireEvent(target, event);
}
function touch(minute: number) {
  return { identifier: 1, clientX: 20, clientY: y(minute) };
}
function surface(allDay = false, disabled = false) {
  const create = vi.fn();
  const { container } = wrap(
    <CalendarCreateSurface day={DAY} allDay={allDay} disabled={disabled} onCreate={create} />,
  );
  const element = screen.getByRole('button', { name: /Новое событие/ });
  vi.spyOn(element, 'getBoundingClientRect').mockReturnValue({ top: 100 } as DOMRect);
  return {
    create,
    element,
    preview: container.querySelector<HTMLElement>('.calendar-create-preview')!,
  };
}
function renderSheet(save: (body: unknown) => Promise<void>, minute = 540, duration = 60) {
  return wrap(
    <CalendarEventSheet
      open
      initial={newEventForm(DAY, minute, false, duration)}
      existing={false}
      readable
      timeZone="UTC"
      onClose={vi.fn()}
      onSave={save}
      onDelete={vi.fn()}
    />,
  );
}

beforeEach(() => {
  calendar.items = [];
  calendar.create.mockReset().mockResolvedValue(undefined);
  calendar.read.mockReset();
  calendar.refetch.mockReset();
  vi.spyOn(Date, 'now').mockReturnValue(Date.parse(`${DAY}T10:00:00Z`));
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
      unobserve() {}
    },
  );
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('пустая шкала календаря', () => {
  it('создаёт по координате с шагом 15 минут и гасит следующий click', () => {
    const { create, element } = surface();
    pointer(element, 'pointerdown', 10 * 60 + 22);
    pointer(window, 'pointerup', 10 * 60 + 22);
    fireEvent.click(element, { detail: 1, clientY: y(10 * 60 + 22) });
    expect(create).toHaveBeenCalledExactlyOnceWith(DAY, 615, false, 60);
  });

  it('создаёт коротким касанием без удержания', () => {
    const { create, element } = surface();
    fireEvent.touchStart(element, { touches: [touch(615)] });
    fireEvent.touchEnd(window, { touches: [], changedTouches: [touch(615)] });
    expect(create).toHaveBeenCalledExactlyOnceWith(DAY, 615, false, 60);
  });

  it('протяжка задаёт конец, предпросмотр меняет только transform и opacity', () => {
    const { create, element, preview } = surface();
    pointer(element, 'pointerdown', 615);
    pointer(window, 'pointermove', 705);
    expect(preview.style.opacity).toBe('0.3');
    expect(preview.style.transform).toBe(
      `translateY(${(615 / 60) * HOUR_HEIGHT}px) scaleY(${(90 / 60) * HOUR_HEIGHT})`,
    );
    expect(preview.style.height).toBe('');
    pointer(window, 'pointerup', 705);
    expect(create).toHaveBeenCalledExactlyOnceWith(DAY, 615, false, 90);
    expect(preview.style.opacity).toBe('0');
  });

  it('минимум протяжки — 15 минут, конец может быть в полночь', () => {
    const { create, element } = surface();
    pointer(element, 'pointerdown', 1425);
    pointer(window, 'pointermove', 1450);
    pointer(window, 'pointerup', 1450);
    expect(create).toHaveBeenCalledExactlyOnceWith(DAY, 1425, false, 15);
    expect(newEventForm(DAY, 1425, false, 15)).toMatchObject({
      endDay: '2026-10-31',
      endTime: '00:00',
    });
  });

  it('после удержания 400 мс позволяет протянуть пальцем', () => {
    vi.useFakeTimers();
    const { create, element, preview } = surface();
    fireEvent.touchStart(element, { touches: [touch(600)] });
    act(() => vi.advanceTimersByTime(399));
    expect(preview.style.opacity).not.toBe('0.3');
    act(() => vi.advanceTimersByTime(1));
    expect(preview.style.opacity).toBe('0.3');
    fireEvent.touchMove(window, { touches: [touch(645)] });
    fireEvent.touchEnd(window, { touches: [], changedTouches: [touch(645)] });
    expect(create).toHaveBeenCalledExactlyOnceWith(DAY, 600, false, 45);
  });

  it('движение пальца до удержания оставляет прокрутку и не создаёт событие', () => {
    vi.useFakeTimers();
    const { create, element } = surface();
    fireEvent.touchStart(element, { touches: [touch(600)] });
    expect(fireEvent.touchMove(window, { touches: [touch(660)] })).toBe(true);
    fireEvent.touchEnd(window, { touches: [], changedTouches: [touch(660)] });
    fireEvent.click(element, { detail: 1 });
    act(() => vi.advanceTimersByTime(500));
    expect(create).not.toHaveBeenCalled();
  });

  it.each(['pointercancel', 'scroll', 'blur'])('отмена через %s не создаёт событие', (type) => {
    const { create, element } = surface();
    pointer(element, 'pointerdown', 600);
    pointer(window, 'pointermove', 660);
    pointer(window, type, 660);
    pointer(window, 'pointerup', 660);
    fireEvent.click(element, { detail: 1 });
    expect(create).not.toHaveBeenCalled();
  });

  it('стрелки меняют выбранный час, Enter создаёт', () => {
    const { create, element } = surface();
    fireEvent.keyDown(element, { key: 'ArrowDown' });
    expect(element).toHaveAccessibleName(/10:00/);
    fireEvent.keyDown(element, { key: 'Enter' });
    expect(create).toHaveBeenCalledExactlyOnceWith(DAY, 600, false);
  });

  it('пустая строка всего дня создаёт событие без времени', () => {
    const { create, element } = surface(true);
    fireEvent.click(element);
    expect(create).toHaveBeenCalledExactlyOnceWith(DAY, 0, true);
  });

  it('недоступная шкала не создаёт событие', () => {
    const { create, element } = surface(false, true);
    fireEvent.click(element);
    fireEvent.keyDown(element, { key: 'Enter' });
    expect(create).not.toHaveBeenCalled();
  });
});

describe('короткая карточка', () => {
  it('передаёт введённые поля в полную форму и сохраняет их', async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    renderSheet(save);
    expect(screen.queryByLabelText('Место')).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Название'), { target: { value: 'Встреча' } });
    fireEvent.change(screen.getByLabelText('Дата начала'), { target: { value: '2026-11-02' } });
    fireEvent.change(screen.getByLabelText('Дата конца'), { target: { value: '2026-11-03' } });
    fireEvent.change(screen.getByLabelText('Время начала'), { target: { value: '10:15' } });
    fireEvent.change(screen.getByLabelText('Время конца'), { target: { value: '11:45' } });
    fireEvent.click(screen.getByRole('switch', { name: 'Весь день' }));
    fireEvent.click(screen.getByRole('button', { name: 'Другие параметры' }));
    expect(screen.getByLabelText('Место')).toBeInTheDocument();
    expect(screen.getByLabelText('Название')).toHaveValue('Встреча');
    expect(screen.getByLabelText('Дата начала')).toHaveValue('2026-11-02');
    expect(screen.getByLabelText('Дата конца')).toHaveValue('2026-11-03');
    expect(screen.getByRole('switch', { name: 'Весь день' })).toHaveAttribute('aria-checked', 'true');
    // Возвращаем время и убеждаемся, что переключение не потеряло его.
    fireEvent.click(screen.getByRole('switch', { name: 'Весь день' }));
    expect(screen.getByLabelText('Время начала')).toHaveValue('10:15');
    expect(screen.getByLabelText('Время конца')).toHaveValue('11:45');
    fireEvent.submit(screen.getByLabelText('Название').closest('form')!);
    await waitFor(() =>
      expect(save).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Встреча',
          starts_at: Date.parse('2026-11-02T10:15:00Z'),
          ends_at: Date.parse('2026-11-03T11:45:00Z'),
          all_day: false,
        }),
      ),
    );
  });

  it('сохраняет прямо из короткой карточки', async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    renderSheet(save, 615, 45);
    fireEvent.change(screen.getByLabelText('Название'), { target: { value: 'Созвон' } });
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
    await waitFor(() =>
      expect(save).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Созвон',
          starts_at: Date.parse(`${DAY}T10:15:00Z`),
          ends_at: Date.parse(`${DAY}T11:00:00Z`),
        }),
      ),
    );
  });
});

describe('действия на экране календаря', () => {
  it('координаты на шкале доходят до полей короткой карточки', () => {
    const { container } = wrap(<CalendarScreen />);
    const track = container.querySelector<HTMLElement>(
      '.calendar-day-track > .calendar-create-surface',
    )!;
    vi.spyOn(track, 'getBoundingClientRect').mockReturnValue({ top: 100 } as DOMRect);
    pointer(track, 'pointerdown', 615);
    pointer(window, 'pointermove', 660);
    pointer(window, 'pointerup', 660);
    expect(screen.getByLabelText('Время начала')).toHaveValue('10:15');
    expect(screen.getByLabelText('Время конца')).toHaveValue('11:00');
    expect(screen.getByRole('button', { name: 'Другие параметры' })).toBeInTheDocument();
  });

  it('шапка открывает короткую карточку', () => {
    wrap(<CalendarScreen />);
    fireEvent.click(screen.getByRole('button', { name: 'Новое событие' }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Другие параметры' })).toBeInTheDocument();
  });

  it('нажатие на запись открывает полную форму и не создаёт другую', async () => {
    calendar.items = [
      {
        kind: 'event',
        source_id: 'event',
        title: 'Поездка',
        place: '',
        starts_at: Date.parse(`${DAY}T00:00:00Z`),
        ends_at: Date.parse('2026-10-31T00:00:00Z'),
        all_day: true,
      },
    ];
    calendar.read.mockResolvedValue({
      ...calendar.items[0],
      id: 'event',
      notes: '',
      project_id: null,
      recurrence: null,
    });
    wrap(<CalendarScreen />);
    fireEvent.click(screen.getAllByRole('button', { name: /Событие: Поездка/ })[0]!);
    await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument());
    expect(screen.getByLabelText('Название')).toHaveValue('Поездка');
    expect(screen.getByLabelText('Место')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Другие параметры' })).not.toBeInTheDocument();
    expect(calendar.create).not.toHaveBeenCalled();
  });

  it('c создаёт, а при открытой карточке клавиши не меняют календарь', () => {
    wrap(<CalendarScreen />);
    fireEvent.keyDown(document.body, { key: 'c' });
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    fireEvent.keyDown(document.body, { key: 'm' });
    expect(screen.getByRole('radio', { name: 'Неделя' })).toHaveAttribute('aria-checked', 'true');
    fireEvent.keyDown(document.body, { key: 'c' });
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
  });

  it('d/w/m меняют вид, стрелки период, t возвращает сегодня', () => {
    const { container } = wrap(<CalendarScreen />);
    fireEvent.keyDown(document.body, { key: 'd' });
    expect(screen.getByRole('radio', { name: 'День' })).toHaveAttribute('aria-checked', 'true');
    const label = container.querySelector('.calendar-period')!;
    const today = label.textContent;
    fireEvent.keyDown(document.body, { key: 'ArrowRight' });
    expect(label.textContent).not.toBe(today);
    fireEvent.keyDown(document.body, { key: 'ArrowLeft' });
    expect(label.textContent).toBe(today);
    fireEvent.keyDown(document.body, { key: 'ArrowRight' });
    fireEvent.keyDown(document.body, { key: 't' });
    expect(label.textContent).toBe(today);
    fireEvent.keyDown(document.body, { key: 'm' });
    expect(screen.getByRole('radio', { name: 'Месяц' })).toHaveAttribute('aria-checked', 'true');
    fireEvent.keyDown(document.body, { key: 'w' });
    expect(screen.getByRole('radio', { name: 'Неделя' })).toHaveAttribute('aria-checked', 'true');
  });

  it.each(['input', 'textarea', 'select', 'editable'])('клавиши не срабатывают в %s', (kind) => {
    const { container } = wrap(
      <>
        <input aria-label="Поиск" />
        <textarea aria-label="Текст" />
        <select aria-label="Выбор">
          <option>Один</option>
        </select>
        <div contentEditable aria-label="Редактор" />
        <CalendarScreen />
      </>,
    );
    const input =
      kind === 'editable' ? screen.getByLabelText('Редактор') : container.querySelector(kind)!;
    const label = container.querySelector('.calendar-period')!.textContent;
    for (const key of ['c', 't', 'd', 'w', 'm', 'ArrowLeft', 'ArrowRight'])
      fireEvent.keyDown(input, { key });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Неделя' })).toHaveAttribute('aria-checked', 'true');
    expect(container.querySelector('.calendar-period')).toHaveTextContent(label!);
  });
});
