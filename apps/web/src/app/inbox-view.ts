/** Объект синхронизации → строка экрана «Входящие» в виде DS-007. */
import { localNow, parse } from '@qubite/ui';
import {
  voiceHeld,
  type LocalObject,
  type QueuedVoice,
  type VoiceResult,
} from '@qubite/sync-client';
import type { InboxAct, InboxFrom, InboxItem } from './data';
import { VOICE_PLACEHOLDER, isBareVoice, voiceAudioUrl, voiceReason } from './voice-view';

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

/**
 * Объект синхронизации → строка экрана «Входящие» из DS-007. `heard` — что сервер ответил на
 * голосовую запись с этого устройства (почему без текста, D-846).
 */
export function toView(o: LocalObject, now: number, heard?: VoiceResult): InboxItem {
  const f = o.fields ?? {};
  const kind = text(f.kind);
  const source = text(f.source);
  const bare = isBareVoice(kind, text(f.body));
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
  if (!bare && (triage.status === 'pending' || triage.status === undefined)) {
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
  const hint = bare
    ? voiceReason(heard?.reason)
    : review
      ? `посмотри сам: ${review}`
      : summary || 'разберём, когда будет минутка';
  // без текста в дела и в Docs переносить нечего: послушал — в архив
  const acts: [string, InboxAct][] = bare
    ? [
        ['В архив', 'archive'],
        ['Позже', 'later'],
      ]
    : [
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
    mood: bare ? 'oops' : asked ? 'ask' : 'idle',
    answers: bare ? [] : answers,
    ...(kind === 'voice' ? { voice: { audio: voiceAudioUrl(o.id), bare } } : {}),
  };
}

/**
 * Голосовая запись, которая ещё на устройстве (CMD-005b): «Голосовая запись — отправится, когда
 * появится сеть». `sending` — очередь как раз отправляет. Не принятую сервером можно удалить.
 */
export function queuedView(q: QueuedVoice, now: number, sending: boolean): InboxItem {
  const failed = q.rejected === true || q.error !== undefined;
  // способ «локально»: Whisper на компьютере ещё распознаёт (CMD-005c)
  const held = !failed && voiceHeld(q, now);
  const src = failed
    ? `голосом · ${q.rejected ? 'сервер не принял' : 'не отправилась'}: ${q.error ?? 'ошибка'}`
    : held
      ? 'голосом · распознаётся на компьютере…'
      : sending
        ? 'голосом · отправляется…'
        : 'голосом · отправится, когда появится сеть';
  const hint = q.rejected
    ? 'запись осталась на устройстве — её можно удалить'
    : failed
      ? 'повторю сам, когда получится; можно удалить'
      : held
        ? 'Whisper на компьютере слушает запись…'
        : sending
          ? 'отправляю…'
          : 'запись на устройстве — отправлю, когда появится сеть';
  return {
    id: q.id,
    text: VOICE_PLACEHOLDER,
    src,
    from: 'voice',
    time: when(q.captured_at_ms, now),
    hint,
    acts: failed ? [['Удалить', 'drop']] : [],
    mood: failed ? 'oops' : 'idle',
    answers: [],
    voice: { bare: true, queued: failed ? 'failed' : sending || held ? 'sending' : 'wait' },
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
