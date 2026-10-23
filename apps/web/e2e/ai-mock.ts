import type { Page, Route } from '@playwright/test';
import { OWNER, USER, type AuthMock } from './auth-mock';
import type { ConsoleMock } from './console-mock';

/**
 * Поддельные AI-адреса AI-003 поверх `mockAuth` и `mockConsole`: `/api/owner/ai/{overview,
 * limits,unlimited,owner-unlimited,loop-guard,keys,usage,calls}` и «AI и бюджет» человека
 * `/api/ai/me…`. Те же ответы, что у настоящего сервера (как в 22.10 у владельца: личный лимит
 * owner в $ кончился, потолка платформы нет). Опасное без пароля — `confirm_required`.
 */
export interface AiMock {
  limits: Record<string, unknown>[];
  unlimited: boolean;
  guard: {
    user_per_minute: number;
    job_per_minute: number;
    repeat_limit: number;
    repeat_window_secs: number;
  };
  guardFromConsole: boolean;
  key: string | null;
  /** «AI и бюджет» у вошедшего: источник, ключ, ChatGPT. */
  source: string;
  ownKey: string | null;
  chatgpt: { available: boolean; connected: boolean; email: string | null };
  started: number;
}

const json = (route: Route, status: number, body: unknown) =>
  route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
const fail = (route: Route, status: number, error: string, message: string) =>
  json(route, status, { error, message });

const AT = '2026-10-22T09:00:00Z';

function bodyOf(req: { postDataJSON(): unknown }): Record<string, unknown> {
  try {
    return (req.postDataJSON() as Record<string, unknown>) ?? {};
  } catch {
    return {};
  }
}
const SERVER_GUARD = {
  user_per_minute: 20,
  job_per_minute: 10,
  repeat_limit: 3,
  repeat_window_secs: 600,
};

function days(n: number, spend: (i: number) => number) {
  const out = [];
  const today = new Date('2026-10-22T12:00:00Z');
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(today.getTime() - i * 86_400_000).toISOString().slice(0, 10);
    const usd = spend(i);
    out.push({ key: d, usd, requests: usd > 0 ? Math.round(usd / 2000) : 0, tokens: usd * 2 });
  }
  return out;
}

function usage(n: number, mine: boolean) {
  const byDay = days(n, (i) => (i % 3 === 0 ? 0 : 40_000 + ((i * 7919) % 90_000)));
  const sum = (k: 'usd' | 'requests' | 'tokens') => byDay.reduce((a, r) => a + r[k], 0);
  const total = { key: 'total', usd: sum('usd'), requests: sum('requests'), tokens: sum('tokens') };
  const row = (key: string, part: number) => ({
    key,
    usd: Math.round(total.usd * part),
    requests: Math.round(total.requests * part),
    tokens: Math.round(total.tokens * part),
  });
  return {
    days: n,
    total,
    by_day: byDay,
    by_module: [row('english', 0.7), row('agent', 0.3)],
    by_model: [row('google/gemini-2.5-flash-lite', 0.6), row('elevenlabs/scribe_v1', 0.4)],
    by_person: mine ? [] : [row(OWNER.email, 0.9), row(USER.email, 0.1)],
    by_payer: [row('platform', 0.8), row('subscription', 0.2)],
  };
}

const calls = [
  {
    id: 'c1',
    at: AT,
    account_email: OWNER.email,
    module_id: 'english',
    model_id: 'google/gemini-2.5-flash-lite',
    status: 'succeeded',
    error_code: null,
    actual_usd: 1200,
    estimate_usd: 4000,
    tokens_in: 900,
    tokens_out: 120,
    paid_by: 'platform',
    attempts: 1,
  },
  {
    id: 'c2',
    at: '2026-10-22T08:59:00Z',
    account_email: OWNER.email,
    module_id: 'english',
    model_id: 'elevenlabs/scribe_v1',
    status: 'failed_not_sent',
    error_code: 'budget_exhausted',
    actual_usd: null,
    estimate_usd: 3000,
    tokens_in: null,
    tokens_out: null,
    paid_by: 'platform',
    attempts: 1,
  },
];

export async function mockAi(page: Page, auth: AuthMock, console: ConsoleMock | null) {
  let seq = 0;
  const ai: AiMock = {
    limits: [
      {
        id: 'l-owner',
        scope: 'user',
        account_id: OWNER.id,
        account_email: OWNER.email,
        module_id: null,
        model_id: null,
        provider_id: null,
        period: 'day',
        metric: 'usd',
        value: 500_000,
        used: 500_000,
        created_at: AT,
      },
      {
        id: 'l-friend',
        scope: 'user',
        account_id: USER.id,
        account_email: USER.email,
        module_id: null,
        model_id: null,
        provider_id: null,
        period: 'day',
        metric: 'usd',
        value: 1_000_000,
        used: 120_000,
        created_at: AT,
      },
    ],
    unlimited: true,
    guard: { ...SERVER_GUARD },
    guardFromConsole: false,
    key: null,
    source: 'owner',
    ownKey: null,
    chatgpt: { available: true, connected: false, email: null },
    started: 0,
  };
  const audit = (action: string, after: unknown) =>
    console?.audit.unshift({
      seq: 1000 + ++seq,
      at: AT,
      actor_id: OWNER.id,
      actor_email: OWNER.email,
      action,
      target_kind: 'ai_limit',
      target_id: null,
      before: null,
      after,
      reason: null,
    });
  const personal = () =>
    ai.limits.filter((l) => l.metric === 'usd' && l.account_id === OWNER.id && l.scope === 'user');
  const cap = () =>
    ai.limits.find((l) => l.scope === 'platform' && l.period === 'day' && l.metric === 'usd') ??
    null;
  const overview = () => ({
    owner_unlimited: ai.unlimited,
    owner_personal_usd: personal(),
    platform_day_usd: cap(),
    unlimited_works: ai.unlimited && personal().length === 0 && cap() !== null,
    default_platform_day_usd: 5_000_000,
    loop_guard: ai.guard,
    loop_guard_server: SERVER_GUARD,
    loop_guard_from_console: ai.guardFromConsole,
    keys: [
      {
        provider: 'openrouter',
        source: ai.key ? 'console' : 'server',
        hint: ai.key?.slice(-4) ?? null,
      },
    ],
    secret_key_set: true,
    chatgpt_enabled: true,
    chatgpt_people: ai.chatgpt.connected ? 1 : 0,
    voice: true,
    timezone: 'Asia/Yekaterinburg',
    today_usd: 61_000,
    today_requests: 31,
  });

  await page.route('**/api/owner/ai/**', async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const at = `${req.method()} ${url.pathname}`;
    const body = bodyOf(req);
    const mine =
      /^(GET|POST|PUT|DELETE) \/api\/owner\/ai\/(overview|limits|unlimited|owner-unlimited|loop-guard|keys|usage|calls)/.test(
        at,
      );
    if (!mine) return route.fallback();
    auth.calls.push({ method: req.method(), path: url.pathname, body });
    if (!auth.me?.is_owner) return fail(route, 404, 'not_found', 'Не найдено');
    const danger = () =>
      console && !console.confirmed
        ? (fail(route, 403, 'confirm_required', 'Подтвердите паролем — это опасное действие'), true)
        : false;
    if (at === 'GET /api/owner/ai/overview') return json(route, 200, overview());
    if (at === 'GET /api/owner/ai/limits') return json(route, 200, ai.limits);
    if (at === 'POST /api/owner/ai/limits') {
      if (danger()) return;
      if (typeof body.value !== 'number' || body.value < 0)
        return fail(route, 400, 'invalid', 'лимит не может быть отрицательным');
      const same = (l: Record<string, unknown>) =>
        ['scope', 'account_id', 'module_id', 'model_id', 'provider_id', 'period', 'metric'].every(
          (k) => (l[k] ?? null) === (body[k] ?? null),
        );
      ai.limits = ai.limits.filter((l) => !same(l));
      const email =
        body.account_id === OWNER.id
          ? OWNER.email
          : body.account_id === USER.id
            ? USER.email
            : null;
      ai.limits.push({ id: `l${++seq}`, used: 0, created_at: AT, account_email: email, ...body });
      audit('ai.limit_set', body);
      return json(route, 200, ai.limits);
    }
    if (req.method() === 'DELETE' && url.pathname.startsWith('/api/owner/ai/limits/')) {
      if (danger()) return;
      const id = url.pathname.split('/').pop();
      const before = ai.limits.length;
      ai.limits = ai.limits.filter((l) => l.id !== id);
      if (ai.limits.length === before) return fail(route, 400, 'invalid', 'такого лимита нет');
      audit('ai.limit_revoked', { id });
      return json(route, 200, ai.limits);
    }
    if (at === 'POST /api/owner/ai/unlimited') {
      if (danger()) return;
      ai.limits = ai.limits.filter((l) => !personal().includes(l));
      if (!cap())
        ai.limits.unshift({
          id: `l${++seq}`,
          scope: 'platform',
          account_id: null,
          account_email: null,
          period: 'day',
          metric: 'usd',
          value: 5_000_000,
          used: 0,
          created_at: AT,
        });
      ai.unlimited = true;
      audit('ai.owner_unlimited_set', { enabled: true });
      return json(route, 200, overview());
    }
    if (at === 'PUT /api/owner/ai/owner-unlimited') {
      if (danger()) return;
      ai.unlimited = body.enabled === true;
      return json(route, 200, overview());
    }
    if (at === 'PUT /api/owner/ai/loop-guard') {
      if (danger()) return;
      if (body.reset) {
        ai.guard = { ...SERVER_GUARD };
        ai.guardFromConsole = false;
      } else {
        const w = Number(body.repeat_window_secs ?? ai.guard.repeat_window_secs);
        if (w < 1 || w > 86_400)
          return fail(route, 400, 'invalid', 'окно повторов — от 1 до 86 400 секунд');
        ai.guard = { ...ai.guard, ...(body as Partial<AiMock['guard']>) };
        ai.guardFromConsole = true;
      }
      audit('ai.loop_guard_set', ai.guard);
      return json(route, 200, overview());
    }
    if (at === 'PUT /api/owner/ai/keys/openrouter') {
      if (danger()) return;
      ai.key = String(body.key);
      audit('ai.key_set', { hint: ai.key.slice(-4) });
      return json(route, 200, overview());
    }
    if (at === 'DELETE /api/owner/ai/keys/openrouter') {
      if (danger()) return;
      ai.key = null;
      return json(route, 200, overview());
    }
    if (at === 'GET /api/owner/ai/usage')
      return json(route, 200, usage(Number(url.searchParams.get('days') ?? 30), false));
    if (at === 'GET /api/owner/ai/calls')
      return json(route, 200, url.searchParams.get('before') ? [] : calls);
    return fail(route, 404, 'not_found', `нет в подделке: ${at}`);
  });

  const my = () => {
    const meId = auth.me?.id;
    const isOwner = auth.me?.is_owner === true;
    return {
      is_owner: isOwner,
      source: ai.source,
      limits: ai.limits.filter(
        (l) => l.account_id === meId || l.scope === 'platform' || l.scope === 'each_user',
      ),
      owner_allows: ai.limits.some((l) => l.account_id === meId && l.metric === 'usd'),
      owner_unlimited: isOwner && ai.unlimited,
      chatgpt: {
        available: ai.chatgpt.available,
        unavailable_reason: ai.chatgpt.available ? null : 'ChatGPT по подписке выключен на сервере',
        connected: ai.chatgpt.connected,
        email: ai.chatgpt.email,
        model: null,
        models: ai.chatgpt.connected ? ['chatgpt:gpt-6.1-sol'] : [],
        last_error: null,
      },
      own_key_hint: ai.ownKey?.slice(-4) ?? null,
      keys_available: true,
      usage: usage(30, true),
      calls: calls.map((c) => ({ ...c, account_email: auth.me?.email })),
    };
  };
  await page.route('**/api/ai/me**', async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const at = `${req.method()} ${url.pathname}`;
    const body = bodyOf(req);
    auth.calls.push({ method: req.method(), path: url.pathname, body });
    if (!auth.me) return fail(route, 401, 'unauthorized', 'Войдите');
    if (at === 'GET /api/ai/me') return json(route, 200, my());
    if (at === 'PUT /api/ai/me/source') {
      ai.source = String(body.source);
      return json(route, 200, my());
    }
    if (at === 'PUT /api/ai/me/key') {
      const key = String(body.key ?? '');
      if (key.length < 16) return fail(route, 400, 'invalid', 'ключ не похож на ключ API');
      ai.ownKey = key;
      ai.source = 'own_key';
      return json(route, 200, my());
    }
    if (at === 'DELETE /api/ai/me/key') {
      ai.ownKey = null;
      if (ai.source === 'own_key') ai.source = 'owner';
      return json(route, 200, my());
    }
    if (at === 'POST /api/ai/me/chatgpt/start') {
      ai.started++;
      return json(route, 200, {
        url: 'about:blank#openai-login',
        redirect_uri: 'http://127.0.0.1:41234/auth/callback',
      });
    }
    if (at === 'POST /api/ai/me/chatgpt/finish') {
      if (!String(body.callback).includes('code='))
        return fail(route, 400, 'chatgpt_login_failed', 'в адресе нет кода входа');
      ai.chatgpt = { available: true, connected: true, email: 'me@chatgpt.example' };
      ai.source = 'chatgpt';
      return json(route, 200, my());
    }
    if (at === 'DELETE /api/ai/me/chatgpt') {
      ai.chatgpt = { available: true, connected: false, email: null };
      if (ai.source === 'chatgpt') ai.source = 'owner';
      return json(route, 200, my());
    }
    return fail(route, 404, 'not_found', `нет в подделке: ${at}`);
  });
  return ai;
}
