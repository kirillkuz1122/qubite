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
import { describe, expect, it } from 'vitest';
import { PlannerProvider } from './planner';
import { usePlanner } from './planner-context';
import { SyncProvider } from './sync';

/** Сервер Planner в памяти: принимает операции как есть. */
class FakeServer implements Transport {
  objects = new Map<string, ObjectSnapshot>();
  log: string[] = [];
  offline = false;

  async push(request: PushRequest): Promise<PushResponse> {
    if (this.offline) throw new Error('нет сети');
    const results = request.ops.map((op): OpResult => {
      const current = this.objects.get(op.object_id);
      let revision = 1;
      if (op.kind === 'create') {
        this.objects.set(op.object_id, {
          id: op.object_id,
          object_type: op.object_type,
          title: op.title,
          revision,
          deleted: false,
          updated_at_ms: Date.now(),
          fields: { status: 'todo', ...op.fields },
        });
      } else if (current && op.kind === 'patch') {
        revision = current.revision + 1;
        this.objects.set(op.object_id, {
          ...current,
          revision,
          fields: { ...current.fields, ...op.fields },
        });
      }
      this.log.push(op.object_id);
      return { status: 'applied', op_id: op.op_id, revision };
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

function Probe() {
  const p = usePlanner();
  const today = p.week[p.today]!;
  return (
    <div>
      <button type="button" onClick={() => void p.add('#алгебра № 214–220 сегодня в 18:00')}>
        добавить
      </button>
      {today.tasks.map((t) => (
        <button key={t.id} type="button" onClick={() => void p.toggle(t.id, !t.done)}>
          {t.title} · {t.time} · {t.tag} · {t.done ? 'готово' : 'надо'}
        </button>
      ))}
      {p.projects.map((x) => (
        <span key={x.id}>
          проект {x.name} {x.done}/{x.total}
        </span>
      ))}
    </div>
  );
}

describe('«Сегодня» и Planner на настоящих данных', () => {
  it('дело из Command с #проектом и отметка без сети доходят до сервера', async () => {
    const server = new FakeServer();
    server.offline = true;
    const open = () => SyncClient.open({ dbName: `web-planner-${Date.now()}`, transport: server });
    render(
      <SyncProvider open={open} live={false}>
        <PlannerProvider>
          <Probe />
        </PlannerProvider>
      </SyncProvider>,
    );
    await act(async () => screen.getByText('добавить').click());
    const row = await screen.findByText('№ 214–220 · 18:00 · Алгебра · надо');
    expect(screen.getByText('проект Алгебра 0/1')).toBeTruthy();
    await act(async () => row.click());
    await screen.findByText('№ 214–220 · 18:00 · Алгебра · готово');
    expect(server.objects.size).toBe(0);

    server.offline = false;
    // «Есть сеть» — следующая отметка уносит и всю очередь.
    await act(async () => screen.getByText(/№ 214–220/).click());
    await screen.findByText('№ 214–220 · 18:00 · Алгебра · надо');
    await waitFor(() => expect(server.objects.size).toBe(2));
    await act(async () => screen.getByText(/№ 214–220/).click());
    await screen.findByText('№ 214–220 · 18:00 · Алгебра · готово');
    const stored = [...server.objects.values()];
    const project = stored.find((o) => o.object_type === 'planner.project')!;
    const task = stored.find((o) => o.object_type === 'planner.task')!;
    expect(project).toMatchObject({ title: 'Алгебра', fields: { tag: 'алгебра' } });
    await waitFor(() =>
      expect(server.objects.get(task.id)!.fields).toMatchObject({
        status: 'done',
        due_time: '18:00',
        project_id: project.id,
      }),
    );
    expect(await screen.findByText('проект Алгебра 1/1')).toBeTruthy();
  });
});
