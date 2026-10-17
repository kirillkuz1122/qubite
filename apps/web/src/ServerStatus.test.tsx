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
  it('показывает версию, когда сервер отвечает', async () => {
    renderWith(
      async () =>
        new Response(JSON.stringify({ status: 'ok', version: '9.9.9' }), {
          headers: { 'content-type': 'application/json' },
        }),
    );
    expect(await screen.findByText('Сервер работает · версия 9.9.9')).toBeInTheDocument();
  });

  it('честно пишет, что сервер недоступен', async () => {
    renderWith(async () => new Response('down', { status: 503 }));
    expect(await screen.findByText('Сервер недоступен')).toBeInTheDocument();
  });
});
