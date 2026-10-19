/**
 * Входящие поверх клиента синхронизации (CMD-001).
 *
 * Мысль сначала записывается на устройство вместе с операцией в очереди —
 * без сети она не теряется. На сервер уходит при следующей синхронизации;
 * время записи берётся с устройства, а не со времени отправки.
 */
import type { SyncClient } from './client';
import type { LocalObject } from './store';

export const INBOX_ITEM = 'inbox.item';
/** Как на сервере (`qubite_inbox::TITLE_CHARS`). */
export const TITLE_CHARS = 200;

export type InboxSource = 'web' | 'desktop' | 'android' | 'api';
/** `review` — Command не уверен, нужно решение владельца («посмотри сам»). */
export type InboxView = 'new' | 'review' | 'archived' | 'trash';

export interface CaptureOptions {
  url?: string;
  source?: InboxSource;
  /** Для тестов: «сейчас» в миллисекундах. */
  now?: number;
  /**
   * Часовой пояс устройства — по нему сервер понимает «завтра» и «в 18» (CMD-003).
   * По умолчанию — пояс браузера.
   */
  tz?: string;
}

function deviceTimeZone(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined;
  } catch {
    return undefined;
  }
}

/** Заголовок: первая непустая строка, не длиннее {@link TITLE_CHARS}. */
export function titleFrom(text: string): string {
  const line =
    text
      .split('\n')
      .map((part) => part.trim())
      .find((part) => part.length > 0) ?? '';
  const chars = Array.from(line);
  return chars.length <= TITLE_CHARS ? line : `${chars.slice(0, TITLE_CHARS - 1).join('')}…`;
}

/** Записать мысль во Входящие (работает без сети). */
export async function captureThought(
  client: SyncClient,
  text: string,
  options: CaptureOptions = {},
): Promise<LocalObject> {
  if (!text.trim() && !options.url) throw new Error('пустая мысль');
  const title = titleFrom(text) || titleFrom(options.url ?? '');
  const fields = {
    body: text,
    ...(options.url ? { url: options.url } : {}),
    source: options.source ?? 'web',
    captured_at_ms: options.now ?? Date.now(),
    ...((options.tz ?? deviceTimeZone()) ? { tz: options.tz ?? deviceTimeZone() } : {}),
  };
  return client.create(INBOX_ITEM, title, fields, {
    kind: options.url ? 'link' : 'text',
    status: 'new',
    triage: { status: 'pending' },
  });
}

/** Разобрано — в архив (не удаляется). */
export function archiveThought(client: SyncClient, id: string): Promise<LocalObject> {
  return client.patch(id, { status: 'archived' });
}

export function unarchiveThought(client: SyncClient, id: string): Promise<LocalObject> {
  return client.patch(id, { status: 'new' });
}

/** Элементы Входящих на устройстве, свежие сверху. */
export async function inboxItems(
  client: SyncClient,
  view: InboxView = 'new',
): Promise<LocalObject[]> {
  const items = (await client.all()).filter((object) => object.object_type === INBOX_ITEM);
  const matches = (object: LocalObject) => {
    if (view === 'trash') return object.deleted;
    if (object.deleted) return false;
    const status = object.fields?.status ?? 'new';
    if (view === 'review') return status === 'new' && object.fields?.needs_review === true;
    return status === view;
  };
  const capturedAt = (object: LocalObject) =>
    typeof object.fields?.captured_at_ms === 'number'
      ? object.fields.captured_at_ms
      : object.updated_at_ms;
  return items.filter(matches).sort((a, b) => capturedAt(b) - capturedAt(a));
}
