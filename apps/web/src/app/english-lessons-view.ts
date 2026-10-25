/** Уроки английского (ENG-002): чистые функции экрана — плитки, подписи, кольцо, порядок. */
import type { Game, Lesson, Level, Run, Step, Task } from './english-lessons';

/** Перемешать стабильно (по id задания): плитки не прыгают при перерисовке. */
export function shuffle<T>(list: readonly T[], seed: string): T[] {
  let h = 2166136261;
  for (const c of seed) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    const j = Math.abs(h) % (i + 1);
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

/** Плитки «собери фразу»: слова ответа и лишние, перемешаны. */
export function tiles(task: Task): string[] {
  const words = (task.answer ?? '').split(/\s+/).filter(Boolean);
  return shuffle([...words, ...(task.extra ?? [])], task.id);
}

/** Сколько пропусков в «вставь слово». */
export function gaps(text: string): string[] {
  return text.split('___');
}

/** Как называется вид задания. */
export function kindLabel(t: Task): string {
  switch (t.type) {
    case 'choose':
      return 'Выбери';
    case 'match':
      return 'Соедини пары';
    case 'build':
      return 'Собери фразу';
    case 'translate':
      return 'Переведи';
    case 'fill':
      return 'Вставь слово';
    case 'listen':
      return 'На слух';
    case 'speak':
      return t.mode === 'repeat' ? 'Повтори вслух' : 'Ответь вслух';
    case 'describe_image':
      return 'Опиши картинку';
    case 'roleplay':
      return 'Роль';
  }
}

/** Задание говорят вслух (микрофон или текстом, если его нет). */
export const spoken = (t: Task) =>
  t.type === 'speak' || t.type === 'describe_image' || t.type === 'roleplay';

/** Теория на языке уровня (D-491): с нуля — по-русски, A2 — по-английски и русская опора. */
export function theory(lesson: Lesson, level: Level): { main: string; second: string | null } {
  const ru = lesson.grammar.explain_ru;
  const en = lesson.grammar.explain_en ?? null;
  if (level.tutor_mode === 'ru_heavy' || level.tutor_mode === 'ru_support' || !en) {
    return { main: ru, second: level.tutor_mode === 'ru_support' ? en : null };
  }
  return { main: en, second: ru };
}

/** Задания прохождения: урок, домашка или повторение. */
export function runTasks(
  lesson: Lesson | null,
  run: Run,
): { lesson: string | null; task: Task; wrong?: string }[] {
  if (run.kind === 'review')
    return run.tasks.map((t) => ({ lesson: t.lesson_id, task: t.task, wrong: t.wrong }));
  const list = run.kind === 'homework' ? (lesson?.homework?.tasks ?? []) : (lesson?.tasks ?? []);
  return list.map((task) => ({ lesson: null, task }));
}

/** С какого задания продолжить: первое без верного ответа. */
export function resumeAt(run: Run, list: { task: Task; lesson: string | null }[]): number {
  const done = new Set(run.answers.filter((a) => a.correct).map((a) => a.task_id));
  const i = list.findIndex((x) => !done.has(x.task.id));
  return i < 0 ? list.length : i;
}

/** Кольцо дня: доля цели от 0 до 1. */
export function ring(g: Pick<Game, 'minutes_today' | 'goal_minutes'>): number {
  if (g.goal_minutes <= 0) return 0;
  return Math.min(1, g.minutes_today / g.goal_minutes);
}

/** «3 дня», «1 день», «5 дней». */
export function days(n: number): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return `${n} день`;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return `${n} дня`;
  return `${n} дней`;
}

/** Уроки по модулям уровня (для пути на главной). */
export function byModule(steps: Step[], level: string): { title: string; steps: Step[] }[] {
  const out: { title: string; steps: Step[] }[] = [];
  for (const s of steps.filter((x) => x.level === level)) {
    const last = out.at(-1);
    if (last && last.steps[0]!.module === s.module) last.steps.push(s);
    else out.push({ title: s.module_title_ru, steps: [s] });
  }
  return out;
}

export const WEEKDAYS = ['пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс'];

/** Пара «Соедини»: английское и перевод. */
export type Pair = [string, string];

/** Сколько цветов у пар «Соедини»: дальше цвета повторяются, номер — нет. */
export const PAIR_TONES = 4;

/** Правые слова «Соедини» — перемешаны стабильно, не по алфавиту (иначе порядок подсказывает). */
export function matchRight(task: Task): string[] {
  return shuffle(
    (task.pairs ?? []).map((p) => p.ru),
    `${task.id}:ru`,
  );
}

/** Верна ли каждая соединённая пара (по парам задания). */
export function pairsOk(task: Task, made: readonly Pair[]): boolean[] {
  const right = task.pairs ?? [];
  return made.map(([en, ru]) => right.some((p) => p.en === en && p.ru === ru));
}

/**
 * Состояние варианта после ответа: выбранный неверный — `bad`, верный — `ok`,
 * пока ответа нет — выбранный `picked`.
 */
export function optionState(
  option: string,
  picked: string | null,
  verdict: { correct: boolean; right: string | null } | null,
): 'ok' | 'bad' | 'picked' | undefined {
  if (!verdict) return option === picked ? 'picked' : undefined;
  if (option === picked) return verdict.correct ? 'ok' : 'bad';
  if (!verdict.correct && verdict.right !== null && option === verdict.right) return 'ok';
  return undefined;
}

/** Вопрос Нейту «объясни задание»: что спросили, что ответил, как правильно. */
export function explainAsk(
  task: Task,
  answer: { correct: boolean; right: string | null } | null,
): string {
  const what = [task.ask_ru, task.question, task.text, task.from_ru, task.say]
    .filter(Boolean)
    .join(' ');
  const right = answer && !answer.correct && answer.right ? ` Правильно: ${answer.right}.` : '';
  return `Объясни это задание простыми словами по-русски: ${what}.${right}`.slice(0, 1000);
}
