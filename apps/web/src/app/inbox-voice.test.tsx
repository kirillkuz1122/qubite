import 'fake-indexeddb/auto';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import {
  SyncClient,
  type ObjectSnapshot,
  type PushRequest,
  type PushResponse,
  type Transport,
  type VoiceCapture,
  type VoiceTransport,
} from '@qubite/sync-client';
import { describe, expect, it } from 'vitest';
import { InboxProvider } from './inbox';
import { useInbox } from './inbox-context';
import { SyncProvider } from './sync';

/**
 * Сервер в памяти: синхронизация и `POST /api/v1/inbox/voice`. Как настоящий (D-847): запись
 * с тем же ID второй раз не создаётся; без гранта на AI — «Голосовая запись» и причина.
 */
class Server implements Transport, VoiceTransport {
  objects = new Map<string, ObjectSnapshot>();
  log: string[] = [];
  offline = false;
  /** что «распознал» сервер; `null` — нет гранта на AI */
  heard: string | null = 'Купить хлеб';
  voiceCalls: VoiceCapture[] = [];

  async push(request: PushRequest): Promise<PushResponse> {
    if (this.offline) throw new TypeError('Failed to fetch');
    return {
      results: request.ops.map((op) => ({ status: 'applied', op_id: op.op_id, revision: 1 })),
    };
  }

  async pull(cursor: number) {
    if (this.offline) throw new TypeError('Failed to fetch');
    const ids = [...new Set(this.log.slice(cursor))];
    return {
      changes: ids.map((id) => this.objects.get(id)!),
      cursor: this.log.length,
      has_more: false,
    };
  }

  async send(capture: VoiceCapture) {
    this.voiceCalls.push(capture);
    if (this.offline) throw new TypeError('Failed to fetch');
    if (!this.objects.has(capture.id)) {
      const body = this.heard ?? 'Голосовая запись';
      this.objects.set(capture.id, {
        id: capture.id,
        object_type: 'inbox.item',
        title: body,
        revision: 1,
        deleted: false,
        updated_at_ms: Date.now(),
        fields: { body, kind: 'voice', source: capture.source, status: 'new' },
      });
      this.log.push(capture.id);
    }
    return this.heard
      ? { transcribed: true, reason: null }
      : { transcribed: false, reason: 'Нет разрешения на AI-распознавание' };
  }
}

function Probe() {
  const inbox = useInbox();
  return (
    <div>
      <button
        type="button"
        onClick={() =>
          void inbox.voice({ audio_base64: 'bW9jaw==', mime: 'audio/webm', duration_ms: 1500 })
        }
      >
        сказать
      </button>
      <ul>
        {inbox.items.map((x) => (
          <li key={x.id} data-testid="row">
            {x.text} · {x.src} · {x.hint} · {x.acts.map(([label]) => label).join('/')} ·{' '}
            {x.voice?.bare ? 'без текста' : 'с текстом'} · {x.voice?.audio ?? 'нет звука'}
          </li>
        ))}
      </ul>
    </div>
  );
}

let n = 0;
function view(server: Server) {
  const dbName = `inbox-voice-${++n}`;
  return (
    <SyncProvider
      dbName={dbName}
      live={false}
      open={(name) => SyncClient.open({ dbName: name, transport: server })}
    >
      <InboxProvider voiceTransport={() => server}>
        <Probe />
      </InboxProvider>
    </SyncProvider>
  );
}

describe('голосовые записи во «Входящих»', () => {
  it('без сети запись ждёт на устройстве и уходит, когда сеть вернулась, с тем же ID', async () => {
    const server = new Server();
    server.offline = true;
    render(view(server));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 30));
    });
    fireEvent.click(screen.getByRole('button', { name: 'сказать' }));
    const row = await screen.findByTestId('row');
    await waitFor(() =>
      expect(row).toHaveTextContent('Голосовая запись · голосом · отправится, когда появится сеть'),
    );
    expect(server.voiceCalls).toHaveLength(1);

    server.offline = false;
    await act(async () => {
      window.dispatchEvent(new Event('online'));
    });
    await waitFor(() => expect(screen.getByTestId('row')).toHaveTextContent('Купить хлеб'));
    expect(screen.getAllByTestId('row')).toHaveLength(1);
    const ids = new Set(server.voiceCalls.map((c) => c.id));
    expect(ids.size).toBe(1);
    expect(server.voiceCalls[0]).toMatchObject({ source: 'web', mime: 'audio/webm' });
    expect(screen.getByTestId('row')).toHaveTextContent(
      `с текстом · /api/v1/inbox/${server.voiceCalls[0]!.id}/audio`,
    );
  });

  it('без текста: плеер, причина простыми словами и «В архив»', async () => {
    const server = new Server();
    server.heard = null;
    render(view(server));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 30));
    });
    fireEvent.click(screen.getByRole('button', { name: 'сказать' }));
    await waitFor(() =>
      expect(screen.getByTestId('row')).toHaveTextContent(
        'распознавание голоса не подключено — послушай запись',
      ),
    );
    const row = screen.getByTestId('row');
    expect(row).toHaveTextContent('Голосовая запись · голосом');
    expect(row).toHaveTextContent('В архив/Позже');
    expect(row).toHaveTextContent('без текста');
  });
});
