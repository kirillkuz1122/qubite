/** Подписи колокольчика (PLAN-004). */
import type { components } from '@qubite/api-client';

type NoticeItem = components['schemas']['NoticeItem'];

const TIME = new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit' });
const DAY = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short' });

/** «15:45» сегодня, «19 окт.» раньше. */
export function noticeWhen(iso: string, now = new Date()): string {
  const d = new Date(iso);
  return d.toDateString() === now.toDateString() ? TIME.format(d) : DAY.format(d);
}

/** Строка под заголовком: «в 16:00 · сходить куда-то — за час, с запасом на дорогу». */
export function noticeLine(n: Pick<NoticeItem, 'body' | 'why' | 'held'>): string {
  return [n.body, n.why, n.held && 'пришло в тишину'].filter(Boolean).join(' · ');
}
