import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { createQubiteClient } from '@qubite/api-client';
import { ServerStatus } from './ServerStatus';

function renderWith(fetchImpl: typeof fetch) {
  const client = createQubiteClient({ baseUrl: 'http://qubite.test', fetch: fetchImpl });
  const queries = new QueryClient();
  render(
    <QueryClientProvider client={queries}>
      <ServerStatus client={client} />
    </QueryClientProvider>,
  );
}

describe('ServerStatus', () => {
  it.each([
    ['0123456789ab', 'Сервер работает · версия 9.9.9 · 0123456789ab'],
    [null, 'Сервер работает · версия 9.9.9'],
  ] as const)('показывает версию с коммитом %s, когда сервер отвечает', async (commit, line) => {
    renderWith(
      async () =>
        new Response(
          JSON.stringify({
            status: 'ok',
            version: '9.9.9',
            deploy: { commit, built_at: null, deployed_at: null, rollback: null },
          }),
          { headers: { 'content-type': 'application/json' } },
        ),
    );
    expect(await screen.findByText(line)).toBeInTheDocument();
  });

  it('честно пишет, что сервер недоступен', async () => {
    renderWith(async () => new Response('down', { status: 503 }));
    expect(await screen.findByText('Сервер недоступен')).toBeInTheDocument();
  });
});
