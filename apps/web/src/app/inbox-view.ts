/** Объект синхронизации → строка экрана «Входящие» в виде DS-007. */
import type { LocalObject } from '@qubite/sync-client';
import type { InboxAct, InboxFrom, InboxItem } from './data';

const pad = (n: number) => String(n).padStart(2, '0');

/** «сейчас», «9:12», «вчера», «3 нояб.». */
export function when(ms: number, now: number): string {
  if (now - ms < 60_000) return 'сейчас';
  const d = new Date(ms);
  const today = new Date(now);
  const sameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();
  if (sameDay(d, today)) return `${d.getHours()}:${pad(d.getMinutes())}`;
  const yesterday = new Date(now - 864e5);
  if (sameDay(d, yesterday)) return 'вчера';
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
}

const text = (v: unknown) => (typeof v === 'string' ? v : '');

/** Объект синхронизации → строка экрана «Входящие» из DS-007. */
export function toView(o: LocalObject, now: number): InboxItem {
  const f = o.fields ?? {};
  const kind = text(f.kind);
  const source = text(f.source);
  const from: InboxFrom =
    source === 'telegram' ? 'tg' : kind === 'voice' ? 'voice' : kind === 'link' ? 'link' : 'text';
  const src =
    source === 'telegram'
      ? 'из Telegram'
      : kind === 'voice'
        ? 'голосом'
        : kind === 'link'
          ? 'ссылка'
          : source === 'android'
            ? 'с телефона'
            : source === 'desktop'
              ? 'с компьютера'
              : 'написал';
  const captured = typeof f.captured_at_ms === 'number' ? f.captured_at_ms : o.updated_at_ms;
  const triage = (f.triage ?? {}) as { details?: { summary?: unknown } };
  const summary = text(triage.details?.summary);
  const hint =
    f.needs_review === true
      ? `посмотри сам: ${text(f.review_reason) || 'не уверен, куда положить'}`
      : summary || 'разберём, когда будет минутка';
  const acts: [string, InboxAct][] = [
    ['В дела', 'planner'],
    ['В Docs', 'docs'],
    ['Позже', 'later'],
  ];
  return {
    id: o.id,
    text: text(f.body).split('\n')[0]?.trim() || o.title,
    src: o.pending ? `${src} · ждёт сети` : src,
    from,
    time: when(captured, now),
    hint,
    acts,
  };
}
