import type { components } from '@qubite/api-client';
import { LookProvider } from '@qubite/ui';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PultRecos } from './PultRecos';

type Card = components['schemas']['RecoCard'];
type Patch = {
  params: { path: { id: string } };
  body: { status: components['schemas']['RecoDecision'] };
};

const { get, patch, post } = vi.hoisted(() => ({
  get: vi.fn(),
  patch: vi.fn<(path: string, change: Patch) => unknown>(),
  post: vi.fn(),
}));
vi.mock('../../api', () => ({ api: { GET: get, PATCH: patch, POST: post } }));
vi.mock('../parts', () => ({
  SecHead: ({ label }: { label: string }) => <h2>{label}</h2>,
}));

function card(id: string, title: string, arms: Card['arms']): Card {
  return {
    id,
    ref: id,
    week: '2026-W47',
    title,
    arms,
    noticed: 'Правило дублируется',
    will_do: 'Оставлю ссылку',
    effort: 'S',
    saving: '≈ 5000 токенов',
    files: ['AGENTS.md'],
    joker: arms === 'jokers',
    status: 'new',
    created_at: '2026-11-20T12:00:00Z',
    updated_at: '2026-11-20T12:00:00Z',
  };
}
const ok = (data: unknown) => Promise.resolve({ data, response: new Response(null) });

beforeEach(() => {
  vi.clearAllMocks();
  let cards = [card('a', 'Сжать правила', 'memory'), card('b', 'Пятничная сводка', 'jokers')];
  get.mockImplementation(() => {
    const selected = cards.filter((item) => item.status === 'basket');
    return ok({
      week: '2026-W47',
      cards,
      counts: { all: 2, apps: 0, routines: 0, memory: 1, skills: 0, jokers: 1 },
      older_basket: [],
      basket_count: selected.length,
      basket_saving: selected[0]?.saving ?? null,
    });
  });
  patch.mockImplementation((_path, { params, body }) => {
    cards = cards.map((item) => (item.id === params.path.id ? { ...item, ...body } : item));
    return ok(cards[0]);
  });
  post.mockImplementation(() => {
    cards = cards.map((item) => (item.status === 'basket' ? { ...item, status: 'applied' } : item));
    return ok({ id: 'batch', status: 'queued' });
  });
});

function show() {
  const client = new QueryClient();
  render(
    <QueryClientProvider client={client}>
      <LookProvider>
        <PultRecos />
      </LookProvider>
    </QueryClientProvider>,
  );
}

describe('Recos Пульта', () => {
  it('показывает карточки и фильтрует по разделу', async () => {
    show();
    const memory = await screen.findByRole('article', { name: 'Сжать правила' });
    const joker = screen.getByRole('article', { name: 'Пятничная сводка' });
    expect(within(memory).getByText('AGENTS.md')).toBeInTheDocument();
    expect(within(joker).getByText('мимо образцов')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('radio', { name: /Memory/ }));
    expect(joker).not.toBeInTheDocument();
    expect(memory).toBeInTheDocument();
  });

  it('добавляет карточку в корзину и отправляет одно задание', async () => {
    show();
    const card = await screen.findByRole('article', { name: 'Сжать правила' });
    const apply = screen.getByRole('button', { name: 'Применить выбранное' });
    expect(apply).toBeDisabled();
    fireEvent.click(within(card).getByRole('button', { name: 'Да' }));
    expect(await within(card).findByText('в корзине')).toBeInTheDocument();
    expect(patch).toHaveBeenCalledWith('/api/pult/recos/{id}', {
      params: { path: { id: 'a' } },
      body: { status: 'basket' },
    });
    await waitFor(() => expect(apply).toBeEnabled());
    fireEvent.click(apply);
    expect(await within(card).findByText('в задании')).toBeInTheDocument();
    expect(post).toHaveBeenCalledExactlyOnceWith('/api/pult/recos/apply');
  });
});
