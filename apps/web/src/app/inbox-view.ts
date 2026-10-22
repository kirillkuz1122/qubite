/** Объект синхронизации → строка экрана «Входящие» в виде DS-007. */
import { localNow, parse } from '@qubite/ui';
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
  const triage = (f.triage ?? {}) as {
    status?: unknown;
    details?: { summary?: unknown; by?: unknown; options?: unknown };
  };
  let summary = text(triage.details?.summary);
  let review = f.needs_review === true ? text(f.review_reason) || 'не уверен, куда положить' : '';
  // ещё не дошло до сервера — тот же разбор прямо на устройстве, по времени записи (CMD-003)
  if (triage.status === 'pending' || triage.status === undefined) {
    const local = parse(o.title, localNow(new Date(captured)));
    if (local?.recognized || local?.review) {
      summary = local.summary;
      review = local.review ?? '';
    }
  }
  /* агент спросил сам — его вопрос и варианты ответа кнопками */
  const asked = review !== '' && triage.details?.by === 'ai';
  const answers =
    asked && Array.isArray(triage.details?.options)
      ? triage.details.options.filter((x): x is string => typeof x === 'string').slice(0, 4)
      : [];
  const hint = review ? `посмотри сам: ${review}` : summary || 'разберём, когда будет минутка';
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
    mood: asked ? 'ask' : 'idle',
    answers,
  };
}

/** Мысли, за которые агент вот-вот возьмётся (CMD-004): Элик над ними думает. */
export function withThinking(items: InboxItem[], thinking: readonly string[]): InboxItem[] {
  if (thinking.length === 0) return items;
  const busy = new Set(thinking);
  return items.map((it) =>
    busy.has(it.id) ? { ...it, mood: 'think', hint: 'думаю, куда положить…', answers: [] } : it,
  );
}
