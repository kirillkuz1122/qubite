import { Buffer } from 'node:buffer';
import { describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { httpDocsTransport } from './docs';
import { restoreDocVersion } from './docs-versions';

const item = {
  id: 'version/1',
  created_at: '2026-11-03T20:00:00Z',
  kind: 'named',
  name: 'Черновик',
  title: 'Документ',
  preview: 'Текст',
  size: 3,
};
const wire = { ...item, ystate: 'APv/', text: 'Текст' };
const decoded = { ...wire, ystate: new Uint8Array([0, 251, 255]) };

describe('HTTP версий и корзины', () => {
  it('список с курсором, загрузка, создание, имя, 204 и корзина используют общий HTTP', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const trash = {
      id: 'page',
      title: 'Удалённый',
      preview: '',
      project_ids: [],
      revision: 2,
      updated_at: item.created_at,
      deleted_at: item.created_at,
    };
    const fetch: typeof globalThis.fetch = async (input, init = {}) => {
      const url = String(input);
      calls.push({ url, init });
      if (init.method === 'DELETE') return new Response(null, { status: 204 });
      if (url.includes('deleted=true')) return Response.json({ docs: [trash] });
      if (url.includes('limit=50')) return Response.json({ versions: [item] });
      return Response.json(wire, { status: init.method === 'POST' ? 201 : 200 });
    };
    const transport = httpDocsTransport({
      baseUrl: 'https://q.example',
      fetch,
      csrf: () => 'csrf',
    });
    expect(await transport.listVersions('doc/1')).toEqual([item]);
    const before = '2026-11-03T22:00:00+02:00';
    expect(await transport.listVersions('doc/1', before)).toEqual([item]);
    expect(calls[0]?.url).toBe('https://q.example/api/v1/docs/doc%2F1/versions?limit=50');
    expect(new URL(calls[1]!.url).searchParams.get('before')).toBe(before);
    expect(await transport.getVersion('doc/1', item.id)).toEqual(decoded);
    expect(calls[2]?.url).toBe('https://q.example/api/v1/docs/doc%2F1/versions/version%2F1');
    expect(await transport.createVersion('doc/1', 'Черновик')).toEqual(decoded);
    expect(await transport.renameVersion('doc/1', item.id, 'Вторая')).toEqual(decoded);
    await expect(transport.deleteVersion('doc/1', item.id)).resolves.toBeUndefined();
    expect(await transport.listTrash()).toEqual([trash]);
    expect(calls.map((call) => call.init.method)).toEqual([
      'GET',
      'GET',
      'GET',
      'POST',
      'PATCH',
      'DELETE',
      'GET',
    ]);
    for (const { init } of calls) {
      expect(init.credentials).toBe('include');
      expect(new Headers(init.headers).get('x-csrf-token')).toBe(
        init.method === 'GET' ? null : 'csrf',
      );
    }
    expect(JSON.parse(calls[3]!.init.body as string)).toEqual({ name: 'Черновик' });
    expect(JSON.parse(calls[4]!.init.body as string)).toEqual({ name: 'Вторая' });
    expect(calls[6]?.url).toBe('https://q.example/api/v1/docs?deleted=true');
  });

  it('Bearer и ошибки сохраняются у всех методов версий', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async (_input, init) => {
      expect(new Headers(init?.headers).get('authorization')).toBe('Bearer access');
      expect(new Headers(init?.headers).has('x-csrf-token')).toBe(false);
      expect(init?.credentials).toBe('omit');
      return Response.json({ error: 'not_named', message: 'Только именованные' }, { status: 409 });
    });
    const transport = httpDocsTransport({ fetch, token: () => 'access' });
    const operations = [
      () => transport.listVersions('page'),
      () => transport.getVersion('page', 'vid'),
      () => transport.createVersion('page', 'Имя'),
      () => transport.renameVersion('page', 'vid', 'Имя'),
      () => transport.deleteVersion('page', 'vid'),
      () => transport.listTrash(),
    ];
    for (const operation of operations) {
      await expect(operation()).rejects.toMatchObject({ status: 409, code: 'not_named' });
    }
  });

  it('restore дополняет /y, обычный запрос сохраняет прежний формат', async () => {
    const bodies: Record<string, unknown>[] = [];
    const transport = httpDocsTransport({
      csrf: () => '',
      fetch: async (_input, init) => {
        bodies.push(JSON.parse(init!.body as string) as Record<string, unknown>);
        return Response.json({ sv: 'AA==' });
      },
    });
    const update = new Uint8Array([0, 0]);
    const snapshot = Y.encodeSnapshot(Y.emptySnapshot);
    await transport.push('page', update, 'Текст', undefined, snapshot, ['target'], {
      reason: 'restore',
      restore_of: item.id,
    });
    expect(bodies[0]).toEqual({
      update: 'AAA=',
      text: 'Текст',
      snapshot: Buffer.from(snapshot).toString('base64'),
      links: ['target'],
      reason: 'restore',
      restore_of: item.id,
    });
    await transport.push('page', update, 'Обычная правка');
    expect(bodies[1]).toEqual({ update: 'AAA=', text: 'Обычная правка' });
  });

  it.each([400, 403, 404])('ошибка %s не превращается в пустую историю', async (status) => {
    const transport = httpDocsTransport({
      fetch: async () => Response.json({ error: 'unavailable' }, { status }),
    });
    await expect(transport.listVersions('page')).rejects.toMatchObject({
      status,
      code: 'unavailable',
    });
    await expect(transport.getVersion('page', 'version')).rejects.toMatchObject({
      status,
      code: 'unavailable',
    });
  });
});

describe('копирование снимка Yjs', () => {
  it('одна транзакция сохраняет атрибуты, формат текста, вложенные узлы и чипы', () => {
    const source = new Y.Doc();
    const current = new Y.Doc();
    try {
      const root = source.get('root', Y.XmlText);
      root.setAttribute('__type', 'root');
      const block = new Y.XmlText();
      root.insertEmbed(0, block);
      block.setAttribute('__type', 'qubite-block');
      block.setAttribute('__kind', 'todo');
      block.setAttribute('__checked', true);
      block.setAttribute('__indent', 3);
      block.setAttribute('checked', true);
      block.setAttribute('indent', 3);
      const marker = new Y.Map<unknown>();
      marker.set('__type', 'text');
      marker.set('__format', 1);
      block.insertEmbed(0, marker);
      block.insert(1, 'Жирный', { bold: true });
      const mention = new Y.XmlElement('decorator');
      block.insertEmbed(block.length, mention);
      mention.setAttribute('__type', 'qubite-mention');
      mention.setAttribute('__target', 'target');
      mention.setAttribute('__kind', 'planner.task');
      const nested = new Y.XmlText();
      mention.insert(0, [nested]);
      nested.setAttribute('__type', 'nested');
      nested.insert(0, 'вложенный');
      const state = Y.encodeStateAsUpdate(source);
      const currentRoot = current.get('root', Y.XmlText);
      currentRoot.setAttribute('obsolete', true);
      currentRoot.insert(0, 'Более новый текст');
      const transactions = vi.fn();
      const updates = vi.fn();
      current.on('afterTransaction', transactions);
      current.on('update', updates);
      const origin = {};
      restoreDocVersion(current, { ystate: state }, origin);
      expect(transactions).toHaveBeenCalledTimes(1);
      expect(updates).toHaveBeenCalledTimes(1);
      expect(updates.mock.calls[0]?.[1]).toBe(origin);
      expect(currentRoot.toString()).toBe(root.toString());
      expect(currentRoot.getAttributes()).toEqual(root.getAttributes());
      const copied: unknown = currentRoot.toDelta()[0]?.insert;
      expect(copied).toBeInstanceOf(Y.XmlText);
      if (!(copied instanceof Y.XmlText)) throw new Error('Нет блока');
      expect(copied).not.toBe(block);
      expect(copied.getAttributes()).toEqual(block.getAttributes());
      const copiedMarker: unknown = copied.toDelta()[0]?.insert;
      expect(copiedMarker).toBeInstanceOf(Y.Map);
      expect(copiedMarker instanceof Y.Map && copiedMarker.toJSON()).toEqual(marker.toJSON());
      expect(copied.toDelta()[1]).toMatchObject({ insert: 'Жирный', attributes: { bold: true } });
      const copiedMention: unknown = copied.toDelta()[2]?.insert;
      expect(copiedMention instanceof Y.XmlElement && copiedMention.getAttributes()).toEqual(
        mention.getAttributes(),
      );
      expect(Y.encodeStateAsUpdate(source)).toEqual(state);
    } finally {
      source.destroy();
      current.destroy();
    }
  });

  it('некорректное состояние не меняет текущий документ', () => {
    const doc = new Y.Doc();
    try {
      doc.get('root', Y.XmlText).insert(0, 'Не потерять');
      const before = Y.encodeStateAsUpdate(doc);
      expect(() => restoreDocVersion(doc, { ystate: new Uint8Array([255]) }, null)).toThrow();
      expect(Y.encodeStateAsUpdate(doc)).toEqual(before);
    } finally {
      doc.destroy();
    }
  });
});
