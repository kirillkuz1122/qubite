import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Fail } from '../auth/client';
import { EnglishModule } from './EnglishLessons';
import type { Answered, Lesson, Run, Task } from './english-lessons';

const mocks = vi.hoisted(() => ({
  canRecord: vi.fn(),
  record: vi.fn(),
  useLesson: vi.fn(),
  startRun: vi.fn(),
  sendAnswer: vi.fn(),
  replaceVoiceTask: vi.fn(),
  finishRun: vi.fn(),
  markTask: vi.fn(),
}));

// Анимации и canvas проверяются отдельно в packages/ui; здесь — поведение игрока.
vi.mock('@qubite/ui', () => ({
  Button: (p: ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button type={p.type ?? 'button'} disabled={p.disabled} onClick={p.onClick}>
      {p.children}
    </button>
  ),
  Field: (p: InputHTMLAttributes<HTMLInputElement> & { label: string }) => (
    <label>
      {p.label}
      <input value={p.value} onChange={p.onChange} disabled={p.disabled} />
    </label>
  ),
  Note: ({ children }: { children: ReactNode }) => <p>{children}</p>,
  Presence: ({ children, show }: { children: ReactNode; show: boolean }) => (show ? children : null),
  Swap: ({ children }: { children: ReactNode }) => children,
  Sheet: ({ children, open }: { children: ReactNode; open: boolean }) =>
    open ? <div>{children}</div> : null,
  Segmented: () => null,
  Companion: () => null,
  DotIcon: () => null,
  useMedia: () => false,
  WIDE: '',
}));
vi.mock('./english-feedback', () => ({
  playCue: vi.fn(),
  readFeedback: vi.fn(),
  writeFeedback: vi.fn(),
}));
vi.mock('./LimitLink', () => ({ LimitLink: () => null }));
vi.mock('./english', () => ({ canRecord: mocks.canRecord, record: mocks.record }));
vi.mock('./english-lessons', async (original) => ({
  ...(await original<typeof import('./english-lessons')>()),
  ...mocks,
  useEnglishHome: () => ({ data: undefined, isError: false }),
}));
vi.mock('./english-dictation', () => ({
  useDictation: () => ({ state: 'idle', error: null, partial: '' }),
}));

const run: Run = { id: 'run', lesson_id: 'one', kind: 'lesson', tasks: [], answers: [] };
const spokenTask: Task = {
  id: 'voice',
  type: 'speak',
  mode: 'repeat',
  say: 'Hello Nate.',
  ask_ru: 'Повтори фразу.',
};
const writtenTask: Task = {
  id: 'voice',
  type: 'build',
  answer_by: 'text',
  answer: 'Hello Nate.',
  ask_ru: 'Собери фразу.',
};
const answered: Answered = {
  task_id: 'voice',
  correct: true,
  attempts: 1,
  right: null,
  explain_ru: null,
  say: null,
  mistakes: [],
  heard: null,
  offline: false,
  game: {
    xp: 0,
    xp_total: 0,
    minutes: 0,
    goal_minutes: 10,
    streak: 0,
    streak_up: false,
    ring_closed: false,
    quests_closed: false,
    unlocked: [],
  },
};

function open(task: Task, rest: Task[] = []) {
  const lesson: Lesson = {
    id: 'one',
    level: 'a0',
    title: { ru: 'Знакомство', en: 'Hello' },
    goal_ru: 'Поздороваться',
    words: [],
    grammar: {
      title_ru: 'Привет',
      explain_ru: 'Говорим hello.',
      examples: [],
      mistakes: [],
    },
    tasks: [task, ...rest],
    pass: { min_accuracy: 0.7, min_speak: 0, about_ru: 'Реши задания.' },
  };
  mocks.useLesson.mockReturnValue({
    data: { lesson, level: { tutor_mode: 'ru_heavy' } },
    isError: false,
  });
  history.replaceState(null, '', '/agent?tab=english&lesson=one');
  render(
    <QueryClientProvider client={new QueryClient()}>
      <EnglishModule />
    </QueryClientProvider>,
  );
  fireEvent.click(screen.getByRole('button', { name: 'К заданиям' }));
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.canRecord.mockReturnValue(true);
  mocks.startRun.mockResolvedValue(run);
  mocks.sendAnswer.mockResolvedValue(answered);
  mocks.replaceVoiceTask.mockResolvedValue({
    ...run,
    replacements: [{ lesson_id: 'one', task: writtenTask }],
  });
  mocks.finishRun.mockRejectedValue(new Fail('network', 'Нет связи', 0));
  mocks.markTask.mockResolvedValue({ action: 'mark', summary_ru: 'Нейт решит после урока.' });
});

describe('игрок урока: микрофон и полоса ответа', () => {
  it('getUserMedia отказал: видна причина и замена, попытка ответа не отправлена', async () => {
    mocks.record.mockRejectedValue(new DOMException('Permission denied', 'NotAllowedError'));
    open(spokenTask);
    fireEvent.click(await screen.findByRole('button', { name: 'Говорить' }));
    await waitFor(() => expect(mocks.replaceVoiceTask).toHaveBeenCalledWith('run', 'voice', null));
    expect(await screen.findByText('Собери фразу.')).toBeInTheDocument();
    expect(screen.getByText(/Микрофон недоступен/)).toBeInTheDocument();
    expect(mocks.sendAnswer).not.toHaveBeenCalled();
    expect(screen.queryByLabelText('Ответ по-английски')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Проверить' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Hello' }));
    fireEvent.click(screen.getByRole('button', { name: 'Nate.' }));
    fireEvent.click(screen.getByRole('button', { name: 'Проверить' }));
    await waitFor(() =>
      expect(mocks.sendAnswer).toHaveBeenCalledWith('run', 'voice', { value: 'Hello Nate.' }, null),
    );
    expect(await screen.findByRole('button', { name: 'Закончить' })).toBeInTheDocument();
  });

  it('нет API записи: замена запрашивается сразу', async () => {
    mocks.canRecord.mockReturnValue(false);
    open(spokenTask);
    expect(await screen.findByText('Собери фразу.')).toBeInTheDocument();
    expect(mocks.replaceVoiceTask).toHaveBeenCalledTimes(1);
    expect(mocks.record).not.toHaveBeenCalled();
    expect(mocks.sendAnswer).not.toHaveBeenCalled();
  });

  it('ошибка получения замены видна, можно повторить; штрафа и ответа нет', async () => {
    mocks.canRecord.mockReturnValue(false);
    mocks.replaceVoiceTask.mockRejectedValueOnce(new Fail('network', 'Нет связи', 0));
    open(spokenTask);
    fireEvent.click(await screen.findByRole('button', { name: 'Повторить замену' }));
    expect(await screen.findByText('Собери фразу.')).toBeInTheDocument();
    expect(mocks.replaceVoiceTask).toHaveBeenCalledTimes(2);
    expect(mocks.sendAnswer).not.toHaveBeenCalled();
  });

  it('voice_or_text при отказе микрофона остаётся текстовым заданием', async () => {
    mocks.record.mockRejectedValue(new DOMException('Permission denied', 'NotAllowedError'));
    open({ ...spokenTask, answer_by: 'voice_or_text' });
    fireEvent.click(await screen.findByRole('button', { name: 'Говорить' }));
    const input = await screen.findByLabelText('Ответ по-английски');
    expect(screen.getByRole('button', { name: 'Проверить' })).toBeDisabled();
    fireEvent.change(input, { target: { value: 'Hello Nate.' } });
    expect(screen.getByRole('button', { name: 'Проверить' })).toBeEnabled();
    expect(mocks.replaceVoiceTask).not.toHaveBeenCalled();
    expect(mocks.sendAnswer).not.toHaveBeenCalled();
  });

  it('ошибка завершения сохраняет результат и кнопку повтора завершения', async () => {
    open({ id: 'choice', type: 'choose', ask_ru: 'Выбери приветствие.', options: ['Hello'] });
    fireEvent.click(await screen.findByRole('button', { name: 'Hello' }));
    expect(await screen.findByText('Верно!', { selector: 'footer p' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Проверить' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Закончить' }));
    expect(await screen.findByText('Нет связи')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Закончить' })).toBeEnabled();
  });

  it('«Спросить Нейта» по умолчанию свёрнут', async () => {
    open(writtenTask);
    await screen.findByText('Собери фразу.');
    expect(screen.queryByLabelText('Спросить Нейта (можно по-русски)')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Спросить Нейта' }));
    expect(screen.getByLabelText('Спросить Нейта (можно по-русски)')).toBeInTheDocument();
  });

  it('две отметки «легко» не пропускают задания и предлагают сменить порядок', async () => {
    const choice = (id: string): Task => ({
      id,
      type: 'choose',
      ask_ru: `Выбери: ${id}`,
      options: ['Hello'],
    });
    open(choice('first'), [choice('second'), choice('third')]);
    fireEvent.click(await screen.findByRole('button', { name: 'Что-то не так?' }));
    fireEvent.click(screen.getByRole('button', { name: /Слишком легко/ }));
    await screen.findByRole('button', { name: 'Отмечено: слишком легко' });
    expect(screen.queryByRole('button', { name: 'Давай' })).not.toBeInTheDocument();
    expect(mocks.sendAnswer).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Hello' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Дальше' }));
    fireEvent.click(screen.getByRole('button', { name: 'Что-то не так?' }));
    fireEvent.click(screen.getByRole('button', { name: /Слишком легко/ }));
    expect(await screen.findByRole('button', { name: 'Давай' })).toBeInTheDocument();
    expect(screen.getByText('Выбери: second')).toBeInTheDocument();
    expect(mocks.sendAnswer).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Не сейчас' }));
    expect(screen.queryByRole('button', { name: 'Давай' })).not.toBeInTheDocument();
  });
});
