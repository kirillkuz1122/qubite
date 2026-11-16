import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Fail } from '../auth/client';
import { EnglishVerbs } from './EnglishVerbs';
import type { Verb, VerbAnswered, VerbProgress, VerbsOverview } from './english-verbs';
import { wordGrid } from './english-verbs-games';

const mocks = vi.hoisted(() => ({
  useEnglishVerbs: vi.fn(),
  answerVerb: vi.fn(),
  recognizeVerbs: vi.fn(),
  createVerbSet: vi.fn(),
  deleteVerbSet: vi.fn(),
  dictation: { state: 'idle', partial: '', error: null as string | null },
  start: vi.fn(),
  stop: vi.fn(),
  canRecord: vi.fn(),
}));

// Анимации и canvas проверяются в packages/ui; здесь — поведение игр и своих наборов.
vi.mock('@qubite/ui', () => ({
  Button: (
    p: ButtonHTMLAttributes<HTMLButtonElement> & { 'data-state'?: string; variant?: string },
  ) => (
    <button
      type={p.type ?? 'button'}
      form={p.form}
      disabled={p.disabled}
      aria-label={p['aria-label']}
      aria-pressed={p['aria-pressed']}
      data-state={p['data-state']}
      onClick={p.onClick}
    >
      {p.children}
    </button>
  ),
  Field: (p: InputHTMLAttributes<HTMLInputElement> & { label: string }) => (
    <label>
      {p.label}
      <input value={p.value} onChange={p.onChange} disabled={p.disabled} />
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
  useMedia: () => false,
  WIDE: '',
}));
vi.mock('./english-feedback', () => ({ playCue: vi.fn() }));
vi.mock('./LimitLink', () => ({ LimitLink: () => null }));
vi.mock('./english', () => ({ canRecord: mocks.canRecord }));
vi.mock('./english-dictation', () => ({
  useDictation: () => ({
    ...mocks.dictation,
    start: mocks.start,
    stop: mocks.stop,
    cancel: vi.fn(),
  }),
}));
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
  useEnglishVerbs: mocks.useEnglishVerbs,
  answerVerb: mocks.answerVerb,
  recognizeVerbs: mocks.recognizeVerbs,
  createVerbSet: mocks.createVerbSet,
  deleteVerbSet: mocks.deleteVerbSet,
}));

const OLD: VerbProgress = {
  new: false,
  due: true,
  hard: false,
  learned: false,
  reps: 2,
  lapses: 0,
  interval_days: 3,
  due_on: '2026-11-15',
};
const verb = (id: string, v2: string, v3: string, group: string): Verb => ({
  id,
  v1: id,
  v2,
  v3,
  v2_alt: [],
  v3_alt: [],
  ru: `перевод ${id}`,
  group,
  progress: OLD,
});
const data: VerbsOverview = {
  groups: [{ id: 'main', title_ru: 'Главные', hint: 'do – did – done' }],
  verbs: [
    verb('sing', 'sang', 'sung', 'main'),
    verb('go', 'went', 'gone', 'main'),
    verb('take', 'took', 'taken', 'main'),
  ],
  sets: [],
  counts: { total: 3, started: 3, learned: 0, due: 3, hard: 0 },
  today: '2026-11-16',
};
const game = {
  xp: 1,
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
    progress: v.progress,
    moved: true,
    game: { ...game, xp: correct ? 1 : 0 },
  };
};

function open() {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <EnglishVerbs />
    </QueryClientProvider>,
  );
}
const play = (name: RegExp) => fireEvent.click(screen.getByRole('button', { name }));
const result = () => screen.findByRole('region', { name: 'Итог занятия' });

beforeEach(() => {
  vi.resetAllMocks();
  localStorage.clear();
  mocks.dictation.state = 'idle';
  mocks.dictation.partial = '';
  mocks.canRecord.mockReturnValue(true);
  mocks.useEnglishVerbs.mockReturnValue({ data, isError: false });
  mocks.answerVerb.mockImplementation((id: string, _mode: string, r: { correct?: boolean }) =>
    Promise.resolve(reply(id, r.correct ?? true)),
  );
  // Занятие и игры берут зерно из времени начала — закрепляем раскладку.
  vi.spyOn(Date, 'now').mockReturnValue(1_800_000_000_000);
});
afterEach(() => {
  vi.useRealTimers();
});

describe('игры с глаголами', () => {
  it('«Соедини»: неверная пара делает оба глагола ошибкой, итог уходит на сервер', async () => {
    open();
    play(/^Соедини/);
    const left = screen.getByRole('group', { name: 'Первая форма' });
    const right = screen.getByRole('group', { name: 'Вторая и третья форма' });
    const pair = (v1: string, forms: string) => {
      fireEvent.click(within(left).getByRole('button', { name: v1 }));
      fireEvent.click(within(right).getByRole('button', { name: forms }));
    };
    pair('sing', 'went · gone');
    expect(screen.getByText('Это не пара. Попробуй ещё раз.')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText(/Это не пара/)).not.toBeInTheDocument(), {
      timeout: 2000,
    });
    pair('sing', 'sang · sung');
    pair('go', 'went · gone');
    expect(screen.getByText('Пар: 2 из 3')).toBeInTheDocument();
    pair('take', 'took · taken');

    const card = await result();
    expect(within(card).getByText('С первого раза: 1 из 3')).toBeInTheDocument();
    expect(mocks.answerVerb.mock.calls).toEqual([
      ['sing', 'match', { correct: false }],
      ['go', 'match', { correct: false }],
      ['take', 'match', { correct: true }],
    ]);
  });

  it('«Викторина»: вариант уходит как «верно / неверно», верный подсвечен', async () => {
    open();
    play(/^Викторина/);
    const options = within(screen.getByRole('group', { name: 'Варианты' })).getAllByRole('button');
    expect(options).toHaveLength(4);
    const asked = screen.getByText(/Какая (вторая|третья) форма/).textContent ?? '';
    const shown = document.querySelector('.vb-word')?.textContent as string;
    const v = data.verbs.find((x) => x.id === shown)!;
    const answer = asked.includes('вторая') ? v.v2 : v.v3;
    const wrong = options.find((o) => o.textContent !== answer)!;
    fireEvent.click(wrong);
    expect(await screen.findByText(`Правильно: ${v.v1} – ${v.v2} – ${v.v3}`)).toBeInTheDocument();
    expect(mocks.answerVerb).toHaveBeenCalledWith(shown, 'quiz', { correct: false });
    expect(screen.getByRole('button', { name: answer })).toHaveAttribute('data-state', 'ok');
    expect(wrong).toHaveAttribute('data-state', 'bad');
  });

  it('«Анаграмма»: слово собирается из букв, букву можно убрать', async () => {
    open();
    play(/^Анаграмма/);
    const shown = document.querySelector('.vb-word')?.textContent as string;
    const v = data.verbs.find((x) => x.id === shown)!;
    const form = (screen.getByText(/Собери из букв/).textContent ?? '').includes('вторую')
      ? v.v2
      : v.v3;
    const letters = () => screen.getByRole('group', { name: 'Буквы' });
    expect(screen.getByRole('button', { name: 'Проверить' })).toBeDisabled();
    // Сначала не та буква — убираем её из собранного.
    const first = within(letters()).getAllByRole('button')[0]!;
    fireEvent.click(first);
    fireEvent.click(
      within(screen.getByRole('group', { name: 'Собрано' })).getByRole('button', {
        name: /убрать/,
      }),
    );
    for (const letter of form) {
      const free = within(letters())
        .getAllByRole('button')
        .find((b) => b.textContent === letter && !(b as HTMLButtonElement).disabled)!;
      fireEvent.click(free);
    }
    fireEvent.click(screen.getByRole('button', { name: 'Проверить' }));
    expect(await screen.findByText('Верно!')).toBeInTheDocument();
    expect(mocks.answerVerb).toHaveBeenCalledWith(shown, 'anagram', { correct: true });
  });

  it('«На время»: минута идёт, ответы копятся, в конце — итог по глаголам', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    open();
    play(/^На время/);
    fireEvent.click(screen.getByRole('button', { name: 'Начать' }));
    expect(screen.getByText('0:60 · верно: 0')).toBeInTheDocument();
    // Всегда «Верно»: часть карточек с подменой — там это ошибка.
    for (let i = 0; i < 6; i++) fireEvent.click(screen.getByRole('button', { name: 'Верно' }));
    act(() => {
      vi.advanceTimersByTime(30_000);
    });
    expect(screen.getByText(/^0:30 · верно: \d$/)).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(30_000);
    });
    vi.useRealTimers();
    await result();
    const sent = mocks.answerVerb.mock.calls.map((c) => [c[0], c[1]]);
    expect(sent).toEqual([
      ['sing', 'sprint'],
      ['go', 'sprint'],
      ['take', 'sprint'],
    ]);
    // Времени нет — кнопки игры исчезли.
    expect(screen.queryByRole('button', { name: 'Верно' })).not.toBeInTheDocument();
  });

  it('«Поиск слов»: первая и последняя буква; «Сдаюсь» — ненайденные в ошибки', async () => {
    open();
    play(/^Поиск слов/);
    const cells = screen.getAllByRole('gridcell');
    expect(cells).toHaveLength(49);
    expect(screen.getByText('Найдено: 0 из 3')).toBeInTheDocument();
    // Раскладку знаем: то же зерно, что у игры. Ищем по буквам первое спрятанное слово.
    const letters = cells.map((c) => c.textContent ?? '');
    const rows = Array.from({ length: 7 }, (_, r) => letters.slice(r * 7, r * 7 + 7));
    const words = ['sang', 'sung', 'went', 'gone', 'took', 'taken'];
    const spot = (() => {
      for (const word of words) {
        for (let r = 0; r < 7; r++) {
          for (let c = 0; c < 7; c++) {
            const across = rows[r]!.slice(c, c + word.length).join('');
            if (across === word) return { word, from: r * 7 + c, to: r * 7 + c + word.length - 1 };
            const down = Array.from({ length: word.length }, (_, i) => rows[r + i]?.[c]).join('');
            if (down === word) return { word, from: r * 7 + c, to: (r + word.length - 1) * 7 + c };
          }
        }
      }
      return null;
    })()!;
    expect(spot).not.toBeNull();
    // Мимо: две соседние клетки — не слово.
    fireEvent.click(cells[spot.from]!);
    fireEvent.click(cells[spot.from === 0 ? 1 : spot.from - 1]!);
    expect(screen.getByText(/Здесь формы нет/)).toBeInTheDocument();
    fireEvent.click(cells[spot.from]!);
    fireEvent.click(cells[spot.to]!);
    expect(screen.getByText('Найдено: 1 из 3')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Сдаюсь' }));
    const card = await result();
    expect(within(card).getByText('С первого раза: 1 из 3')).toBeInTheDocument();
    expect(mocks.answerVerb.mock.calls.filter((c) => c[2].correct)).toHaveLength(1);
    expect(wordGrid([{ verb: 'go', word: 'went' }], 'x').placed).toHaveLength(1);
  });

  it('сервер не ответил посреди раунда — можно записать ещё раз с того же места', async () => {
    mocks.answerVerb
      .mockResolvedValueOnce(reply('sing', true))
      .mockRejectedValueOnce(new Fail('network', 'Нет связи', 0));
    open();
    play(/^Соедини/);
    const left = screen.getByRole('group', { name: 'Первая форма' });
    const right = screen.getByRole('group', { name: 'Вторая и третья форма' });
    for (const [v1, forms] of [
      ['sing', 'sang · sung'],
      ['go', 'went · gone'],
      ['take', 'took · taken'],
    ] as const) {
      fireEvent.click(within(left).getByRole('button', { name: v1 }));
      fireEvent.click(within(right).getByRole('button', { name: forms }));
    }
    expect(await screen.findByText('Нет связи')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Записать ещё раз' }));
    const card = await result();
    expect(within(card).getByText('С первого раза: 3 из 3')).toBeInTheDocument();
    expect(mocks.answerVerb.mock.calls.map((c) => c[0])).toEqual(['sing', 'go', 'go', 'take']);
  });
});

describe('вслух и свои наборы', () => {
  it('вслух: сказанное уходит на сервер, видно, что услышал Нейт', async () => {
    // Диктовка уже идёт: «Готово» останавливает её и отдаёт сказанное.
    mocks.dictation.state = 'listening';
    mocks.dictation.partial = 'sing sang';
    mocks.stop.mockResolvedValue(' sing sang sung ');
    open();
    fireEvent.click(screen.getByRole('radio', { name: 'Вслух' }));
    fireEvent.click(screen.getByRole('button', { name: 'Повторить' }));
    expect(screen.getByText('Нейт слушает: «sing sang»')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Готово' }));
    await waitFor(() =>
      expect(mocks.answerVerb).toHaveBeenCalledWith('sing', 'speak', { said: 'sing sang sung' }),
    );
    expect(await screen.findByText('«sing sang sung»')).toBeInTheDocument();
    expect(screen.getByText('Верно!')).toBeInTheDocument();
  });

  it('вслух без микрофона: кнопка выключена, есть объяснение', () => {
    mocks.canRecord.mockReturnValue(false);
    open();
    fireEvent.click(screen.getByRole('radio', { name: 'Вслух' }));
    fireEvent.click(screen.getByRole('button', { name: 'Повторить' }));
    expect(screen.getByRole('button', { name: 'Сказать' })).toBeDisabled();
    expect(screen.getByText(/Микрофон здесь недоступен/)).toBeInTheDocument();
  });

  it('свои слова: список → проверка → набор; набор открывается и удаляется', async () => {
    const found = [
      { v1: 'go', v2: 'went', v3: 'gone', ru: 'идти', known: 'go' },
      { v1: 'google', v2: 'googled', v3: 'googled', ru: 'гуглить', known: null },
      { v1: 'spam', v2: 'spammed', v3: 'spammed', ru: '', known: null },
    ];
    mocks.recognizeVerbs.mockResolvedValue(found);
    const saved: VerbsOverview = {
      ...data,
      verbs: [...data.verbs, { ...verb('my:google', 'googled', 'googled', 'my'), v1: 'google' }],
      sets: [
        {
          id: 'set-1',
          title: 'Домашка',
          source: 'text',
          verb_ids: ['go', 'my:google'],
          created_at: '2026-11-16T10:00:00Z',
        },
      ],
    };
    mocks.createVerbSet.mockResolvedValue(saved);
    mocks.deleteVerbSet.mockResolvedValue(data);
    const client = new QueryClient();
    mocks.useEnglishVerbs.mockImplementation(() => ({
      data: client.getQueryData<VerbsOverview>(['english', 'verbs']) ?? data,
      isError: false,
    }));
    const view = render(
      <QueryClientProvider client={client}>
        <EnglishVerbs />
      </QueryClientProvider>,
    );
    const again = () =>
      view.rerender(
        <QueryClientProvider client={client}>
          <EnglishVerbs />
        </QueryClientProvider>,
      );

    expect(screen.getByText(/Добавь свои слова списком или с фото/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Добавить' }));
    const sheet = screen.getByRole('dialog', { name: 'Свои слова' });
    expect(within(sheet).getByRole('button', { name: 'Найти глаголы' })).toBeDisabled();
    fireEvent.change(within(sheet).getByRole('textbox'), {
      target: { value: 'go\ngoogle – googled – googled – гуглить\nspam spammed spammed' },
    });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Найти глаголы' }));
    expect(await within(sheet).findByText('Нашёл глаголов: 3.', { exact: false })).toBeVisible();
    expect(mocks.recognizeVerbs).toHaveBeenCalledWith({
      text: 'go\ngoogle – googled – googled – гуглить\nspam spammed spammed',
    });
    expect(within(sheet).getByText(/идти · есть в Qubite/)).toBeInTheDocument();
    fireEvent.click(within(sheet).getByRole('button', { name: 'Убрать spam' }));
    fireEvent.change(within(sheet).getByLabelText('Название набора'), {
      target: { value: 'Домашка' },
    });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Сохранить набор' }));
    await waitFor(() =>
      expect(mocks.createVerbSet).toHaveBeenCalledWith('Домашка', 'text', found.slice(0, 2)),
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    again();

    // Набор появился в списке; из его окна — учить или удалить.
    fireEvent.click(screen.getByRole('button', { name: /Домашка/ }));
    const set = screen.getByRole('dialog', { name: 'Домашка' });
    expect(within(set).getByText('google – googled – googled')).toBeInTheDocument();
    expect(within(set).getByRole('button', { name: 'Учить набор' })).toBeInTheDocument();
    fireEvent.click(within(set).getByRole('button', { name: 'Удалить набор' }));
    await waitFor(() => expect(mocks.deleteVerbSet).toHaveBeenCalledWith('set-1'));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('свои слова: фото уходит на распознавание, отказ AI виден', async () => {
    mocks.recognizeVerbs.mockRejectedValue(
      new Fail('budget_exhausted', 'Лимит на сегодня исчерпан', 409),
    );
    open();
    fireEvent.click(screen.getByRole('button', { name: 'Добавить' }));
    const photo = new File(['JPEG'], 'board.jpg', { type: 'image/jpeg' });
    fireEvent.change(screen.getByLabelText('Фото со словами'), { target: { files: [photo] } });
    await waitFor(() => expect(mocks.recognizeVerbs).toHaveBeenCalledTimes(1));
    const sent = mocks.recognizeVerbs.mock.calls[0]![0] as { image: Blob };
    expect(sent.image.type).toBe('image/jpeg');
    expect(await screen.findByText(/Лимит на сегодня исчерпан/)).toBeInTheDocument();
  });
});
