import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { SyncClient, type Transport } from './client';
import {
  createProject,
  createTask,
  findProject,
  isoDate,
  newSubtask,
  plannerData,
  parseProjectBoard,
  toProject,
  type ProjectBoard,
  patchTask,
  toTask,
  setTaskDone,
  setTaskStatus,
  splitProjectTag,
  tagFrom,
  toggleSubtask,
  updateProject,
} from './planner';
import type { ObjectSnapshot, OpResult, PushRequest, PushResponse } from './protocol';

/** Сервер Planner в памяти: поля как пришли, «сделано» создаёт следующее повторение. */
class PlannerServer implements Transport {
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
          fields: { status: 'todo', priority: 'normal', subtasks: [], ...op.fields },
        });
        this.log.push(op.object_id);
        return { status: 'applied', op_id: op.op_id, revision: 1 };
      }
      if (!current)
        return { status: 'rejected', op_id: op.op_id, reason: 'not_found', message: '' };
      if (current.revision !== op.base_revision)
        return { status: 'conflict', op_id: op.op_id, current };
      const next: ObjectSnapshot = { ...current, revision: current.revision + 1 };
      if (op.kind === 'patch') next.fields = { ...current.fields, ...op.fields };
      if (op.kind === 'set_title') next.title = op.title;
      this.objects.set(op.object_id, next);
      this.log.push(op.object_id);
      if (op.kind === 'patch' && op.fields.status === 'done' && current.fields?.recurrence) {
        const id = crypto.randomUUID();
        this.objects.set(id, { ...current, id, revision: 1, fields: { ...current.fields } });
        this.log.push(id);
      }
      return { status: 'applied', op_id: op.op_id, revision: next.revision };
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

let dbCounter = 0;
const open = (transport: Transport, dbName = `planner-${++dbCounter}`) =>
  SyncClient.open({ dbName, transport });

describe('Planner: проекты и дела', () => {
  it('место создаётся и меняется без сети; старая дорога сбрасывается только при смене адреса', async () => {
    const server = new PlannerServer();
    const dbName = `planner-route-${++dbCounter}`;
    let client = await open(server, dbName);
    try {
      const made = await createTask(client, 'Забрать книгу', { place_text: 'Библиотека' });
      expect(toTask(made)).toMatchObject({ place_text: 'Библиотека', travel_minutes: null });
      await client.sync();

      const stored = server.objects.get(made.id)!;
      server.objects.set(made.id, {
        ...stored,
        revision: stored.revision + 1,
        fields: { ...stored.fields, travel_minutes: 12, place_lat: 55, place_lon: 61 },
      });
      server.log.push(made.id);
      await client.sync();
      expect(toTask((await client.get(made.id))!).travel_minutes).toBe(12);

      server.offline = true;
      const same = await patchTask(client, made.id, { place_text: 'Библиотека' });
      expect(toTask(same).travel_minutes).toBe(12);
      const changed = await patchTask(client, made.id, { place_text: '  Музей  ' });
      expect(toTask(changed)).toMatchObject({ place_text: 'Музей', travel_minutes: null });
      expect(changed.fields).toMatchObject({ place_lat: null, place_lon: null });
      const cleared = await patchTask(client, made.id, { place_text: null });
      expect(toTask(cleared)).toMatchObject({ place_text: null, travel_minutes: null });
      client.close();
      client = await open(server, dbName);
      // Повторное открытие использует локальную копию без сети и координат отправителя.
      expect((await plannerData(client)).tasks[0]).toMatchObject({
        place_text: null,
        travel_minutes: null,
        pending: true,
      });
    } finally {
      client.close();
    }
  });

  it('теги и #проект из строки Command', () => {
    expect(tagFrom('Олимпиада по информатике')).toBe('олимпиада_по_информатике');
    expect(tagFrom('#Алгебра')).toBe('алгебра');
    expect(splitProjectTag('#алгебра решить № 214')).toEqual({
      title: 'решить № 214',
      tag: 'алгебра',
    });
    expect(splitProjectTag('позвонить бабушке')).toEqual({ title: 'позвонить бабушке', tag: null });
    const projects = [
      { tag: 'алгебра' },
      { tag: 'олимпиада_по_информатике' },
      { tag: 'олимп_кружок' },
    ];
    expect(findProject(projects, 'Алгебра')).toBe(projects[0]);
    expect(findProject(projects, 'алг')).toBe(projects[0]);
    expect(findProject(projects, 'олимп')).toBeUndefined(); // два подходят — не угадываем
    expect(findProject(projects, 'олимп_')).toBe(projects[2]);
    expect(findProject(projects, 'олимпиада')).toBe(projects[1]);
    expect(findProject(projects, 'физика')).toBeUndefined();
    expect(isoDate(new Date(2026, 9, 5, 23, 59))).toBe('2026-10-05');
  });

  it('проект и дело без сети уходят на сервер, галочки — тоже', async () => {
    const server = new PlannerServer();
    server.offline = true;
    const client = await open(server);
    const project = await createProject(client, 'Алгебра', { color: 'sky' });
    const task = await createTask(client, 'Алгебра: № 214–220', {
      due_date: '2026-10-20',
      due_time: '18:00',
      priority: 'urgent',
      project_id: project.id,
      subtasks: [newSubtask('№ 214–216'), newSubtask('№ 217–220')],
    });
    let data = await plannerData(client);
    expect(data.projects).toMatchObject([{ title: 'Алгебра', color: 'sky', tag: 'алгебра' }]);
    expect(data.tasks[0]).toMatchObject({
      status: 'todo',
      priority: 'urgent',
      project_id: project.id,
      pending: true,
    });
    const step = data.tasks[0]!.subtasks[0]!.id;
    await toggleSubtask(client, task.id, step, true);
    await setTaskDone(client, task.id, true);
    expect((await client.sync()).status).toBe('error');

    server.offline = false;
    expect((await client.sync()).status).toBe('synced');
    const saved = server.objects.get(task.id)!;
    expect(saved.fields).toMatchObject({
      status: 'done',
      due_time: '18:00',
      project_id: project.id,
    });
    expect((saved.fields!.subtasks as { done: boolean }[]).map((s) => s.done)).toEqual([
      true,
      false,
    ]);
    data = await plannerData(client);
    expect(data.tasks.every((t) => !t.pending)).toBe(true);
    client.close();
  });

  it('страница проекта: название, цвет и описание без сети (PROJ-001)', async () => {
    const server = new PlannerServer();
    const client = await open(server);
    const project = await createProject(client, 'Кубит');
    await client.sync();
    server.offline = true;
    await updateProject(client, project.id, {
      title: ' Qubite ',
      color: 'green',
      notes: 'Личная цифровая среда',
    });
    // ничего не поменялось — операции нет
    await updateProject(client, project.id, { title: 'Qubite', color: 'green' });
    let data = await plannerData(client);
    expect(data.projects[0]).toMatchObject({
      title: 'Qubite',
      color: 'green',
      notes: 'Личная цифровая среда',
      pending: true,
    });
    server.offline = false;
    expect((await client.sync()).status).toBe('synced');
    const saved = server.objects.get(project.id)!;
    expect(saved.title).toBe('Qubite');
    expect(saved.fields).toMatchObject({ color: 'green', notes: 'Личная цифровая среда' });
    expect(saved.revision).toBe(3);
    data = await plannerData(client);
    expect(data.projects[0]!.pending).toBe(false);
    client.close();
  });

  it('повторяющееся дело: следующее приходит с сервера', async () => {
    const server = new PlannerServer();
    const client = await open(server);
    const task = await createTask(client, 'Зарядка', {
      due_date: '2026-10-19',
      recurrence: { freq: 'daily' },
    });
    await client.sync();
    await setTaskDone(client, task.id, true);
    await client.sync();
    const { tasks } = await plannerData(client);
    expect(tasks.map((t) => [t.title, t.status]).sort()).toEqual([
      ['Зарядка', 'done'],
      ['Зарядка', 'todo'],
    ]);
    client.close();
  });

  it('перенос по доске: «в работе» и обратно, «готово» ставит время (D-289)', async () => {
    const client = await open(new PlannerServer());
    const task = await createTask(client, 'Эссе');
    await setTaskStatus(client, task.id, 'doing');
    let [t] = (await plannerData(client)).tasks;
    expect(t).toMatchObject({ status: 'doing', completed_at_ms: null });
    await setTaskStatus(client, task.id, 'done');
    [t] = (await plannerData(client)).tasks;
    expect(t!.status).toBe('done');
    expect(t!.completed_at_ms).not.toBeNull();
    await setTaskStatus(client, task.id, 'todo');
    [t] = (await plannerData(client)).tasks;
    expect(t).toMatchObject({ status: 'todo', completed_at_ms: null });
    client.close();
  });

  it('пустое название не записывается', async () => {
    const client = await open(new PlannerServer());
    await expect(createTask(client, '   ')).rejects.toThrow('название');
    await expect(createProject(client, '')).rejects.toThrow('название');
    client.close();
  });
});


describe('Настройка доски проекта', () => {
  const board: ProjectBoard = {
    columns: [
      { status: 'todo', title: 'Планы' },
      { status: 'done', title: 'Готово' },
    ],
    view: 'list',
  };

  it('разбирает настройку, старые записи и неверные значения', () => {
    expect(parseProjectBoard(board)).toEqual(board);
    expect(parseProjectBoard(undefined)).toBeNull();
    expect(parseProjectBoard(null)).toBeNull();
    expect(parseProjectBoard({ ...board, view: 'calendar' })).toBeNull();
    expect(parseProjectBoard({ ...board, columns: [board.columns[0]] })).toBeNull();
    expect(parseProjectBoard({ ...board, columns: Array(4).fill(board.columns[1]) })).toBeNull();
    expect(parseProjectBoard({ ...board, columns: Array(2).fill(board.columns[1]) })).toBeNull();
    expect(
      parseProjectBoard({
        ...board,
        columns: [board.columns[0], { status: 'doing', title: 'В работе' }],
      }),
    ).toBeNull();
    for (const title of ['  ', 'я'.repeat(25)]) {
      expect(
        parseProjectBoard({
          ...board,
          columns: [{ status: 'todo', title }, board.columns[1]],
        }),
      ).toBeNull();
    }
    expect(
      parseProjectBoard({
        ...board,
        columns: [{ status: 'todo', title: `  ${'я'.repeat(24)}  ` }, board.columns[1]],
      })?.columns[0]?.title,
    ).toBe('я'.repeat(24));
  });

  it('сохраняет доску без сети, передаёт её при синхронизации и сбрасывает через null', async () => {
    const server = new PlannerServer();
    const dbName = `planner-board-${++dbCounter}`;
    let client = await open(server, dbName);
    try {
      const old = await createProject(client, 'Без настройки');
      expect(toProject(old).board).toBeNull();
      const made = await createProject(client, 'С доской', { board });
      expect(toProject(made).board).toEqual(board);
      await client.sync();
      expect(server.objects.get(made.id)!.fields!.board).toEqual(board);
      server.offline = true;
      const changed: ProjectBoard = { ...board, view: 'board' };
      await updateProject(client, made.id, { board: changed });
      client.close();
      client = await open(server, dbName);
      expect(toProject((await client.get(made.id))!).board).toEqual(changed);
      server.offline = false;
      await client.sync();
      expect(server.objects.get(made.id)!.fields!.board).toEqual(changed);
      await updateProject(client, made.id, { notes: 'Описание' });
      expect(toProject((await client.get(made.id))!).board).toEqual(changed);
      await updateProject(client, made.id, { board: null });
      expect(toProject((await client.get(made.id))!).board).toBeNull();
      await client.sync();
      expect(server.objects.get(made.id)!.fields!.board).toBeNull();
    } finally {
      client.close();
    }
  });
});
