import type { Page, Route } from '@playwright/test';

/**
 * Поддельный сервер Qubite Auth для браузерных тестов: те же адреса и ответы, что у
 * настоящего (`/api/auth/*`, `/api/platform/status`), состояние — в памяти теста.
 */
export interface AuthMock {
  /** кто вошёл; `null` — гость */
  me: Record<string, unknown> | null;
  /** настоящий пароль владельца */
  password: string;
  platform: Record<string, unknown> & { login_methods: Record<string, boolean> };
  providers: { id: string; kind: string; bot_name?: string | null }[];
  registration: Record<string, unknown>;
  sessions: Record<string, unknown>[];
  identities: Record<string, unknown>[];
  /** все запросы браузера к /api: метод, путь, тело */
  calls: { method: string; path: string; body: Record<string, unknown> | null }[];
  /** неудачных входов подряд — после трёх нужна CAPTCHA */
  failures: number;
  /** код из письма (подтверждение и сброс) */
  mailCode: string;
  /** сохранённый текст экрана техработ */
  maintenanceText: string;
  /** тумблер почты выключен */
  emailOff: boolean;
}

/** Тумблеры глазами owner — как `GET /api/owner/platform`. */
function ownerItems(m: AuthMock) {
  const item = (key: string, value: unknown) => ({
    key,
    value,
    default: value,
    locked_by_env: false,
    version: 1,
  });
  return [
    item('maintenance.enabled', m.platform.maintenance),
    item('maintenance.message', m.maintenanceText),
    item('maintenance.until', m.platform.maintenance_until ?? null),
    item('platform.timezone', m.platform.timezone),
    item('login.enabled', m.platform.login_enabled),
    item('registration.mode', m.platform.registration_mode),
    ...Object.entries(m.platform.login_methods).map(([k, v]) => item(`login.methods.${k}`, v)),
  ];
}

export const OWNER = {
  id: '00000000-0000-4000-8000-000000000001',
  email: 'owner@example.com',
  display_name: 'Кирилл',
  is_owner: true,
  session_id: '00000000-0000-4000-8000-0000000000a1',
  session_expires_at: '2026-11-19T10:00:00Z',
};

/** Обычный пользователь (не owner). */
export const USER = {
  ...OWNER,
  id: '00000000-0000-4000-8000-000000000002',
  email: 'friend@example.com',
  display_name: 'Друг',
  is_owner: false,
};

/** Адреса, открытые во время техработ (как на сервере). */
const OPEN_DURING_MAINTENANCE = new Set([
  '/api/health',
  '/api/ready',
  '/api/platform/status',
  '/api/auth/login',
  '/api/auth/logout',
  '/api/auth/device/token',
  '/api/maintenance/pass',
]);

const json = (route: Route, status: number, body?: unknown) =>
  route.fulfill({
    status,
    contentType: 'application/json',
    body: body === undefined ? '' : JSON.stringify(body),
  });
const fail = (route: Route, status: number, error: string, message: string) =>
  json(route, status, { error, message });

/** Поддельный виджет Turnstile: кнопка «Я не робот» отдаёт токен. */
const FAKE_TURNSTILE = `window.turnstile = {
  render(el, o) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = 'Я не робот';
    b.onclick = () => o.callback('captcha-ok');
    el.appendChild(b);
    return 'w1';
  },
  reset() {},
  remove() {},
};`;

export async function mockAuth(page: Page, init: Partial<AuthMock> = {}): Promise<AuthMock> {
  const m: AuthMock = {
    me: null,
    password: 'правильный-пароль',
    platform: {
      login_enabled: true,
      login_methods: { password: true, yandex: true, vk: true, google: false, telegram: false },
      maintenance: false,
      registration_mode: 'invite_only',
      timezone: 'Asia/Yekaterinburg',
      login_captcha: { provider: 'turnstile', site_key: 'test-site-key' },
    },
    providers: [
      { id: 'yandex', kind: 'redirect' },
      { id: 'vk', kind: 'redirect' },
    ],
    registration: { mode: 'invite_only', invite_required: true, captcha: null },
    sessions: [
      {
        id: 's-here',
        current: true,
        kind: 'web',
        device_name: '',
        user_agent: 'Mozilla/5.0 (X11; Linux x86_64; rv:140.0) Gecko/20100101 Firefox/140.0',
        ip: '127.0.0.1',
        created_at: '2026-10-19T08:00:00Z',
        last_seen_at: '2026-10-19T09:00:00Z',
        expires_at: '2026-11-19T09:00:00Z',
      },
      {
        id: 's-phone',
        current: false,
        kind: 'web',
        device_name: '',
        user_agent: 'Mozilla/5.0 (Android 14; Mobile; rv:140.0) Gecko/140.0 Firefox/140.0',
        ip: '10.0.0.7',
        created_at: '2026-10-18T08:00:00Z',
        last_seen_at: '2026-10-18T21:00:00Z',
        expires_at: '2026-11-18T09:00:00Z',
      },
    ],
    identities: [],
    calls: [],
    failures: 0,
    mailCode: '123456',
    maintenanceText:
      'Qubite ненадолго закрылся на обновление: подкручиваем винтики и добавляем новое. Все ваши заметки и дела на месте — скоро вернёмся!',
    emailOff: false,
    ...init,
  };

  await page.route('https://challenges.cloudflare.com/**', (route) =>
    route.fulfill({ status: 200, contentType: 'text/javascript', body: FAKE_TURNSTILE }),
  );

  await page.route('**/api/**', async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const path = url.pathname;
    const method = req.method();
    let body: Record<string, unknown> | null;
    try {
      body = req.postDataJSON() as Record<string, unknown>;
    } catch {
      body = null;
    }
    m.calls.push({ method, path, body });
    const at = `${method} ${path}`;
    if (m.platform.maintenance && !m.me?.is_owner && !OPEN_DURING_MAINTENANCE.has(path))
      return fail(route, 503, 'maintenance', String(m.platform.maintenance_message ?? ''));
    const needMe = () =>
      m.me ? false : (fail(route, 401, 'unauthenticated', 'Нужно войти'), true);

    switch (at) {
      case 'GET /api/auth/me':
        return m.me ? json(route, 200, m.me) : fail(route, 401, 'unauthenticated', 'Нужно войти');
      case 'GET /api/platform/status':
        return json(route, 200, m.platform);
      case 'GET /api/auth/oauth/providers':
        return json(route, 200, m.providers);
      case 'GET /api/auth/registration':
        return json(route, 200, m.registration);
      case 'GET /api/owner/platform':
        return m.me?.is_owner
          ? json(route, 200, ownerItems(m))
          : fail(route, 404, 'not_found', 'Не найдено');
      case 'POST /api/owner/maintenance': {
        if (!m.me?.is_owner) return fail(route, 404, 'not_found', 'Не найдено');
        const on = body?.enabled === true;
        if (typeof body?.message === 'string') m.maintenanceText = body.message;
        m.platform.maintenance = on;
        m.platform.maintenance_message = on ? m.maintenanceText : null;
        m.platform.maintenance_until =
          on && body?.until === '10:00' ? '2099-01-01T05:00:00Z' : null;
        return json(route, 200, {
          enabled: on,
          effective: on,
          locked_by_env: false,
          message: m.maintenanceText,
          until: m.platform.maintenance_until,
        });
      }
      case 'POST /api/auth/login': {
        if (m.platform.maintenance && body?.email !== OWNER.email)
          return fail(route, 503, 'maintenance', String(m.platform.maintenance_message));
        if (m.failures >= 3 && !body?.captcha_token)
          return fail(
            route,
            401,
            'captcha_required',
            'Много неудачных попыток — подтвердите, что вы не робот',
          );
        if (body?.email !== OWNER.email || body?.password !== m.password) {
          m.failures += 1;
          return fail(route, 401, 'invalid_credentials', 'Неверная почта или пароль');
        }
        m.failures = 0;
        m.me = OWNER;
        return json(route, 200, { account: OWNER, csrf_token: 'csrf' });
      }
      case 'POST /api/auth/logout':
        m.me = null;
        return route.fulfill({ status: 204 });
      case 'POST /api/auth/logout-everywhere':
        m.me = null;
        return json(route, 200, { revoked: m.sessions.length });
      case 'POST /api/auth/register':
        if (m.emailOff)
          return fail(
            route,
            503,
            'email_disabled',
            'Почта сейчас выключена — регистрация невозможна',
          );
        if (m.registration.mode === 'closed')
          return fail(route, 403, 'registration_closed', 'Регистрация закрыта');
        if (m.registration.invite_required && body?.invite !== '7KQ2-M9XD-4TPR')
          return fail(route, 400, 'invalid_invite', 'Приглашение не найдено или уже использовано');
        return json(route, 202, { message: 'Проверьте почту' });
      case 'POST /api/auth/email/verify':
        if (body?.token === 'good-link' || body?.code === m.mailCode)
          return route.fulfill({ status: 204 });
        return fail(route, 400, 'invalid_code', 'Код не подошёл или устарел');
      case 'POST /api/auth/email/verify/request':
      case 'POST /api/auth/password/forgot':
        return json(route, 202, { message: 'Если аккаунт есть, письмо уже отправлено' });
      case 'POST /api/auth/password/reset':
        if (body?.code !== m.mailCode && body?.token !== 'good-link')
          return fail(route, 400, 'invalid_code', 'Код не подошёл или устарел');
        m.password = String(body?.password);
        return json(route, 200, { revoked: 2 });
      case 'GET /api/auth/sessions':
        return needMe() ? undefined : json(route, 200, m.sessions);
      case 'GET /api/auth/oauth/identities':
        return needMe() ? undefined : json(route, 200, m.identities);
      case 'POST /api/v1/telegram/link-code':
        if (body?.password !== m.password)
          return fail(route, 401, 'invalid_credentials', 'Пароль не подошёл');
        return json(route, 200, { url: 'https://t.me/qubite_test_bot?start=abc', expires_in: 600 });
      case 'POST /api/auth/device/authorize':
        return needMe()
          ? undefined
          : json(route, 200, { redirect_to: `/app-callback?code=one-time&state=${body?.state}` });
    }
    if (method === 'DELETE' && path.startsWith('/api/auth/sessions/')) {
      const id = path.split('/').pop();
      m.sessions = m.sessions.filter((s) => s.id !== id);
      return route.fulfill({ status: 204 });
    }
    const link = path.match(/^\/api\/auth\/oauth\/(\w+)\/link$/);
    if (method === 'POST' && link) {
      if (body?.password !== m.password)
        return fail(route, 401, 'invalid_credentials', 'Пароль не подошёл');
      return json(route, 200, { authorize_url: `/provider-page?provider=${link[1]}` });
    }
    // остальное (синхронизация и т. п.) этим тестам не нужно
    return fail(route, 404, 'not_found', 'Не найдено');
  });
  return m;
}
