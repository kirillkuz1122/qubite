/** Уроки английского (ENG-002): чистые функции экрана — плитки, подписи, кольцо, порядок. */
import type {
  AnswerBy,
  Answered,
  Game,
  Lesson,
  Level,
  Run,
  Step,
  Task,
  Mark,
} from './english-lessons';

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
      return t.mode === 'repeat'
        ? 'Повтори вслух'
        : t.mode === 'transform'
          ? 'Переделай фразу'
          : 'Ответь вслух';
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
  const replacement = (task: Task, lessonId: string) =>
    run.replacements?.find((r) => r.lesson_id === lessonId && r.task.id === task.id)?.task ?? task;
  if (run.kind === 'review')
    return run.tasks.map((t) => ({
      lesson: t.lesson_id,
      task: replacement(t.task, t.lesson_id),
      wrong: t.wrong,
    }));
  const list = run.kind === 'homework' ? (lesson?.homework?.tasks ?? []) : (lesson?.tasks ?? []);
  return list.map((task) => ({ lesson: null, task: replacement(task, run.lesson_id) }));
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
  return made.map((pair) => pairOk(task, pair));
}

/** Проверяем пару сразу, независимо от порядка выбора колонок. */
export function pairOk(task: Task, [en, ru]: Pair): boolean {
  return (task.pairs ?? []).some((p) => p.en === en && p.ru === ru);
}

/**
 * Сервер сверяет полный набор пар. Сохраняем первую реальную ошибку вместо исправленной
 * пары с тем же английским словом: задание не станет безошибочным после подбора.
 */
export function matchReply(made: readonly Pair[], mistake: Pair | null): Pair[] {
  return made.map((pair) => (mistake && pair[0] === mistake[0] ? mistake : pair));
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

/**
 * Как отвечать (ENG-006, как `course::answer_by` на сервере): перевод на английский и
 * «вставь слово» — текстом (написание, грамматика), как и ответ буква в букву (число на слух);
 * понимание и разговор — голосом или текстом; «повтори вслух» — голосом (произношение).
 */
export function answerBy(t: Task): AnswerBy {
  if (t.answer_by) return t.answer_by;
  switch (t.type) {
    case 'translate':
      return t.from === 'en' ? 'voice_or_text' : 'text';
    case 'speak':
      return t.mode === 'repeat' ? 'voice' : 'voice_or_text';
    case 'describe_image':
    case 'roleplay':
      return 'voice_or_text';
    default:
      return 'text';
  }
}

/** Почему здесь текстом — подсказка под полем. */
export const WHY_TEXT = 'Здесь — текстом: тренируем написание и порядок слов.';

/**
 * «Исправь свою фразу» (ENG-006): после ошибки — что не так, но без готового ответа, чтобы
 * исправить самому. Нет разбора от Нейта — ничего.
 */
export function fixHint(a: Pick<Answered, 'correct' | 'mistakes' | 'explain_ru'> | null): string[] {
  if (!a || a.correct) return [];
  const list = a.mistakes.map((m) => (m.why ? `«${m.wrong}» — ${m.why}` : `«${m.wrong}»`));
  if (list.length === 0 && a.explain_ru) list.push(a.explain_ru);
  return list;
}

/** Нижняя полоса: выбор и пары отправляются сразу, остальные ждут проверки. */
export function answerBar(task: Task, answered: boolean, ready: boolean, busy: boolean) {
  if (answered) return { action: 'next' as const, disabled: busy };
  const immediate =
    task.type === 'match' ||
    ((task.type === 'choose' || task.type === 'listen' || task.type === 'fill') &&
      !!task.options?.length);
  return {
    action: immediate ? ('wait' as const) : ('check' as const),
    disabled: busy || !ready,
  };
}

/** Считаем разные соседние задания; без отметки или «трудно» цепочка обрывается. */
export function consecutiveEasy(marks: readonly (Mark | null)[]): number {
  return marks.reduce((count, mark) => (mark === 'easy' ? count + 1 : 0), 0);
}

/** Без микрофона «только голос» заменяем, «голос или текст» оставляем текстом. */
export function microphoneFallback(task: Task): 'replace' | 'text' {
  return answerBy(task) === 'voice' ? 'replace' : 'text';
}

/** Сначала сложные из оставшихся, без пропуска: свой ответ труднее сборки и выбора. */
export function harderFirst<T extends { task: Task }>(list: readonly T[], from: number): T[] {
  const difficulty = (t: Task) =>
    spoken(t) && t.mode !== 'repeat'
      ? 3
      : ['translate', 'build', 'fill'].includes(t.type)
        ? 2
        : 1;
  return [
    ...list.slice(0, from),
    ...list.slice(from).sort((a, b) => difficulty(b.task) - difficulty(a.task)),
  ];
}
