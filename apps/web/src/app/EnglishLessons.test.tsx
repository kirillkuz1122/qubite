import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Placement } from './EnglishLessons';
import type { PlacementTest } from './english-lessons';

const { get, post } = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));

vi.mock('../api', () => ({ api: { GET: get, POST: post } }));

const test: PlacementTest = {
  about_ru: 'Входной тест',
  minutes: 5,
  stages: [
    {
      level: 'a0',
      pass_min: 3,
      items: [
        {
          id: 'p1',
          type: 'choose',
          ask_ru: 'Выбери приветствие.',
          options: ['Hello', 'Wrong'],
          answer: 'Hello',
        },
        {
          id: 'p2',
          type: 'fill',
          ask_ru: 'Вставь слово.',
          text: 'I ___ here.',
          options: ['am', 'is'],
          answers: ['am'],
        },
        {
          id: 'p3',
          type: 'listen',
          ask_ru: 'Послушай и выбери число.',
          audio: 'I am fourteen.',
          options: ['14', '40'],
          answer: '14',
        },
        {
          id: 'p4',
          type: 'build',
          ask_ru: 'Собери фразу.',
          answer: 'I am here',
          extra: ['is'],
        },
      ],
    },
  ],
};

beforeEach(() => {
  get.mockReset().mockResolvedValue({ data: test, response: new Response() });
  post.mockReset().mockResolvedValue({
    data: { level: 'a0', start_lesson: 'a0-m1-l1', stages: [] },
    response: new Response(),
  });
});

function renderTest() {
  const queries = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const onDone = vi.fn();
  const view = render(
    <QueryClientProvider client={queries}>
      <Placement onDone={onDone} />
    </QueryClientProvider>,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Пройти тест' }));
  return { ...view, onDone };
}

describe('входной тест английского', () => {
  it('«Не знаю» на каждом виде задания отправляет явный null и идёт дальше', async () => {
    const { onDone } = renderTest();
    for (const item of test.stages[0]!.items) {
      expect(await screen.findByText(item.ask_ru)).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Не знаю' }));
    }
    expect(screen.getByText('Готово. Как было?')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Не знаю' })).not.toBeInTheDocument();
    expect(post).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Нормально' }));
    await waitFor(() =>
      expect(post).toHaveBeenCalledWith('/api/v1/english/placement', {
        body: { answers: { p1: null, p2: null, p3: null, p4: null }, shift: 0 },
      }),
    );
    await waitFor(() => expect(onDone).toHaveBeenCalledOnce());
  });

  it('сохраняет обычные ответы вместе с пропуском и не показывает правильность', async () => {
    const { container } = renderTest();
    const noVerdict = () => {
      expect(container.querySelector('[data-state="ok"], [data-state="bad"]')).toBeNull();
      expect(screen.queryByText(/верно|неверно|правильно:/i)).not.toBeInTheDocument();
    };
    await screen.findByText('Выбери приветствие.');
    noVerdict();
    fireEvent.click(screen.getByRole('button', { name: 'Wrong' }));
    expect(screen.getByText('Вставь слово.')).toBeInTheDocument();
    noVerdict();
    fireEvent.click(screen.getByRole('button', { name: 'am' }));
    expect(screen.getByText('Послушай и выбери число.')).toBeInTheDocument();
    noVerdict();
    expect(screen.queryByText('«I am fourteen.»')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '14' }));
    expect(screen.getByText('Собери фразу.')).toBeInTheDocument();
    noVerdict();
    fireEvent.click(screen.getByRole('button', { name: 'Не знаю' }));
    noVerdict();
    fireEvent.click(screen.getByRole('button', { name: 'Нормально' }));
    await waitFor(() =>
      expect(post).toHaveBeenCalledWith('/api/v1/english/placement', {
        body: { answers: { p1: 'Wrong', p2: ['am'], p3: '14', p4: null }, shift: 0 },
      }),
    );
  });
});
