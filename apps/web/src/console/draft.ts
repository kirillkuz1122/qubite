/**
 * Черновик тумблеров Owner Console (D-063, D-231): изменения копятся, пока owner не нажмёт
 * «Сохранить»; уходят одним пакетом с версиями. Хранится в браузере, привязан к owner, без
 * паролей и секретов (тумблеры их не содержат). Здесь — только чистая логика, без React.
 */
import type { SettingItem } from '../platform/owner';

/** Одно изменение: что было, когда owner начал менять, и что станет. */
export interface Change {
  key: string;
  /** значение и версия на сервере, когда owner тронул тумблер */
  base: unknown;
  version: number;
  /** что станет */
  value: unknown;
}

export type Draft = Record<string, Change>;

/** Конфликт: пока owner правил, на сервере (другая вкладка) значение поменялось. */
export interface Conflict extends Change {
  current: unknown;
  currentVersion: number;
}

/** Тумблеры, которые правятся черновиком (техработы — своим пультом, сразу). */
export const DRAFT_KEYS = [
  'registration.mode',
  'login.enabled',
  'login.methods.password',
  'login.methods.google',
  'login.methods.yandex',
  'login.methods.vk',
  'login.methods.telegram',
  'email.enabled',
  'captcha.provider',
  'platform.timezone',
] as const;

const LABEL: Record<string, string> = {
  'registration.mode': 'Регистрация',
  'login.enabled': 'Вход',
  'login.methods.password': 'Вход паролем',
  'login.methods.google': 'Вход через Google',
  'login.methods.yandex': 'Вход через Яндекс ID',
  'login.methods.vk': 'Вход через VK ID',
  'login.methods.telegram': 'Вход через Telegram',
  'email.enabled': 'Почта',
  'captcha.provider': 'CAPTCHA',
  'platform.timezone': 'Часовой пояс',
};

const VALUE: Record<string, string> = {
  closed: 'закрыта',
  invite_only: 'по приглашениям',
  open: 'открыта',
  turnstile: 'Cloudflare Turnstile',
  smartcaptcha: 'Яндекс SmartCaptcha',
  off: 'выключена',
};

export function labelOf(key: string): string {
  return LABEL[key] ?? key;
}

/** Значение тумблера словами: «включён», «по приглашениям», «Asia/Yekaterinburg». */
export function shown(value: unknown): string {
  if (value === true) return 'включён';
  if (value === false) return 'выключен';
  if (value == null || value === '') return '—';
  const text = String(value as string);
  return VALUE[text] ?? text;
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Поменять тумблер в черновике. Вернул как было — изменение исчезает. */
export function edit(draft: Draft, item: SettingItem, value: unknown): Draft {
  const was = draft[item.key];
  const base = was ? was.base : (item.value as unknown);
  const version = was ? was.version : item.version;
  const next = { ...draft };
  if (same(base, value)) delete next[item.key];
  else next[item.key] = { key: item.key, base, version, value };
  return next;
}

/** Что показать в тумблере: из черновика, если owner его трогал. */
export function current(draft: Draft, item: SettingItem): unknown {
  return item.key in draft ? draft[item.key]!.value : (item.value as unknown);
}

export function changes(draft: Draft): Change[] {
  return DRAFT_KEYS.filter((k) => k in draft).map((k) => draft[k]!);
}

/**
 * Сверить черновик с сервером. Изменения, которые на сервере уже такие же (например, ответ
 * «сохранено» потерялся, и пакет применился), убираются; изменённые кем-то ещё — конфликты.
 */
export function reconcile(
  draft: Draft,
  items: SettingItem[],
): { draft: Draft; conflicts: Conflict[] } {
  const next: Draft = {};
  const conflicts: Conflict[] = [];
  for (const change of changes(draft)) {
    const item = items.find((i) => i.key === change.key);
    if (!item) continue;
    if (same(item.value, change.value)) continue;
    next[change.key] = change;
    if (item.version !== change.version)
      conflicts.push({ ...change, current: item.value, currentVersion: item.version });
  }
  return { draft: next, conflicts };
}

/** Конфликт решён: «оставить моё» — сохраняем поверх новой версии; «взять с сервера» — забыть. */
export function resolve(draft: Draft, conflict: Conflict, keepMine: boolean): Draft {
  const next = { ...draft };
  if (keepMine)
    next[conflict.key] = {
      ...conflict,
      base: conflict.current,
      version: conflict.currentVersion,
    };
  else delete next[conflict.key];
  return next;
}

/** Ключ хранения: черновик одного owner не достаётся другому (D-063). */
export const draftStore = (ownerId: string) => `qubite.console.draft.${ownerId}`;

export function loadDraft(ownerId: string): Draft {
  try {
    const raw = localStorage.getItem(draftStore(ownerId));
    const parsed = raw ? (JSON.parse(raw) as Draft) : {};
    // только известные тумблеры — без мусора и чего-либо секретного
    return Object.fromEntries(
      Object.entries(parsed).filter(([k]) => (DRAFT_KEYS as readonly string[]).includes(k)),
    );
  } catch {
    return {};
  }
}

export function saveDraft(ownerId: string, draft: Draft) {
  try {
    if (Object.keys(draft).length === 0) localStorage.removeItem(draftStore(ownerId));
    else localStorage.setItem(draftStore(ownerId), JSON.stringify(draft));
  } catch {
    // приватный режим — черновик живёт до закрытия вкладки
  }
}
