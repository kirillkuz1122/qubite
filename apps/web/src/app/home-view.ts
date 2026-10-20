/**
 * Главная (HOME-001): чистые функции — ближайшие сроки, куда ведёт пункт сводки, подписи
 * погоды и курсов. Их проверяют юнит-тесты.
 */
import type { PlannerProject, PlannerTask } from '@qubite/sync-client';
import type { ColorName } from '@qubite/ui';
import { WD_SHORT, plural, weekday, type SectionId } from './data';
import type { HomeDigestItem } from './home';
import { NO_PROJECT, iso } from './planner-view';

/** На сколько дней вперёд смотрят «ближайшие сроки». */
export const AHEAD_DAYS = 7;
const MAX_UPCOMING = 6;

export interface Upcoming {
  id: string;
  title: string;
  color: ColorName;
  /** «завтра · 16:00», «чт, 23 · весь день» */
  when: string;
  project?: string;
}

const MONTHS_SHORT = [
  'янв',
  'фев',
  'мар',
  'апр',
  'мая',
  'июн',
  'июл',
  'авг',
  'сен',
  'окт',
  'ноя',
  'дек',
];

function dateOf(day: string): Date {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y!, (m ?? 1) - 1, d ?? 1);
}

/** «сегодня», «завтра», «чт, 23 окт». */
export function dayName(day: string, now: Date): string {
  const today = iso(now);
  if (day === today) return 'сегодня';
  const tomorrow = iso(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1));
  if (day === tomorrow) return 'завтра';
  const d = dateOf(day);
  return `${WD_SHORT[weekday(d)]}, ${d.getDate()} ${MONTHS_SHORT[d.getMonth()]}`;
}

/**
 * Сроки на неделю вперёд (без сегодняшних — они выше, в «Делах на сегодня»): не сделанные,
 * по дню и времени.
 */
export function upcoming(
  tasks: PlannerTask[],
  projects: PlannerProject[],
  now: Date,
  days = AHEAD_DAYS,
): Upcoming[] {
  const today = iso(now);
  const last = iso(new Date(now.getFullYear(), now.getMonth(), now.getDate() + days));
  const byId = new Map(projects.map((p) => [p.id, p]));
  return tasks
    .filter((t) => t.status !== 'done' && t.due_date && t.due_date > today && t.due_date <= last)
    .sort(
      (a, b) =>
        a.due_date!.localeCompare(b.due_date!) ||
        (a.due_time ?? '99').localeCompare(b.due_time ?? '99') ||
        a.title.localeCompare(b.title, 'ru'),
    )
    .slice(0, MAX_UPCOMING)
    .map((t) => {
      const project = t.project_id ? byId.get(t.project_id) : undefined;
      return {
        id: t.id,
        title: t.title,
        color: project?.color ?? NO_PROJECT,
        when: `${dayName(t.due_date!, now)} · ${t.due_time ?? 'весь день'}`,
        ...(project ? { project: project.title } : {}),
      };
    });
}

/** Куда ведёт пункт сводки: раздел и объект в нём или статья. */
export type DigestTarget =
  { section: SectionId; obj?: string; label: string } | { url: string; label: string };

export function digestTarget(item: HomeDigestItem): DigestTarget | null {
  const { link } = item;
  const title = link.title ?? '';
  switch (link.type) {
    case 'task':
      return link.id ? { section: 'planner', obj: link.id, label: `дело «${title}»` } : null;
    case 'project':
      return link.id ? { section: 'planner', obj: link.id, label: `проект «${title}»` } : null;
    case 'inbox':
      return { section: 'inbox', label: `мысль «${title}»` };
    case 'action':
      return { section: 'agent', label: 'в ленте агента' };
    case 'url':
      return link.url?.startsWith('https://') ? { url: link.url, label: 'статья' } : null;
    default:
      return null;
  }
}

export const DIGEST_KIND: Record<string, { label: string; color: ColorName }> = {
  important: { label: 'важное', color: 'orange' },
  noticed: { label: 'заметил', color: 'sky' },
  question: { label: 'вопрос', color: 'yellow' },
  news: { label: 'новость', color: 'green' },
  tip: { label: 'совет', color: 'peach' },
};

/** Температура с настоящим минусом: «−3°», «+4°», «0°». */
export function temp(value: number): string {
  const n = Math.round(value);
  if (n === 0) return '0°';
  return `${n > 0 ? '+' : '−'}${Math.abs(n)}°`;
}

const money = new Intl.NumberFormat('ru-RU', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** «81,50 ₽» за номинал: у иены — «за 100». */
export function rateValue(value: number, nominal: number): string {
  return `${money.format(value)} ₽${nominal > 1 ? ` за ${nominal}` : ''}`;
}

/** Изменение к прошлому дню: «▲ 0,50», «▼ 0,75», «= 0,00»; нет данных — пусто. */
export function rateChange(change: number | null | undefined): { text: string; dir: -1 | 0 | 1 } {
  if (change === null || change === undefined) return { text: '', dir: 0 };
  const dir = change > 0.00005 ? 1 : change < -0.00005 ? -1 : 0;
  return {
    text: `${dir > 0 ? '▲' : dir < 0 ? '▼' : '='} ${money.format(Math.abs(change))}`,
    dir,
  };
}

/** «5 мин назад», «3 ч назад», «вчера», «2 дня назад». */
export function ago(at: string | null | undefined, now: Date): string {
  if (!at) return '';
  const ms = now.getTime() - new Date(at).getTime();
  if (!Number.isFinite(ms)) return '';
  const min = Math.max(0, Math.round(ms / 60_000));
  if (min < 1) return 'только что';
  if (min < 60) return `${min} мин назад`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h} ч назад`;
  const d = Math.round(h / 24);
  if (d === 1) return 'вчера';
  return `${d} ${plural(d, 'день', 'дня', 'дней')} назад`;
}

/** Утреннее «пока было тихо»: сколько пришло в тишину. */
export function heldLine(n: number): string {
  return `Пока было тихо, пришло ${n} ${plural(n, 'сообщение', 'сообщения', 'сообщений')}`;
}

/** Приветствие по часам. */
export function greeting(now: Date): string {
  const h = now.getHours();
  if (h < 5) return 'Доброй ночи';
  if (h < 12) return 'Доброе утро';
  if (h < 18) return 'Добрый день';
  return 'Добрый вечер';
}
