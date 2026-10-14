import { parseProfile } from "../identity";

export const providers = ["google", "yandex", "vk", "telegram"] as const;
export type Provider = (typeof providers)[number];
export const providerNames = {
  google: "Google",
  yandex: "Яндекс",
  vk: "VK",
  telegram: "Telegram",
};
const endpoints = {
  google: "https://accounts.google.com/o/oauth2/v2/auth",
  yandex: "https://oauth.yandex.ru/authorize",
  vk: "https://id.vk.ru/authorize",
  telegram: "https://oauth.telegram.org/auth",
};
export type Registration = {
  mode: "public" | "invite" | "disabled";
  revision: number;
  consent_version: string;
};
export type DeviceSession = {
  id: string;
  created_at: string;
  last_seen_at: string;
  expires_at: string;
  absolute_expires_at: string;
  current: boolean;
};
export const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
export const token = (value: string, prefix: string) =>
  new RegExp(`^${prefix}[A-Za-z0-9_-]{43}$`).test(value);
const record = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const exact = (v: Record<string, unknown>, keys: string[]) =>
  Object.keys(v).sort().join() === keys.sort().join();
export class AuthFault extends Error {
  constructor(
    public code: string,
    public status = 0,
  ) {
    super("auth_request_failed");
  }
}
export async function request(
  path: string,
  signal: AbortSignal,
  method = "GET",
  body?: unknown,
  extraHeaders: Record<string, string> = {},
): Promise<unknown> {
  if (__QUBITE_DEMO__) throw new AuthFault("preview");
  const headers: Record<string, string> = {
    Accept: "application/json",
    ...extraHeaders,
  };
  if (method !== "GET") {
    const csrf = await request("/api/v1/auth/csrf", signal);
    if (
      !record(csrf) ||
      !exact(csrf, ["csrf_token"]) ||
      typeof csrf.csrf_token !== "string" ||
      !token(csrf.csrf_token, "qbt_c_")
    )
      throw new AuthFault("invalid_response");
    headers["X-CSRF-Token"] = csrf.csrf_token;
    if (body !== undefined) headers["Content-Type"] = "application/json";
  }
  const response = await fetch(path, {
    method,
    headers,
    credentials: "same-origin",
    cache: "no-store",
    redirect: "error",
    signal,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  if (response.status === 204) return null;
  if (!response.headers.get("content-type")?.includes("application/json"))
    throw new AuthFault("invalid_response", response.status);
  const text = await response.text();
  if (text.length > 65536) throw new AuthFault("invalid_response");
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new AuthFault("invalid_response");
  }
  if (!response.ok)
    throw new AuthFault(
      record(data) && typeof data.code === "string"
        ? data.code
        : "invalid_response",
      response.status,
    );
  return data;
}
export function parseRegistration(v: unknown): Registration {
  if (
    !record(v) ||
    !exact(v, ["mode", "revision", "consent_version"]) ||
    !["invite", "public", "disabled"].includes(v.mode as string) ||
    !Number.isSafeInteger(v.revision) ||
    (v.revision as number) < 1 ||
    typeof v.consent_version !== "string" ||
    !/^[a-z0-9-]{1,80}$/.test(v.consent_version)
  )
    throw new AuthFault("invalid_response");
  return v as Registration;
}
export function parseProviders(
  v: unknown,
): { provider: Provider; available: boolean }[] {
  if (
    !record(v) ||
    !exact(v, ["items"]) ||
    !Array.isArray(v.items) ||
    v.items.length !== providers.length
  )
    throw new AuthFault("invalid_response");
  const seen = new Set<string>();
  return v.items.map((item) => {
    if (
      !record(item) ||
      !exact(item, ["provider", "available"]) ||
      !providers.includes(item.provider as Provider) ||
      typeof item.available !== "boolean" ||
      seen.has(item.provider as string)
    )
      throw new AuthFault("invalid_response");
    seen.add(item.provider as string);
    return item as { provider: Provider; available: boolean };
  });
}
export function parseSessions(v: unknown): DeviceSession[] {
  if (
    !record(v) ||
    !exact(v, ["items"]) ||
    !Array.isArray(v.items) ||
    v.items.length > 1000
  )
    throw new AuthFault("invalid_response");
  return v.items.map((item) => {
    if (
      !record(item) ||
      !exact(item, [
        "id",
        "created_at",
        "last_seen_at",
        "expires_at",
        "absolute_expires_at",
        "current",
      ]) ||
      typeof item.id !== "string" ||
      !uuid.test(item.id) ||
      typeof item.current !== "boolean" ||
      ["created_at", "last_seen_at", "expires_at", "absolute_expires_at"].some(
        (k) =>
          typeof item[k] !== "string" ||
          !/T.*(?:Z|[+-]\d{2}:\d{2})$/.test(item[k] as string) ||
          !Number.isFinite(Date.parse(item[k] as string)),
      )
    )
      throw new AuthFault("invalid_response");
    return item as DeviceSession;
  });
}
export function loginResult(v: unknown) {
  if (!record(v) || !exact(v, ["subject", "session"]))
    throw new AuthFault("invalid_response");
  parseProfile(v.subject);
  parseSessions({ items: [v.session] });
}
export function accepted(v: unknown, code: string) {
  if (!record(v) || !exact(v, ["code"]) || v.code !== code)
    throw new AuthFault("invalid_response");
}
export function authorization(v: unknown, provider: Provider): string {
  if (
    !record(v) ||
    !exact(v, ["authorization_url"]) ||
    typeof v.authorization_url !== "string" ||
    v.authorization_url.length > 4096
  )
    throw new AuthFault("invalid_response");
  let url: URL;
  try {
    url = new URL(v.authorization_url);
  } catch {
    throw new AuthFault("invalid_response");
  }
  if (
    url.origin + url.pathname !== endpoints[provider] ||
    url.username ||
    url.password ||
    url.hash ||
    url.searchParams.get("response_type") !== "code" ||
    !url.searchParams.get("state") ||
    !url.searchParams.get("code_challenge")
  )
    throw new AuthFault("invalid_response");
  return url.href;
}
export function errorMessage(error: unknown): string {
  if (!(error instanceof AuthFault))
    return "Не удалось связаться с Qubite. Проверь подключение и попробуй ещё раз.";
  const messages: Record<string, string> = {
    preview:
      "Это просмотр интерфейса. Аккаунт не создан, данные не отправлены и письмо не отправлено.",
    invalid_credentials:
      "Не удалось войти. Проверь email, пароль и подтверждение почты.",
    unauthenticated: "Сессия закончилась. Войди снова.",
    registration_closed:
      "Создание аккаунтов сейчас выключено. Вход в существующий аккаунт доступен.",
    invite_required:
      "Для создания аккаунта нужно приглашение владельца Qubite.",
    invalid_invite:
      "Приглашение недействительно, использовано или не подходит этому email. Запроси новое.",
    invalid_challenge:
      "Ссылка недействительна или устарела. Запроси новое письмо.",
    consent_changed:
      "Документы изменились. Обнови страницу и ознакомься с новой версией.",
    registration_changed:
      "Настройки регистрации изменились. Обнови страницу перед новой попыткой.",
    policy_conflict:
      "Настройки изменились в другой вкладке. Обнови их перед сохранением.",
    policy_precondition_required: "Обнови настройки перед сохранением.",
    policy_unavailable: "Настройки временно недоступны. Попробуй позже.",
    reauth_required: "Подтверди действие паролем Qubite и попробуй снова.",
    csrf_failed:
      "Проверка безопасности не прошла. Попробуй отправить форму снова.",
    email_unavailable: "Отправка писем сейчас недоступна. Попробуй позже.",
    identity_unavailable: "Qubite Auth сейчас недоступен. Попробуй позже.",
    oauth_identity_unlinked:
      "Сначала создай аккаунт Qubite или войди по email, затем привяжи этот способ в профиле.",
    oauth_identity_conflict:
      "Этот способ уже связан с другим аккаунтом. Войди своим способом.",
    oauth_state_failed: "Вход через провайдера не завершён. Начни его заново.",
    oauth_cancelled:
      "Вход отменён. Можно попробовать снова или войти по email.",
    provider_not_configured: "Этот способ входа сейчас недоступен.",
    provider_disabled: "Этот способ входа выключен владельцем.",
    oauth_context_changed: "Условия входа изменились. Начни вход заново.",
    provider_denied: "Вход через провайдера отменён.",
    provider_invalid_response:
      "Не удалось подтвердить ответ сервиса входа. Попробуй позже.",
    invalid_request: "Проверь заполненные поля и попробуй снова.",
    rate_limited:
      "Слишком много попыток. Подожди пять минут перед новой отправкой.",
  };
  return (
    (Object.hasOwn(messages, error.code) ? messages[error.code] : "") ||
    (error.status === 429
      ? messages.rate_limited
      : "Не удалось завершить действие. Попробуй позже.")
  );
}
