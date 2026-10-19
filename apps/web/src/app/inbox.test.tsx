import 'fake-indexeddb/auto';
import { act, render, screen, waitFor } from '@testing-library/react';
import {
  SyncClient,
  type ObjectSnapshot,
  type OpResult,
  type PushRequest,
  type PushResponse,
  type Transport,
} from '@qubite/sync-client';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { InboxProvider } from './inbox';
import { useInbox } from './inbox-context';
import { toView, when } from './inbox-view';

/** Сервер Входящих в памяти, с теми же правилами, что настоящий. */
class FakeServer implements Transport {
  objects = new Map<string, ObjectSnapshot>();
  log: string[] = [];
  offline = false;

  async push(request: PushRequest): Promise<PushResponse> {
    if (this.offline) throw new Error('нет сети');
    const results = request.ops.map((op): OpResult => {
      const current = this.objects.get(op.object_id);
      if (op.kind === 'create') {
        this.objects.set(op.object_id, {
          id: op.object_id,
          object_type: op.object_type,
          title: op.title,
          revision: 1,
          deleted: false,
          updated_at_ms: Date.now(),
          fields: { ...op.fields, status: 'new' },
        });
      } else if (current && op.kind === 'patch') {
        this.objects.set(op.object_id, {
          ...current,
          revision: current.revision + 1,
          fields: { ...current.fields, ...op.fields },
        });
      }
      this.log.push(op.object_id);
      return { status: 'applied', op_id: op.op_id, revision: 1 };
    });
    return { results };
  }

  async pull(cursor: number) {
    if (this.offline) throw new Error('нет сети');
    const ids = [...new Set(this.log.slice(cursor))];
    return {
      changes: ids.map((id) => this.objects.get(id)!),
      cursor: this.log.length,
      has_more: false,
    };
  }
}

let n = 0;
function Probe() {
  const inbox = useInbox();
  const [text] = useState(() => `мысль ${++n}`);
  return (
    <div>
      <button type="button" onClick={() => void inbox.capture(text)}>
        записать
      </button>
      <button type="button" onClick={() => void inbox.done(inbox.items[0]!.id)}>
        разобрать
      </button>
      <span data-testid="status">{inbox.sync.status}</span>
      <ul>
        {inbox.items.map((x) => (
          <li key={x.id}>
            {x.text} · {x.src} · {x.time}
          </li>
        ))}
      </ul>
    </div>
  );
}

describe('«Входящие» на настоящих данных', () => {
  it('мысль без сети видна сразу и уходит на сервер, когда сеть появилась', async () => {
    const server = new FakeServer();
    server.offline = true;
    const open = () => SyncClient.open({ dbName: `web-inbox-${Date.now()}`, transport: server });
    render(
      <InboxProvider open={open} live={false}>
        <Probe />
      </InboxProvider>,
    );
    await act(async () => screen.getByText('записать').click());
    expect(await screen.findByText(/мысль \d+ · написал · ждёт сети · сейчас/)).toBeTruthy();
    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('error'));
    expect(server.objects.size).toBe(0);

    server.offline = false;
    await act(async () => screen.getByText('разобрать').click());
    await waitFor(() => expect(server.objects.size).toBe(1));
    const [stored] = [...server.objects.values()];
    expect(stored?.fields).toMatchObject({ source: 'web', status: 'archived' });
    await waitFor(() => expect(screen.queryByText(/мысль \d+/)).toBeNull());
  });

  it('строка экрана из объекта: источник, «посмотри сам», время', () => {
    const now = Date.UTC(2026, 9, 19, 9, 0);
    const base = {
      id: 'x',
      object_type: 'inbox.item',
      title: 'Подарок маме',
      revision: 1,
      deleted: false,
      updated_at_ms: now,
      pending: false,
    };
    const tg = toView(
      {
        ...base,
        fields: {
          body: 'Подарок маме\nдо 3 ноября',
          source: 'telegram',
          captured_at_ms: now - 30_000,
        },
      },
      now,
    );
    expect(tg).toMatchObject({
      text: 'Подарок маме',
      src: 'из Telegram',
      from: 'tg',
      time: 'сейчас',
    });
    const unsure = toView(
      { ...base, fields: { kind: 'voice', needs_review: true, review_reason: 'два проекта' } },
      now,
    );
    expect(unsure.from).toBe('voice');
    expect(unsure.hint).toBe('посмотри сам: два проекта');
    expect(when(now - 864e5, now)).toBe('вчера');
  });

  it('без сети подсказка — тот же разбор, что сделает сервер (CMD-003)', () => {
    const now = new Date(2026, 9, 19, 13, 0).getTime();
    const item = (title: string, triage?: object) =>
      toView(
        {
          id: title,
          object_type: 'inbox.item',
          title,
          revision: 0,
          deleted: false,
          updated_at_ms: now,
          pending: true,
          fields: { body: title, captured_at_ms: now, triage: triage ?? { status: 'pending' } },
        },
        now,
      );
    expect(item('завтра в 18 повторить графы #алгебра').hint).toBe(
      'Дело: повторить графы · завтра, 18:00 · #алгебра',
    );
    expect(item('напомни про графы').hint).toBe('посмотри сам: Когда напомнить? Срок не нашёл');
    expect(item('просто мысль').hint).toBe('разберём, когда будет минутка');
    // сервер уже разобрал — показываем его ответ
    expect(
      item('завтра в 18 повторить графы', {
        status: 'suggested',
        details: { summary: 'Дело: с сервера' },
      }).hint,
    ).toBe('Дело: с сервера');
  });
});
