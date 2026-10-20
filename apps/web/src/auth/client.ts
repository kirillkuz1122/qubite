/** Qubite Auth: запросы к серверу, «кто вошёл», состояние платформы и тексты ошибок. */
import type { ApiErrorBody, components, Me, SessionItem } from '@qubite/api-client';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api';

export type PlatformStatus = components['schemas']['PlatformStatus'];
export type CaptchaWidget = components['schemas']['CaptchaWidget'];
export type ProviderItem = components['schemas']['OAuthProviderItem'];

/** Отказ сервера: код (`invalid_credentials`…), текст для человека и HTTP-статус. */
export class Fail extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/** Событие окна: сервер ответил «техработы» (ACC-004). */
export const MAINTENANCE_EVENT = 'qubite:maintenance';

const OFFLINE = 'Нет связи с сервером. Проверьте интернет и попробуйте ещё раз';

/** Дождаться ответа openapi-fetch: данные — или `Fail` с понятным текстом. */
export async function must<T>(
  call: Promise<{ data?: T; error?: unknown; response: Response }>,
): Promise<T> {
  let r: { data?: T; error?: unknown; response: Response };
  try {
    r = await call;
  } catch {
    throw new Fail('network', OFFLINE, 0);
  }
  if (r.error !== undefined || !r.response.ok) {
    const body = (r.error ?? {}) as Partial<ApiErrorBody>;
    const status = r.response.status;
    // включили техработы — пусть экран узнает сразу, а не через полминуты
    if (body.error === 'maintenance') globalThis.dispatchEvent?.(new Event(MAINTENANCE_EVENT));
    throw new Fail(
      body.error ?? `http_${status}`,
      body.message ??
        (status >= 500 ? 'Сервер сейчас не отвечает. Попробуйте чуть позже' : OFFLINE),
      status,
    );
  }
  return r.data as T;
}

/** Текст ошибки для человека (сервер уже пишет по-русски; сеть — свой текст). */
export function say(e: unknown): string {
  return e instanceof Fail ? e.message : OFFLINE;
}

export const ME = ['me'] as const;

/** Кто вошёл: `null` — никто (или сервер недоступен — тогда тоже как гость). */
export function useMe() {
  return useQuery({
    queryKey: ME,
    queryFn: async (): Promise<Me | null> => {
      try {
        return await must(api.GET('/api/auth/me'));
      } catch (e) {
        if (e instanceof Fail && e.status === 401) return null;
        throw e;
      }
    },
    retry: false,
    staleTime: 30_000,
  });
}

export const PLATFORM = ['platform'] as const;

/**
 * Состояние платформы для всех: техработы, способы входа, режим регистрации.
 * Проверяется раз в 30 секунд и при возврате во вкладку (ACC-004).
 */
export function usePlatform() {
  return useQuery({
    queryKey: PLATFORM,
    queryFn: () => must(api.GET('/api/platform/status')),
    retry: false,
    staleTime: 15_000,
    refetchInterval: 30_000,
  });
}

/**
 * «Вернёмся к …» по часовому поясу платформы: «10:00», «завтра, 10:00»
 * или «21 октября, 10:00».
 */
export function untilText(iso: string, timeZone: string, now: Date = new Date()): string {
  const fmt = (o: Intl.DateTimeFormatOptions, d: Date, locale = 'ru-RU') => {
    try {
      return new Intl.DateTimeFormat(locale, { ...o, timeZone }).format(d);
    } catch {
      return new Intl.DateTimeFormat(locale, o).format(d);
    }
  };
  const at = new Date(iso);
  const day = (d: Date) => fmt({ year: 'numeric', month: '2-digit', day: '2-digit' }, d, 'en-CA');
  const time = fmt({ hour: '2-digit', minute: '2-digit' }, at);
  if (day(at) === day(now)) return time;
  if (day(at) === day(new Date(now.getTime() + 86_400_000))) return `завтра, ${time}`;
  return `${fmt({ day: 'numeric', month: 'long' }, at)}, ${time}`;
}

/** Включённые и настроенные на сервере провайдеры (Яндекс, VK, Google, Telegram). */
export function useProviders() {
  return useQuery({
    queryKey: ['oauth-providers'],
    queryFn: () => must(api.GET('/api/auth/oauth/providers')),
    retry: false,
    staleTime: 60_000,
  });
}

export const PROVIDER_NAME: Record<string, string> = {
  yandex: 'Яндекс ID',
  vk: 'VK ID',
  google: 'Google',
  telegram: 'Telegram',
};

/**
 * Провайдеры, которые можно показать на экране входа: настроены на сервере
 * и не выключены тумблером owner.
 */
export function shownProviders(
  providers: ProviderItem[] | undefined,
  status: PlatformStatus | undefined,
): ProviderItem[] {
  if (!providers || !status || !status.login_enabled) return [];
  const methods = status.login_methods as unknown as Record<string, boolean>;
  return providers.filter((p) => methods[p.id] === true);
}

/** Путь на этом сайте (как проверяет сервер): `/home`, но не `//чужой.сайт`. По умолчанию — Главная (D-327). */
export function safePath(path: unknown, fallback = '/home'): string {
  if (typeof path !== 'string') return fallback;
  const ok =
    path.startsWith('/') &&
    !path.startsWith('//') &&
    !path.startsWith('/\\') &&
    path.length <= 500 &&
    ![...path].some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127);
  return ok ? path : fallback;
}

/** Параметр адреса как строка (роутер превращает `?code=123456` в число). */
export function param(v: unknown): string {
  return v == null ? '' : String(v);
}

/** Что пошло не так при входе через провайдера или пропуском (`/auth?error=…`). */
export function oauthError(code: string, provider: string): string {
  const p = PROVIDER_NAME[provider] ?? 'провайдера';
  switch (code) {
    case 'oauth_not_linked':
      return `Этот ${p} ещё не привязан к Qubite. Войдите паролем и привяжите его на странице «Аккаунт».`;
    case 'oauth_provider_disabled':
      return `Вход через ${p} сейчас выключен.`;
    case 'oauth_invalid_state':
      return `Вход через ${p} не завершился: он открыт в другом браузере или прошло больше 10 минут. Попробуйте ещё раз.`;
    case 'oauth_provider_error':
      return `${p} ответил ошибкой. Попробуйте ещё раз чуть позже.`;
    case 'oauth_email_required':
      return `${p} не передал почту, а без неё аккаунт не создать. Зарегистрируйтесь по почте.`;
    case 'oauth_email_taken':
      return `Аккаунт с этой почтой уже есть. Войдите паролем и привяжите ${p} на странице «Аккаунт».`;
    case 'oauth_taken':
      return `Этот ${p} уже привязан к другому аккаунту Qubite.`;
    case 'invite_required':
      return 'Регистрация — по приглашениям. Откройте ссылку из приглашения.';
    case 'consent_required':
      return `Аккаунта с этим ${p} ещё нет. Чтобы создать его, откройте «Создать аккаунт» и отметьте согласие с условиями.`;
    case 'invalid_invite':
      return 'Приглашение не подошло: оно одноразовое и действует 7 дней.';
    case 'registration_closed':
      return 'Регистрация сейчас закрыта.';
    case 'login_disabled':
      return 'Вход сейчас выключен.';
    case 'maintenance':
      return 'Qubite на техработах — войти можно будет чуть позже.';
    case 'account_blocked':
      return 'Аккаунт заблокирован.';
    case 'too_many_attempts':
      return 'Слишком много попыток. Подождите немного и попробуйте снова.';
    case 'pass_invalid':
      return 'Ссылка-пропуск не подошла: она одноразовая и действует 10 минут. Войдите паролем или попросите новую у бота (/tech).';
    default:
      return 'Не получилось войти. Попробуйте ещё раз.';
  }
}

/** Ссылка входа через провайдера: сервер уводит браузер к нему и обратно. */
export function providerHref(
  id: string,
  returnTo: string,
  invite?: string,
  consent?: string,
): string {
  const q = new URLSearchParams({ return_to: returnTo });
  if (invite) q.set('invite', invite);
  // галочка «Принимаю условия» со страницы регистрации — без неё аккаунт не создаётся (D-230)
  if (consent) q.set('consent', consent);
  return `/api/auth/oauth/${id}/login?${q}`;
}

/** «Firefox на Android» из строки браузера — коротко, без версии. */
export function deviceName(s: SessionItem): string {
  if (s.kind === 'device') return s.device_name || 'Приложение Qubite';
  const ua = s.user_agent;
  const browser = /Firefox\//.test(ua)
    ? 'Firefox'
    : /Edg\//.test(ua)
      ? 'Edge'
      : /YaBrowser\//.test(ua)
        ? 'Яндекс Браузер'
        : /Chrome\//.test(ua)
          ? 'Chrome'
          : /Safari\//.test(ua)
            ? 'Safari'
            : 'Браузер';
  const os = /Android/.test(ua)
    ? 'Android'
    : /iPhone|iPad/.test(ua)
      ? 'iOS'
      : /Windows/.test(ua)
        ? 'Windows'
        : /Mac OS X/.test(ua)
          ? 'macOS'
          : /Linux/.test(ua)
            ? 'Linux'
            : '';
  return os ? `${browser} на ${os}` : browser;
}
