/** «Предложить подузлы» — через AI-шлюз сервера (D-1008); ключей и моделей в браузере нет. */
import { api } from '../../../api';
import { findNode, parentNode, type MindNode } from './model';

export interface Suggestions {
  items: string[];
  /** Цена вызова, микродоллары. */
  cost: number;
}

/** Подписи от центра до узла: модели нужен контекст ветки. */
export function pathTo(tree: MindNode, id: string, label: (node: MindNode) => string): string[] {
  const path: string[] = [];
  let at: MindNode | null = findNode(tree, id);
  while (at) {
    path.unshift(label(at));
    at = parentNode(tree, at.id);
  }
  return path;
}

/** Пределы сервера (mindmap.rs): путь — до 12 подписей, подузлов — до 50, подпись — до 300 знаков. */
const MAX_PATH = 12;
const MAX_EXISTING = 50;
const MAX_TEXT = 300;
const fit = (text: string) => [...text].slice(0, MAX_TEXT).join('');

/**
 * Контекст под пределы сервера: у глубокой ветки — центр (тема карты) и ближайшие к узлу
 * подписи; название цели ссылки бывает длиннее подписи узла — его обрезаем.
 */
export function aiContext(
  path: string[],
  existing: string[],
): { path: string[]; existing: string[] } {
  const short = path.length > MAX_PATH ? [path[0]!, ...path.slice(-(MAX_PATH - 1))] : path;
  return { path: short.map(fit), existing: existing.slice(0, MAX_EXISTING).map(fit) };
}

export async function suggestSubnodes(path: string[], existing: string[]): Promise<Suggestions> {
  const { data, error, response } = await api.POST('/api/v1/docs/mindmap/suggest', {
    body: { request_id: crypto.randomUUID(), ...aiContext(path, existing) },
  });
  if (data) return { items: data.suggestions, cost: data.cost_usd_micros };
  if (response.status === 403) throw new Error('Нет права пользоваться AI в Docs.');
  const message = (error as { message?: string } | undefined)?.message;
  throw new Error(message || 'AI сейчас недоступен. Попробуйте позже.');
}

/** Цена для человека: доли цента — «меньше цента». */
export function priceText(micros: number): string {
  if (micros < 10_000) return 'меньше цента';
  return `≈ $${(micros / 1_000_000).toFixed(2)}`;
}
