import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Fail } from '../auth/client';
import { EnglishVerbs } from './EnglishVerbs';
import type { Verb, VerbAnswered, VerbProgress, VerbsOverview } from './english-verbs';

const mocks = vi.hoisted(() => ({ useEnglishVerbs: vi.fn(), answerVerb: vi.fn() }));

// Анимации и canvas проверяются в packages/ui; здесь — поведение тренажёра.
vi.mock('@qubite/ui', () => ({
  Button: (p: ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button type={p.type ?? 'button'} form={p.form} disabled={p.disabled} onClick={p.onClick}>
      {p.children}
    </button>
  ),
  Field: (p: InputHTMLAttributes<HTMLInputElement> & { label: string; error?: string | null }) => (
    <label>
      {p.label}
      <input value={p.value} onChange={p.onChange} disabled={p.disabled} />
      {p.error && <span role="alert">{p.error}</span>}
    </label>
  ),
  Note: ({ children }: { children: ReactNode }) => <p role="alert">{children}</p>,
  Presence: ({ children, show }: { children: ReactNode; show: boolean }) =>
    show ? children : null,
  Swap: ({ children }: { children: ReactNode }) => children,
  Sheet: (p: { children: ReactNode; open: boolean; title: string; footer?: ReactNode }) =>
    p.open ? (
      <div role="dialog" aria-label={p.title}>
        {p.children}
        {p.footer}
      </div>
    ) : null,
  Segmented: (p: {
    label: string;
    value: string;
    options: { value: string; label: string }[];
    onChange: (v: string) => void;
  }) => (
    <div role="radiogroup" aria-label={p.label}>
      {p.options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={o.value === p.value}
          onClick={() => p.onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  ),
  Companion: () => null,
  DotText: () => null,
  useMedia: () => false,
  WIDE: '',
}));
vi.mock('./english-feedback', () => ({ playCue: vi.fn() }));
vi.mock('./parts', () => ({
  SecHead: ({ label, children }: { label: string; children?: ReactNode }) => (
    <h2>
      {label}
      {children}
    </h2>
  ),
}));
vi.mock('./english-verbs', async (original) => ({
  ...(await original<typeof import('./english-verbs')>()),
  ...mocks,
}));

const NEW: VerbProgress = {
  new: true,
  due: true,
  hard: false,
  learned: false,
  reps: 0,
  lapses: 0,
  interval_days: 0,
  due_on: null,
};
const verb = (
  id: string,
  v2: string,
  v3: string,
  group: string,
  progress: Partial<VerbProgress> = {},
): Verb => ({
  id,
  v1: id,
  v2,
  v3,
  v2_alt: id === 'get' ? [] : [],
  v3_alt: id === 'get' ? ['gotten'] : [],
  ru: `перевод ${id}`,
  group,
  progress: { ...NEW, ...progress },
});
const OLD = { new: false, reps: 2, interval_days: 3, due_on: '2026-11-15' };
const data: VerbsOverview = {
  groups: [
    { id: 'i-a-u', title_ru: 'i → a → u', hint: 'drink – drank – drunk' },
    { id: 'special', title_ru: 'Особенные', hint: 'be – was – been' },
  ],
  verbs: [
    verb('sing', 'sang', 'sung', 'i-a-u', { ...OLD, hard: true, lapses: 2 }),
    verb('swim', 'swam', 'swum', 'i-a-u', OLD),
    verb('get', 'got', 'got', 'special', OLD),
    verb('go', 'went', 'gone', 'special'),
  ],
  counts: { total: 4, started: 3, learned: 0, due: 3, hard: 1 },
  today: '2026-11-15',
};
const game = {
  xp: 2,
  xp_total: 10,
  minutes: 1,
  goal_minutes: 10,
  streak: 0,
  streak_up: false,
  ring_closed: false,
  quests_closed: false,
  unlocked: [],
};
const reply = (id: string, correct: boolean): VerbAnswered => {
  const v = data.verbs.find((x) => x.id === id)!;
  return {
    verb_id: id,
    correct,
    expected: { v1: v.v1, v2: v.v2, v3: v.v3 },
    progress: { ...v.progress, new: false },
    moved: true,
    game: { ...game, xp: correct ? 2 : 0 },
  };
};

function open() {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <EnglishVerbs />
    </QueryClientProvider>,
  );
}
const type = (v2: string, v3: string) => {
  fireEvent.change(screen.getByLabelText('Вторая форма (V2)'), { target: { value: v2 } });
  fireEvent.change(screen.getByLabelText('Третья форма (V3)'), { target: { value: v3 } });
  fireEvent.click(screen.getByRole('button', { name: 'Проверить' }));
};

beforeEach(() => {
  vi.resetAllMocks();
  localStorage.clear();
  mocks.useEnglishVerbs.mockReturnValue({ data, isError: false });
  mocks.answerVerb.mockImplementation((id: string) => Promise.resolve(reply(id, true)));
});

describe('вкладка «Глаголы»', () => {
  it('показывает счётчики, группы и состав группы', () => {
    open();
    expect(screen.getByText('Повторить сегодня: 3')).toBeInTheDocument();
    const counts = screen.getByRole('list', { name: 'Прогресс' });
    expect(within(counts).getByText('3').parentElement).toHaveTextContent('3 начато');
    expect(screen.getByRole('button', { name: 'Трудные: 1' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /i → a → u/ }));
    const sheet = screen.getByRole('dialog', { name: 'i → a → u' });
    expect(within(sheet).getByText('sing – sang – sung')).toBeInTheDocument();
    expect(within(sheet).getByText(/трудный · ошибок: 2/)).toBeInTheDocument();
    expect(within(sheet).getByText('swim – swam – swum')).toBeInTheDocument();
    expect(within(sheet).queryByText('go – went – gone')).not.toBeInTheDocument();
  });

  it('нет доступа — объясняет, а не падает', () => {
    mocks.useEnglishVerbs.mockReturnValue({
      data: undefined,
      isError: true,
      error: new Fail('denied', 'Нет доступа', 403),
    });
    open();
    expect(screen.getByText(/нет доступа к модулю/)).toBeInTheDocument();
  });

  it('вписать формы: трудный первым, ошибка возвращает глагол, новые сначала показывают', async () => {
    mocks.answerVerb.mockImplementationOnce(() => Promise.resolve(reply('sing', false)));
    open();
    fireEvent.click(screen.getByRole('button', { name: 'Повторить' }));

    // В занятии есть новый глагол — сначала его показывают.
    expect(screen.getByText('Посмотри и запомни')).toBeInTheDocument();
    expect(screen.getByText('go – went – gone')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Запомнил — проверь' }));

    expect(screen.getByText('Глагол 1 из 4')).toBeInTheDocument();
    expect(screen.getByText('sing')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Проверить' })).toBeDisabled();
    type('singed', 'sung');
    await waitFor(() =>
      expect(mocks.answerVerb).toHaveBeenCalledWith('sing', 'type', {
        given: { v2: 'singed', v3: 'sung' },
      }),
    );
    expect(await screen.findByText('Правильно: sing – sang – sung')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('Правильно: sang');
    fireEvent.click(screen.getByRole('button', { name: 'Дальше' }));

    // Ошибся — очередь выросла: sing вернётся после остальных.
    expect(screen.getByText('Глагол 2 из 5')).toBeInTheDocument();
    for (const [id, v2, v3] of [
      ['swim', 'swam', 'swum'],
      ['get', 'got', 'gotten'],
      ['go', 'went', 'gone'],
      ['sing', 'sang', 'sung'],
    ] as const) {
      expect(await screen.findByText(id)).toBeInTheDocument();
      type(v2, v3);
      expect(await screen.findByText('Верно!')).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: /Дальше|Итог/ }));
    }

    expect(await screen.findByText('Занятие закончено')).toBeInTheDocument();
    expect(screen.getByText('С первого раза: 3 из 4')).toBeInTheDocument();
    const result = screen.getByRole('region', { name: 'Итог занятия' });
    expect(within(result).getByText('sing – sang – sung')).toBeInTheDocument();
    expect(screen.getByText('+8 XP')).toBeInTheDocument();
    expect(mocks.answerVerb).toHaveBeenCalledTimes(5);
  });

  it('карточки: показать формы, оценка уходит на сервер, выбор запоминается', async () => {
    open();
    fireEvent.click(screen.getByRole('radio', { name: 'Карточки' }));
    expect(localStorage.getItem('qubite.english.verbs.study')).toBe('cards');
    fireEvent.click(screen.getByRole('button', { name: 'Трудные: 1' }));

    expect(screen.getByText('sing')).toBeInTheDocument();
    expect(screen.queryByText('sang · sung')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Показать формы' }));
    expect(screen.getByText('sang · sung')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Легко' }));
    await waitFor(() =>
      expect(mocks.answerVerb).toHaveBeenCalledWith('sing', 'cards', { grade: 'easy' }),
    );
    expect(await screen.findByText('Занятие закончено')).toBeInTheDocument();
  });

  it('сервер не ответил — ошибка видна, глагол остаётся на экране', async () => {
    mocks.answerVerb.mockRejectedValue(new Fail('network', 'Нет связи', 0));
    open();
    fireEvent.click(screen.getByRole('button', { name: 'Трудные: 1' }));
    type('sang', 'sung');
    expect(await screen.findByText('Нет связи')).toBeInTheDocument();
    expect(screen.getByText('Глагол 1 из 1')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Проверить' })).toBeEnabled();
  });

  it('фоновое обновление упало — загруженное остаётся на экране', () => {
    mocks.useEnglishVerbs.mockReturnValue({
      data,
      isError: true,
      error: new Fail('network', 'Нет связи', 0),
    });
    open();
    expect(screen.getByText('Повторить сегодня: 3')).toBeInTheDocument();
    expect(screen.queryByText('Нет связи')).not.toBeInTheDocument();
  });

  it('«Ещё глаголы» и сразу «Закрыть» — тренажёр не открывается сам', async () => {
    open();
    fireEvent.click(screen.getByRole('radio', { name: 'Карточки' }));
    fireEvent.click(screen.getByRole('button', { name: 'Трудные: 1' }));
    fireEvent.click(screen.getByRole('button', { name: 'Показать формы' }));
    fireEvent.click(screen.getByRole('button', { name: 'Знал' }));
    expect(await screen.findByText('Занятие закончено')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Ещё глаголы' }));
    fireEvent.click(screen.getByRole('button', { name: 'Закрыть' }));
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByRole('dialog', { name: 'Тренажёр глаголов' })).not.toBeInTheDocument();
    expect(screen.queryByText('Занятие закончено')).not.toBeInTheDocument();
  });
});
