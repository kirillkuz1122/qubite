/** Подписи вкладки «Когда писать» (AGT-004): как часто агент пишет первым и что сейчас. */
import type { components } from '@qubite/api-client';

export type AgentPace = components['schemas']['AgentPace'];
export type PaceMode = 'auto' | 'count' | 'off';

export const MODES: { value: PaceMode; label: string }[] = [
  { value: 'auto', label: 'Сколько захочет' },
  { value: 'count', label: 'Число в день' },
  { value: 'off', label: 'Не писать' },
];

/** «сообщений» по числу: 1 сообщение, 2 сообщения, 5 сообщений. */
export function messages(n: number): string {
  const tens = n % 100;
  const ones = n % 10;
  if (tens >= 11 && tens <= 14) return `${n} сообщений`;
  if (ones === 1) return `${n} сообщение`;
  if (ones >= 2 && ones <= 4) return `${n} сообщения`;
  return `${n} сообщений`;
}

/** Строка о сегодняшнем дне: сколько написал, сколько можно, тишина. */
export function todayLine(p: Pick<AgentPace, 'mode' | 'limit' | 'sent' | 'quiet'>): string {
  if (p.mode === 'off')
    return 'Агент первым не пишет: только твои напоминания и сводка на Главной.';
  const parts = [
    p.mode === 'auto'
      ? `Сегодня написал ${p.sent} из ${p.limit} — столько он сейчас считает уместным.`
      : `Сегодня написал ${p.sent} из ${p.limit}.`,
  ];
  if (p.quiet) parts.push(`Сейчас молчит: ${p.quiet}.`);
  return parts.join(' ');
}

/** «Свободно: 15:00–17:00, 18:30–23:00» или пояснение, что окон нет. */
export function windowsLine(windows: AgentPace['windows']): string {
  if (windows.length === 0) return 'Свободных окон до конца дня не видно.';
  return `Свободно сегодня: ${windows.map((w) => `${w.from}–${w.to}`).join(', ')}.`;
}
