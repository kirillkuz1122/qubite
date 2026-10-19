import type { Page, Route } from '@playwright/test';
import { OWNER, USER, type AuthMock } from './auth-mock';

/**
 * Поддельный Owner Console API (`/api/owner/*`, ACC-003) поверх `mockAuth`: те же адреса и
 * ответы, что у настоящего сервера — версии тумблеров и 409, пароль для опасных действий,
 * люди, модули, доступ, журнал. Техработы (`/api/owner/maintenance`) остаются у `mockAuth`.
 */
export interface ConsoleMock {
  items: Map<string, { key: string; value: unknown; version: number }>;
  accounts: Record<string, unknown>[];
  modules: Record<string, unknown>[];
  grants: Map<string, Record<string, unknown>[]>;
  audit: Record<string, unknown>[];
  invitations: Record<string, unknown>[];
  /** пароль подтверждён (на 5 минут) */
  confirmed: boolean;
  /** «другая вкладка» поменяла тумблер: новая версия */
  changeElsewhere(key: string, value: unknown): void;
}

const json = (route: Route, status: number, body: unknown) =>
  route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
const fail = (route: Route, status: number, error: string, message: string) =>
  json(route, status, { error, message });

const AT = '2026-10-19T09:00:00Z';

export async function mockConsole(page: Page, auth: AuthMock): Promise<ConsoleMock> {
  const p = auth.platform;
  const start: [string, unknown][] = [
    ['registration.mode', p.registration_mode],
    ['login.enabled', p.login_enabled],
    ...Object.entries(p.login_methods).map(
      ([k, v]) => [`login.methods.${k}`, v] as [string, unknown],
    ),
    ['email.enabled', true],
    ['captcha.provider', 'turnstile'],
    ['platform.timezone', p.timezone],
  ];
  let seq = 100;
  const log = (actor: string | null, action: string, target: string, after: unknown) =>
    c.audit.unshift({
      seq: ++seq,
      at: AT,
      actor_id: actor ? OWNER.id : null,
      actor_email: actor,
      action,
      target_kind: 'account',
      target_id: target,
      before: null,
      after,
      reason: null,
    });
  const person = (a: { id: string; email: string; display_name: string }, owner: boolean) => ({
    ...a,
    status: 'active',
    is_owner: owner,
    created_at: AT,
    last_seen_at: AT,
    sessions: 1,
    modules: 0,
    has_password: true,
    providers: owner ? ['telegram'] : [],
  });
  const c: ConsoleMock = {
    items: new Map(start.map(([key, value]) => [key, { key, value, version: 1 }])),
    accounts: [person(OWNER, true), person(USER, false)],
    modules: [
      ['docs', 'Docs', true],
      ['planner', 'Planner', true],
      ['search', 'Search', false],
    ].map(([id, title, installed]) => ({
      id,
      title,
      installed,
      state: 'enabled',
      readiness: 'beta',
      visibility: 'locked',
      version: 1,
      updated_at: AT,
    })),
    grants: new Map(),
    audit: [
      {
        seq: 1,
        at: AT,
        actor_id: OWNER.id,
        actor_email: OWNER.email,
        action: 'auth.login',
        target_kind: 'session',
        target_id: 's-1',
        before: null,
        after: { method: 'password' },
        reason: null,
      },
    ],
    invitations: [],
    confirmed: false,
    changeElsewhere(key, value) {
      const item = c.items.get(key)!;
      c.items.set(key, { key, value, version: item.version + 1 });
    },
  };
  const items = () =>
    [
      // техработы — из mockAuth (их меняет пульт)
      { key: 'maintenance.enabled', value: p.maintenance, version: 1 },
      { key: 'maintenance.message', value: auth.maintenanceText, version: 1 },
      { key: 'maintenance.until', value: p.maintenance_until ?? null, version: 1 },
      ...c.items.values(),
    ].map((i) => ({ ...i, default: i.value, locked_by_env: false }));
  /** тумблер сохранили — экраны входа это сразу видят */
  const apply = (key: string, value: unknown) => {
    if (key === 'login.enabled') p.login_enabled = value;
    else if (key === 'registration.mode') p.registration_mode = value;
    else if (key === 'platform.timezone') p.timezone = value;
    else if (key.startsWith('login.methods.'))
      p.login_methods[key.slice('login.methods.'.length)] = value === true;
  };
  const account = (id: string) => c.accounts.find((a) => a.id === id);

  await page.route('**/api/owner/**', async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const path = url.pathname;
    const method = req.method();
    if (path === '/api/owner/maintenance') return route.fallback();
    let body: Record<string, unknown> | null;
    try {
      body = req.postDataJSON() as Record<string, unknown>;
    } catch {
      body = null;
    }
    auth.calls.push({ method, path, body });
    if (!auth.me?.is_owner) return fail(route, 404, 'not_found', 'Не найдено');
    const at = `${method} ${path}`;
    const danger = () =>
      c.confirmed
        ? false
        : (fail(route, 403, 'confirm_required', 'Подтвердите паролем — это опасное действие'),
          true);

    if (at === 'GET /api/owner/platform') return json(route, 200, items());
    if (at === 'PATCH /api/owner/platform') {
      const changes = (body?.changes ?? []) as { key: string; value: unknown; version: number }[];
      if (changes.some((ch) => c.items.get(ch.key)?.version !== ch.version))
        return fail(route, 409, 'conflict', 'Кто-то уже изменил настройку — обновите страницу');
      for (const ch of changes) {
        const was = c.items.get(ch.key)!;
        c.items.set(ch.key, { key: ch.key, value: ch.value, version: was.version + 1 });
        apply(ch.key, ch.value);
        log(OWNER.email, 'platform.setting_changed', ch.key, { [ch.key]: ch.value });
      }
      return json(route, 200, items());
    }
    if (at === 'POST /api/owner/confirm') {
      if (body?.password !== auth.password)
        return fail(route, 401, 'invalid_credentials', 'Неверная почта или пароль');
      c.confirmed = true;
      return json(route, 200, { until: '2026-10-19T09:05:00Z' });
    }
    if (at === 'GET /api/owner/accounts') {
      const q = (url.searchParams.get('q') ?? '').toLowerCase();
      const status = url.searchParams.get('status') ?? '';
      return json(
        route,
        200,
        c.accounts.filter(
          (a) =>
            (!q || `${String(a.email)} ${String(a.display_name)}`.toLowerCase().includes(q)) &&
            (!status || a.status === status),
        ),
      );
    }
    if (at === 'POST /api/owner/accounts') {
      if (danger()) return;
      if (String(body?.password ?? '').length < 10)
        return fail(route, 400, 'invalid', 'Пароль слишком короткий: нужно не меньше 10 символов');
      const made = person(
        {
          id: `00000000-0000-4000-8000-${String(c.accounts.length + 10).padStart(12, '0')}`,
          email: String(body?.email),
          display_name: String(body?.display_name ?? ''),
        },
        false,
      );
      made.sessions = 0;
      c.accounts.unshift(made);
      log(OWNER.email, 'account.created', made.id, { email: made.email });
      return json(route, 201, made);
    }
    let m = /^\/api\/owner\/accounts\/([^/]+)$/.exec(path);
    if (m && method === 'PATCH') {
      const a = account(m[1]!);
      if (!a) return fail(route, 404, 'not_found', 'Не найдено');
      if (danger()) return;
      a.status = body?.status === 'blocked' ? 'blocked' : 'active';
      if (a.status === 'blocked') a.sessions = 0;
      log(
        OWNER.email,
        a.status === 'blocked' ? 'account.blocked' : 'account.unblocked',
        a.id as string,
        {
          status: a.status,
        },
      );
      return json(route, 200, a);
    }
    m = /^\/api\/owner\/accounts\/([^/]+)\/sessions\/revoke$/.exec(path);
    if (m) {
      const a = account(m[1]!);
      if (!a) return fail(route, 404, 'not_found', 'Не найдено');
      if (danger()) return;
      const revoked = a.sessions;
      a.sessions = 0;
      return json(route, 200, { revoked });
    }
    m = /^\/api\/owner\/accounts\/([^/]+)\/grants(?:\/([^/]+))?$/.exec(path);
    if (m) {
      const [, id, moduleId] = m as unknown as [string, string, string | undefined];
      const list = c.grants.get(id) ?? [];
      const a = account(id);
      if (method === 'GET') return json(route, 200, list);
      const rest = list.filter((g) => g.module_id !== moduleId);
      if (method === 'PUT') {
        const grant = {
          module_id: moduleId,
          flags: body,
          granted_by: OWNER.id,
          granted_at: AT,
          version: 1,
        };
        c.grants.set(id, [...rest, grant]);
        log(OWNER.email, 'module.grant_set', id, { module: moduleId, ...body });
        if (a) a.modules = rest.length + 1;
        return json(route, 200, grant);
      }
      c.grants.set(id, rest);
      log(OWNER.email, 'module.grant_revoked', id, { module: moduleId });
      if (a) a.modules = rest.length;
      return route.fulfill({ status: 204 });
    }
    if (at === 'GET /api/owner/modules') return json(route, 200, c.modules);
    m = /^\/api\/owner\/modules\/([^/]+)$/.exec(path);
    if (m && method === 'PATCH') {
      const mod = c.modules.find((x) => x.id === m![1]);
      if (!mod) return fail(route, 404, 'not_found', 'Не найдено');
      if (body?.expected_version !== mod.version)
        return fail(route, 400, 'invalid', 'Модуль уже изменили — обновите страницу');
      const patch = { ...body };
      delete patch.expected_version;
      Object.assign(mod, patch, { version: (mod.version as number) + 1 });
      return json(route, 200, mod);
    }
    if (at === 'GET /api/owner/invitations') return json(route, 200, c.invitations);
    if (at === 'POST /api/owner/invitations') {
      const inv = {
        id: `inv-${c.invitations.length + 1}`,
        kind: body?.email ? 'email_bound' : 'open_link',
        email: body?.email ?? null,
        note: '',
        created_at: AT,
        expires_at: '2026-10-26T09:00:00Z',
        used_at: null,
        used_by_email: null,
        revoked_at: null,
        status: 'active',
      };
      c.invitations.unshift(inv);
      return json(route, 201, {
        id: inv.id,
        code: '7KQ2-M9XD-4TPR',
        link: 'https://auth.qubiteapp.ru/register?invite=7KQ2M9XD4TPR',
        expires_at: inv.expires_at,
        emailed: false,
      });
    }
    m = /^\/api\/owner\/invitations\/([^/]+)$/.exec(path);
    if (m && method === 'DELETE') {
      const inv = c.invitations.find((x) => x.id === m![1]);
      if (inv) inv.status = 'revoked';
      return route.fulfill({ status: 204 });
    }
    if (at === 'GET /api/owner/audit') {
      const kind = url.searchParams.get('kind') ?? '';
      return json(
        route,
        200,
        c.audit.filter((e) => !kind || String(e.action).startsWith(`${kind}.`)),
      );
    }
    if (at === 'GET /api/owner/server')
      return json(route, 200, {
        version: '0.1.0',
        started_at: AT,
        uptime_secs: 7500,
        migration: 22,
        accounts: c.accounts.length,
        sessions: 3,
        audit_entries: c.audit.length,
      });
    if (at === 'GET /api/owner/ai/models')
      return json(route, 200, [
        {
          id: 'google/gemini-2.5-flash-lite',
          external_id: 'google/gemini-2.5-flash-lite',
          provider_id: 'openrouter',
          enabled: true,
          context_tokens: 1_000_000,
          price_in_per_mtok: 100_000,
          price_out_per_mtok: 400_000,
          routing_providers: [],
          tasks: ['inbox.triage'],
        },
      ]);
    if (at === 'GET /api/owner/ai/tasks')
      return json(route, 200, [{ task: 'inbox.triage', model_id: 'google/gemini-2.5-flash-lite' }]);
    return fail(route, 404, 'not_found', `нет в подделке: ${at}`);
  });
  return c;
}
