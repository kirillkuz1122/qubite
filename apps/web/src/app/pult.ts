/**
 * Пульт (HAR-002, AOS-5): запросы к `/api/owner/pult*` и подписи для экрана. Только owner (D-949):
 * для остальных этих адресов нет, поэтому запросы включаются флагом `enabled`.
 * Числа — только с сервера; нет источника — «нет данных», ничего не выдумываем (D-980).
 */
import type { components } from '@qubite/api-client';
import type { ColorName } from '@qubite/ui';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api';
import { must } from '../auth/client';

type S = components['schemas'];
export type PultBoard = S['PultBoard'];
export type PultAgent = S['PultAgent'];
export type PultWindow = S['PultWindow'];
export type PultWaiting = S['PultWaiting'];
export type PultSpend = S['PultSpend'];
export type PultAgentCard = S['PultAgentCard'];
export type PultEvent = S['PultEvent'];
export type PultCollector = S['PultCollector'];
export type AgentStatus = S['AgentStatus'];

export const PULT = ['owner-pult'] as const;
export const PULT_AGENT = ['owner-pult-agent'] as const;
export const PULT_COLLECTORS = ['owner-pult-collectors'] as const;

/** Светофор. Сервер держит GitHub 3 минуты, поэтому раз в минуту — дёшево. */
export function usePult(enabled: boolean) {
  return useQuery({
    queryKey: PULT,
    queryFn: () => must(api.GET('/api/owner/pult', { params: { query: { fresh: false } } })),
    enabled,
    retry: false,
    refetchInterval: 60_000,
  });
}

export function useAgentCard(key: string | null) {
  return useQuery({
    queryKey: [...PULT_AGENT, key],
    queryFn: () =>
      must(api.GET('/api/owner/pult/agents/{key}', { params: { path: { key: key ?? '' } } })),
    enabled: key != null,
    retry: false,
    refetchInterval: 60_000,
  });
}

export function useCollectors(enabled: boolean) {
  return useQuery({
    queryKey: PULT_COLLECTORS,
    queryFn: () => must(api.GET('/api/owner/pult/collectors')),
    enabled,
    retry: false,
  });
}

// ---------------------------------------------------------------- подписи

export const STATUS_LABEL: Record<AgentStatus, string> = {
  running: 'работает',
  waiting: 'ждёт тебя',
  done: 'готово',
  idle: 'тихо',
};

/** Цвета статусов (D-953): работает — голубой, ждёт — оранжевый, готово — зелёный. */
export const STATUS_COLOR: Record<AgentStatus, ColorName | 'faint'> = {
  running: 'sky',
  waiting: 'orange',
  done: 'green',
  idle: 'faint',
};

/** Лимит: ≥ 40% — зелёный, 15–40% — жёлтый, < 15% — красный с LOW (D-953). */
export function limitTone(left: number): 'green' | 'yellow' | 'red' {
  if (left >= 40) return 'green';
  if (left >= 15) return 'yellow';
  return 'red';
}

/** Сколько точек шкалы горит из `total`. Хоть немного осталось — хоть одна точка. */
export function litDots(left: number, total: number): number {
  const n = Math.round((Math.max(0, Math.min(100, left)) / 100) * total);
  return left > 0 && n === 0 ? 1 : n;
}

const comma = (n: number, digits: number) => n.toFixed(digits).replace('.', ',');

/** 41 300 000 → «41,3 млн»; 18 400 → «18 тыс.»; 950 → «950». */
export function tokens(n: number): string {
  if (n >= 1_000_000) return `${comma(n / 1_000_000, n >= 100_000_000 ? 0 : 1)} млн`;
  if (n >= 1_000) return `${Math.round(n / 1_000)} тыс.`;
  return String(n);
}

/** ≈ $ по ценам API: «$4,10», «$123»; нет — «—». */
export function usd(n: number | null | undefined): string {
  if (n == null) return '—';
  if (n >= 100) return `$${Math.round(n)}`;
  return `$${comma(n, 2)}`;
}

export const pct = (n: number) => `${Math.round(n)}%`;

const MINUTE = 60_000;

/** «5 мин назад», «2 ч назад», «вчера», «3 дн назад». */
export function ago(iso: string, now: Date): string {
  const d = now.getTime() - new Date(iso).getTime();
  if (d < MINUTE) return 'только что';
  if (d < 60 * MINUTE) return `${Math.floor(d / MINUTE)} мин назад`;
  if (d < 24 * 60 * MINUTE) return `${Math.floor(d / (60 * MINUTE))} ч назад`;
  const days = Math.floor(d / (24 * 60 * MINUTE));
  return days === 1 ? 'вчера' : `${days} дн назад`;
}

/** «38 мин», «2 ч 08 мин». */
export function duration(minutes: number): string {
  const m = Math.max(0, Math.round(minutes));
  if (m < 60) return `${m} мин`;
  const h = Math.floor(m / 60);
  return `${h} ч ${String(m % 60).padStart(2, '0')} мин`;
}

const hm = (d: Date) =>
  `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

/** «в пятницу», «во вторник» — когда. */
const WD_AT = [
  'в воскресенье',
  'в понедельник',
  'во вторник',
  'в среду',
  'в четверг',
  'в пятницу',
  'в субботу',
];
/** «до четверга» — до какого дня. */
const WD_UNTIL = [
  'воскресенья',
  'понедельника',
  'вторника',
  'среды',
  'четверга',
  'пятницы',
  'субботы',
];
const WD_SHORT = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];

const sameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() &&
  a.getMonth() === b.getMonth() &&
  a.getDate() === b.getDate();

/**
 * Подпись под шкалой лимита. 5 часов: «сброс в 19:40 · через 2 ч 08 мин».
 * Неделя: «сброс в пятницу 03:00 · хватит примерно до четверга».
 */
export function resetLine(w: PultWindow, now: Date): string {
  const parts: string[] = [];
  if (w.resets_at) {
    const r = new Date(w.resets_at);
    const left = (r.getTime() - now.getTime()) / MINUTE;
    parts.push(
      sameDay(r, now) || left < 12 * 60
        ? `сброс в ${hm(r)} · через ${duration(left)}`
        : `сброс ${WD_AT[r.getDay()]} ${hm(r)}`,
    );
  }
  if (w.runs_out_at) {
    const o = new Date(w.runs_out_at);
    parts.push(
      sameDay(o, now)
        ? `хватит примерно до ${hm(o)}`
        : `хватит примерно до ${WD_UNTIL[o.getDay()]}`,
    );
  }
  return parts.join(' · ');
}

/** «Ср» для `2026-11-11`. Дата — по часам ПК, где собран расход. */
export function weekdayShort(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  return WD_SHORT[new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1).getDay()] ?? date;
}

export function ciLabel(ci: S['Ci'] | null | undefined): string {
  if (ci === 'green') return 'CI зелёный';
  if (ci === 'red') return 'CI красный';
  if (ci === 'running') return 'CI идёт';
  return 'CI нет';
}

/** Строка под названием агента: «работает · Opus · xhigh · 38 мин · PR #247». */
export function agentMeta(a: PultAgent, withStatus: boolean): string {
  const parts: string[] = [];
  if (withStatus) parts.push(STATUS_LABEL[a.status]);
  if (a.model) parts.push(a.model);
  if (a.effort) parts.push(a.effort);
  if (a.minutes != null && a.status === 'running') parts.push(duration(a.minutes));
  if (a.pr) parts.push(`PR #${a.pr.number}`);
  if (!a.model && a.place === 'cloud') parts.push('облако');
  return parts.join(' · ');
}

export function cacheLabel(c: PultAgent['cache'], long: boolean): string | null {
  if (!c) return null;
  if (!c.warm) return long ? 'холодный · продолжение перечитает контекст' : 'холодный кэш';
  return long ? `тёплый · остынет через ${duration(c.minutes_left)}` : 'тёплый кэш';
}

/** Счётчики фильтра агентов: все, ждут, работают, готово. */
export function agentCounts(list: PultAgent[]) {
  const n = (s: AgentStatus) => list.filter((a) => a.status === s).length;
  return { all: list.length, waiting: n('waiting'), running: n('running'), done: n('done') };
}
