import { describe, expect, it } from 'vitest';
import { ACCOUNT_HEADER, createQubiteClient, csrfFromCookie } from './index';

describe('createQubiteClient', () => {
  it('ходит на /api/health и возвращает типизированный ответ', async () => {
    const calls: string[] = [];
    const fakeFetch: typeof fetch = async (input) => {
      const request = input as Request;
      calls.push(new URL(request.url).pathname);
      return new Response(JSON.stringify({ status: 'ok', version: '0.1.0' }), {
        headers: { 'content-type': 'application/json' },
      });
    };
    const client = createQubiteClient({ baseUrl: 'http://qubite.test', fetch: fakeFetch });

    const { data, error } = await client.GET('/api/health');

    expect(error).toBeUndefined();
    expect(data?.status).toBe('ok');
    expect(calls).toEqual(['/api/health']);
  });

  it('добавляет CSRF-токен только к изменяющим запросам', async () => {
    const seen: Array<[string, string | null]> = [];
    const fakeFetch: typeof fetch = async (input) => {
      const request = input as Request;
      seen.push([request.method, request.headers.get('x-csrf-token')]);
      return new Response(null, { status: 204 });
    };
    const client = createQubiteClient({
      baseUrl: 'http://qubite.test',
      fetch: fakeFetch,
      csrfToken: () => 'csrf-123',
    });

    await client.GET('/api/auth/me');
    await client.POST('/api/auth/logout');

    expect(seen).toEqual([
      ['GET', null],
      ['POST', 'csrf-123'],
    ]);
  });

  it('называет аккаунт в запросах данных, но не в /api/auth; «вошёл другой» — сигнал', async () => {
    const seen: Array<[string, string | null]> = [];
    let reply = () => new Response(null, { status: 204 });
    const fakeFetch: typeof fetch = async (input) => {
      const request = input as Request;
      seen.push([new URL(request.url).pathname, request.headers.get('x-qubite-account')]);
      return reply();
    };
    let account: string | undefined = 'account-a';
    let mismatches = 0;
    const client = createQubiteClient({
      baseUrl: 'http://qubite.test',
      fetch: fakeFetch,
      account: () => account,
      onAccountMismatch: () => (mismatches += 1),
    });

    await client.GET('/api/v1/inbox');
    // Кто вошёл и вход/выход — без заголовка: ими это и выясняют.
    await client.GET('/api/auth/me');
    // Явно названный аккаунт (очередь, выход) не подменяется.
    await client.POST('/api/auth/logout', { headers: { [ACCOUNT_HEADER]: 'account-b' } });
    account = undefined;
    await client.GET('/api/v1/inbox');
    expect(seen).toEqual([
      ['/api/v1/inbox', 'account-a'],
      ['/api/auth/me', null],
      ['/api/auth/logout', 'account-b'],
      ['/api/v1/inbox', null],
    ]);
    expect(mismatches).toBe(0);

    reply = () =>
      new Response(JSON.stringify({ error: 'account_mismatch', message: 'другой аккаунт' }), {
        status: 409,
        headers: { 'content-type': 'application/json' },
      });
    const { error } = await client.GET('/api/v1/inbox');
    expect(error).toMatchObject({ error: 'account_mismatch' });
    expect(mismatches).toBe(1);
    // Обычный 409 (например, занятая почта) — не про аккаунт.
    reply = () =>
      new Response(JSON.stringify({ error: 'email_taken', message: 'занято' }), {
        status: 409,
        headers: { 'content-type': 'application/json' },
      });
    await client.GET('/api/v1/inbox');
    expect(mismatches).toBe(1);
  });

  it('читает CSRF-токен из cookie', () => {
    expect(csrfFromCookie('a=1; qubite_csrf=abc-DEF_9; b=2')).toBe('abc-DEF_9');
    expect(csrfFromCookie('a=1')).toBeUndefined();
  });

  it('маршрут: координаты только в теле POST, cookie и CSRF включены', async () => {
    const calls: Request[] = [];
    const response = {
      minutes: 12,
      meters: 3400,
      geometry: [
        { lat: 55.16, lon: 61.4 },
        { lat: 55.17, lon: 61.42 },
      ],
      place_text: 'Челябинск, площадь Революции',
      to: { lat: 55.17, lon: 61.42 },
      provider: 'osrm',
      attribution: '© OpenStreetMap',
    };
    const client = createQubiteClient({
      baseUrl: 'http://qubite.test',
      csrfToken: () => 'csrf-route',
      fetch: async (input) => {
        calls.push(input as Request);
        return new Response(JSON.stringify(response), {
          headers: { 'content-type': 'application/json' },
        });
      },
    });
    const { data } = await client.POST('/api/v1/planner/tasks/{id}/route', {
      params: { path: { id: 'task-1' } },
      body: { from: { lat: 55.16, lon: 61.4 } },
      cache: 'no-store',
    });
    expect(data).toEqual(response);
    const request = calls[0]!;
    expect(request.url).toBe('http://qubite.test/api/v1/planner/tasks/task-1/route');
    expect(request.method).toBe('POST');
    expect(request.credentials).toBe('include');
    expect(request.headers.get('X-CSRF-Token')).toBe('csrf-route');
    expect(request.cache).toBe('no-store');
    expect(await request.json()).toEqual({ from: { lat: 55.16, lon: 61.4 } });
  });
});
