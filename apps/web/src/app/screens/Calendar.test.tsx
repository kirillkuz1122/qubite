import { fireEvent, render, screen, within } from '@testing-library/react';
import { LookProvider } from '@qubite/ui';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CalendarScreen } from './Calendar';

const { refetch } = vi.hoisted(() => ({ refetch: vi.fn() }));

vi.mock('../../auth/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../auth/client')>()),
  useMe: () => ({ data: { id: 'owner' } }),
  usePlatform: () => ({ data: { timezone: 'Asia/Yekaterinburg' } }),
}));
vi.mock('../calendar', () => ({
  useCalendar: () => ({ data: [], isSuccess: true, refetch }),
  useCalendarEvents: () => ({ known: {} }),
}));
vi.mock('../planner-context', () => ({
  usePlanner: () => ({ data: { tasks: [], projects: [] } }),
}));
vi.mock('../sync-context', () => ({ useSync: () => ({ version: 0 }) }));

beforeEach(() => {
  vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-11-03T05:00:00Z'));
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  );
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('шапка календаря', () => {
  it.each([false, true])('меняет период и вид через общую шапку (телефон: %s)', (narrow) => {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query === '(max-width: 599px)' && narrow,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));
    const { container } = render(
      <LookProvider>
        <CalendarScreen />
      </LookProvider>,
    );
    const toolbar = container.querySelector<HTMLElement>('.calendar-toolbar')!;
    const period = toolbar.querySelector('.calendar-period')!;
    const initial = period.textContent;
    const modes = within(toolbar).getByRole('radiogroup', { name: 'Вид календаря' });
    expect(modes).toBeInTheDocument();
    expect(within(toolbar).getByRole('button', { name: 'Новое событие' })).toBeInTheDocument();
    expect(toolbar.querySelectorAll('.calendar-nav-arrow .q-ico')).toHaveLength(2);
    expect(container.querySelectorAll('.calendar-day-track')).toHaveLength(narrow ? 3 : 7);
    fireEvent.click(within(toolbar).getByRole('button', { name: 'Вперёд' }));
    expect(period.textContent).not.toBe(initial);
    fireEvent.click(within(toolbar).getByRole('button', { name: 'Назад' }));
    expect(period.textContent).toBe(initial);
    fireEvent.click(within(toolbar).getByRole('button', { name: 'Назад' }));
    fireEvent.click(within(toolbar).getByRole('button', { name: 'Сегодня' }));
    expect(period.textContent).toBe(initial);
    fireEvent.click(within(toolbar).getByRole('radio', { name: 'День' }));
    expect(within(toolbar).getByRole('radio', { name: 'День' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    expect(container.querySelectorAll('.calendar-day-track')).toHaveLength(1);
    fireEvent.click(within(toolbar).getByRole('radio', { name: 'Месяц' }));
    expect(screen.getByRole('group', { name: 'Дни месяца' })).toBeInTheDocument();
    fireEvent.click(within(toolbar).getByRole('radio', { name: 'Неделя' }));
    expect(container.querySelectorAll('.calendar-day-track')).toHaveLength(narrow ? 3 : 7);
  });

  it('кнопка создания в шапке открывает форму с закреплёнными действиями', () => {
    render(
      <LookProvider>
        <CalendarScreen />
      </LookProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Новое событие' }));
    const dialog = screen.getByRole('dialog', { name: 'Новое событие' });
    const create = within(dialog).getByRole('button', { name: 'Создать' });
    expect(create.closest('.q-sheet-footer')).not.toBeNull();
    expect(within(dialog).getByRole('button', { name: 'Отмена' })).toBeInTheDocument();
  });
});
