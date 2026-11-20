import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ME } from '../auth/client';
import { PultWaitingPart } from './HomePult';
import { PULT, type PultBoard, type PultWaiting } from './pult';

type Destination = { to: string; search?: () => { tab: string; agent: string } };

const { get, post, navigate } = vi.hoisted(() => ({
  get: vi.fn<(path: string) => unknown>(),
  post: vi.fn(),
  navigate: vi.fn<(options: Destination) => void>(),
}));

vi.mock('../api', () => ({ api: { GET: get, POST: post } }));
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => navigate }));
// Точечный заголовок рисуется на холсте. Здесь важны его подпись и действия в секции.
vi.mock('./parts', () => ({
  SecHead: ({ label, children }: { label: string; children?: ReactNode }) => (
    <div>
      <h2>{label}</h2>
      {children}
    </div>
  ),
}));

const LABEL = 'Ждёт тебя в Пульте';
const NOW = '2026-11-20T07:00:00Z';
const PULT_PATH = '/api/owner/pult';

function question(number: number, options = ['Да', 'Нет']): PultWaiting {
  return {
    number,
    key: `gh-${number}`,
    title: `Вопрос ${number}`,
    text: '',
    options,
    updated_at: NOW,
    url: `https://github.com/kirillkuz1122/qubite/issues/${number}`,
  };
}

function board(waiting: PultWaiting[]): PultBoard {
  return {
    now: NOW,
    waiting,
    counts: { waiting: waiting.length, done: 0, running: 0 },
    agents: [],
    limits: {},
    skills: [],
    sources: [],
  };
}

const ok = (data: unknown) => Promise.resolve({ data, response: new Response(null) });

let server: { owner: boolean; waiting: PultWaiting[]; down: boolean };

beforeEach(() => {
  vi.clearAllMocks();
  server = { owner: true, waiting: [], down: false };
  get.mockImplementation((path) => {
    if (path === '/api/auth/me') return ok({ is_owner: server.owner });
    if (path !== PULT_PATH) throw new Error(`Неожиданный запрос: ${path}`);
    if (server.down) return Promise.resolve({ response: new Response(null, { status: 503 }) });
    return ok(board(server.waiting));
  });
  post.mockImplementation(() => {
    server.waiting = [];
    return ok({ url: 'https://github.com/kirillkuz1122/qubite/issues/262#issuecomment-1' });
  });
});

function show() {
  const client = new QueryClient();
  render(
    <QueryClientProvider client={client}>
      <PultWaitingPart onLayout={vi.fn()} />
    </QueryClientProvider>,
  );
  return client;
}

describe('Ждёт тебя в Пульте на Главной', () => {
  it('обычный аккаунт не видит блок и не запрашивает Пульт', async () => {
    server.owner = false;
    server.waiting = [question(262)];
    const client = show();

    await waitFor(() => expect(client.getQueryData(ME)).toEqual({ is_owner: false }));
    expect(screen.queryByRole('region', { name: LABEL })).not.toBeInTheDocument();
    expect(get.mock.calls).toEqual([['/api/auth/me']]);
  });

  it('у владельца без вопросов блока нет', async () => {
    const client = show();

    await waitFor(() => expect(client.getQueryState(PULT)?.status).toBe('success'));
    expect(screen.queryByRole('region', { name: LABEL })).not.toBeInTheDocument();
  });

  it('при ошибке загрузки блока нет', async () => {
    server.down = true;
    const client = show();

    await waitFor(() => expect(client.getQueryState(PULT)?.status).toBe('error'));
    expect(screen.queryByRole('region', { name: LABEL })).not.toBeInTheDocument();
  });

  it('показывает заголовок, счётчик и один вопрос с кнопками «Да» и «Нет»', async () => {
    server.waiting = [question(262)];
    show();

    const part = within(await screen.findByRole('region', { name: LABEL }));
    expect(part.getByRole('heading', { name: LABEL })).toBeInTheDocument();
    expect(part.getByText('1')).toHaveClass('n');
    const card = within(part.getByRole('article', { name: 'Вопрос 262' }));
    expect(card.getByRole('button', { name: 'Да' })).toHaveClass('q-fill');
    expect(card.getByRole('button', { name: 'Нет' })).toBeInTheDocument();
    expect(card.queryByRole('button', { name: 'Открыть' })).not.toBeInTheDocument();
  });

  it('из трёх вопросов показывает два, «все 3 →» ведёт в Пульт', async () => {
    server.waiting = [question(262), question(263), question(264)];
    show();

    const part = within(await screen.findByRole('region', { name: LABEL }));
    expect(part.getAllByRole('article')).toHaveLength(2);
    expect(part.queryByRole('article', { name: 'Вопрос 264' })).not.toBeInTheDocument();
    expect(part.getAllByRole('button', { name: 'Да' })[1]).not.toHaveClass('q-fill');
    fireEvent.click(part.getByRole('button', { name: 'все 3 →' }));
    expect(navigate).toHaveBeenCalledWith({ to: '/pult' });
  });

  it('при одном варианте «Открыть» ведёт к агенту', async () => {
    server.waiting = [question(262, ['Да'])];
    show();

    fireEvent.click(await screen.findByRole('button', { name: 'Открыть' }));
    expect(navigate).toHaveBeenCalledWith({ to: '/pult', search: expect.any(Function) });
    expect(navigate.mock.calls[0]?.[0].search?.()).toEqual({ tab: 'agents', agent: 'gh-262' });
  });

  it('«Да» отправляет ответ, после последнего ответа блок уходит', async () => {
    server.waiting = [question(262)];
    show();

    fireEvent.click(await screen.findByRole('button', { name: 'Да' }));
    expect(post).toHaveBeenCalledExactlyOnceWith('/api/owner/work/questions/{number}/answer', {
      params: { path: { number: 262 } },
      body: { answer: 'Да' },
    });
    await waitFor(() => expect(screen.queryByRole('region', { name: LABEL })).toBeNull(), {
      timeout: 3000,
    });
  });
});
