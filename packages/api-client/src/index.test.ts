import { describe, expect, it } from 'vitest';
import { createQubiteClient, csrfFromCookie } from './index';

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

  it('читает CSRF-токен из cookie', () => {
    expect(csrfFromCookie('a=1; qubite_csrf=abc-DEF_9; b=2')).toBe('abc-DEF_9');
    expect(csrfFromCookie('a=1')).toBeUndefined();
  });
});
