import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { fireEvent, render, screen, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { PultAgent, PultBoard } from '../pult';
import { PultScreen } from './Pult';

const { get, useMedia } = vi.hoisted(() => ({ get: vi.fn(), useMedia: vi.fn() }));

vi.mock('../../api', () => ({ api: { GET: get } }));
vi.mock('@qubite/ui', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@qubite/ui')>()),
  useMedia,
  EmptyState: ({ title }: { title: ReactNode }) => <p>{title}</p>,
}));
vi.mock('../parts', () => ({
  SecHead: ({ label, children }: { label: string; children?: ReactNode }) => (
    <div>
      <h2>{label}</h2>
      {children}
    </div>
  ),
}));

const NOW = '2026-11-20T07:00:00Z';
const running: PultAgent = {
  key: 'gh-306',
  title: 'Обновляет Пульт',
  status: 'running',
  place: 'cloud',
  source: 'облако',
  updated_at: NOW,
};
const waiting: PultAgent = {
  ...running,
  key: 'gh-289',
  title: 'Ждёт решения о запуске',
  status: 'waiting',
};
const board: PultBoard = {
  agents: [running, waiting],
  counts: { running: 1, waiting: 1, done: 0 },
  limits: {},
  now: NOW,
  skills: [],
  sources: [],
  waiting: [],
};
const MAP_LABEL = 'Карта: агенты, задачи, навыки, память';

function show(wide = false) {
  useMedia.mockReturnValue(wide);
  get.mockImplementation((path: string) => {
    const responses: Record<string, unknown> = {
      '/api/auth/me': { is_owner: true },
      '/api/owner/pult': board,
      '/api/owner/pult/collectors': [],
      '/api/owner/pult/agents/{key}': { agent: waiting, events: [] },
    };
    const data = responses[path];
    if (data === undefined) throw new Error(`Неожиданный запрос: ${path}`);
    return Promise.resolve({ data, response: new Response(null) });
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const root = createRootRoute();
  const route = createRoute({ getParentRoute: () => root, path: '/pult', component: PultScreen });
  const router = createRouter({
    routeTree: root.addChildren([route]),
    history: createMemoryHistory({ initialEntries: ['/pult'] }),
  });
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

describe('Навигация Пульта', () => {
  it.each([
    ['Ждёт тебя', /Ждут тебя/, waiting.title, running.title],
    ['Работает', /Работают/, running.title, waiting.title],
  ] as const)(
    'цифра «%s» открывает список с нужным фильтром',
    async (label, filter, shown, hidden) => {
      show();

      fireEvent.click(await screen.findByRole('button', { name: `${label}: 1 — открыть список` }));

      const list = within(await screen.findByRole('list', { name: 'Агенты' }));
      expect(list.getByText(shown)).toBeInTheDocument();
      expect(list.queryByText(hidden)).not.toBeInTheDocument();
      expect(screen.getByRole('radio', { name: filter })).toBeChecked();
    },
  );

  it('даже нулевая цифра открывает список с подписью «Здесь пусто»', async () => {
    show();

    fireEvent.click(await screen.findByRole('button', { name: 'Готово: 0 — открыть список' }));

    expect(await screen.findByText('Здесь пусто')).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Готово' })).toBeChecked();
  });

  it.each([
    ['телефон', false, 'Агенты или карта'],
    ['ПК', true, 'Разделы Пульта'],
  ] as const)(
    'переключение между агентами и картой сохраняет фильтр (%s)',
    async (_, wide, label) => {
      show(wide);
      fireEvent.click(await screen.findByRole('button', { name: 'Ждёт тебя: 1 — открыть список' }));

      const tabs = within(await screen.findByRole('radiogroup', { name: label }));
      fireEvent.click(tabs.getByRole('radio', { name: 'Карта' }));
      expect(await screen.findByRole('group', { name: MAP_LABEL })).toBeInTheDocument();
      expect(tabs.getByRole('radio', { name: 'Карта' })).toBeChecked();

      fireEvent.click(tabs.getByRole('radio', { name: 'Агенты' }));
      const list = within(await screen.findByRole('list', { name: 'Агенты' }));
      expect(list.getByText(waiting.title)).toBeInTheDocument();
      expect(list.queryByText(running.title)).not.toBeInTheDocument();
      expect(screen.getByRole('radio', { name: /Ждут тебя/ })).toBeChecked();
    },
  );

  it('со Светофора открывает карту и возвращается кнопкой «Пульт»', async () => {
    show();

    const shortcuts = within(await screen.findByRole('group', { name: 'Разделы Светофора' }));
    expect(shortcuts.getByRole('button', { name: 'Агенты 2' })).toBeInTheDocument();
    fireEvent.click(shortcuts.getByRole('button', { name: 'Карта' }));
    expect(await screen.findByRole('group', { name: MAP_LABEL })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Пульт' }));
    expect(await screen.findByRole('group', { name: 'Разделы Светофора' })).toBeInTheDocument();
  });
});
