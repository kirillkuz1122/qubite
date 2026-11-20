import type { components } from '@qubite/api-client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PultTasks } from './PultTasks';

type Schedule = components['schemas']['PultSchedule'];
type Patch = {
  params: { path: { id: string } };
  body: { enabled: boolean };
};

const { get, patch, useMedia } = vi.hoisted(() => ({
  get: vi.fn(),
  patch: vi.fn<(path: string, update: Patch) => unknown>(),
  useMedia: vi.fn(),
}));

vi.mock('../../api', () => ({ api: { GET: get, PATCH: patch } }));
vi.mock('@qubite/ui', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@qubite/ui')>()),
  useMedia,
}));
vi.mock('../parts', () => ({
  SecHead: ({ label, children }: { label: string; children?: ReactNode }) => (
    <div>
      <h2>{label}</h2>
      {children}
    </div>
  ),
}));

let schedules: Schedule[];
function task(id: string, name: string, time: string, tokens: number): Schedule {
  return {
    id,
    name,
    kind: 'quiet',
    schedule_text: `пт ${time}`,
    days: [4],
    where_run: 'pi',
    enabled: true,
    tokens_7d: tokens,
    usd_7d: 0,
    cap_status: 'ok',
  };
}

const ok = (data: unknown) => Promise.resolve({ data, response: new Response(null) });

beforeEach(() => {
  vi.clearAllMocks();
  useMedia.mockReturnValue(true);
  schedules = [task('a', 'Аудит', '21:00', 100), task('b', 'Сводка', '08:00', 200)];
  get.mockImplementation(() =>
    ok({ schedules, million_tokens_7d: 0.0003, usd_7d: 0, active: 0, quiet: 2 }),
  );
  patch.mockImplementation((_path, update) => {
    const updated = { ...schedules[1]!, enabled: update.body.enabled };
    schedules = [schedules[0]!, updated];
    return ok(updated);
  });
});

function show() {
  const client = new QueryClient();
  render(
    <QueryClientProvider client={client}>
      <PultTasks onEdit={vi.fn()} />
    </QueryClientProvider>,
  );
}

describe('Задачи Пульта', () => {
  it('показывает таблицу и меняет порядок по имени и времени', async () => {
    show();
    const table = await screen.findByRole('table', { name: 'Задачи по расписанию' });
    const [header] = within(table).getAllByRole('row');
    expect(header).toHaveTextContent('Токены/нед');
    expect(header).toHaveTextContent('Потолок');
    const first = () => within(table).getAllByRole('row')[1];
    expect(first()).toHaveTextContent('Сводка');
    fireEvent.click(screen.getByRole('radio', { name: 'по имени' }));
    expect(first()).toHaveTextContent('Аудит');
    fireEvent.click(screen.getByRole('radio', { name: 'по времени' }));
    expect(first()).toHaveTextContent('Сводка');
  });

  it('выключает задачу через серверный запрос', async () => {
    show();
    const toggle = await screen.findByRole('switch', { name: 'Запуск задачи «Сводка»' });
    expect(toggle).toBeChecked();
    fireEvent.click(toggle);
    await waitFor(() => expect(toggle).not.toBeChecked());
    expect(patch).toHaveBeenCalledWith('/api/pult/schedules/{id}', {
      params: { path: { id: 'b' } },
      body: { enabled: false },
    });
  });

  it('на телефоне показывает карточки и отмечает паузу', async () => {
    useMedia.mockReturnValue(false);
    Object.assign(schedules[0]!, {
      cap_percent: 100,
      cap_status: 'reached',
      enabled: false,
      paused_reason: 'cap',
    });
    show();
    const card = await screen.findByRole('article', { name: 'Аудит' });
    expect(within(card).getByText('на паузе')).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });
});
