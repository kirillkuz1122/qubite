import { describe, expect, it } from 'vitest';
import { createQubiteClient } from './index';

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
});
