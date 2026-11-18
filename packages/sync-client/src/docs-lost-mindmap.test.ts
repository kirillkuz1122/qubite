import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import type { LostBlock } from './docs-lost';
import { MINDMAP_LOST_KIND, watchLostMindmap } from './docs-lost-mindmap';

const EXCHANGE = Symbol('exchange');

function node(doc: Y.Doc, id: string, text: string, parent: string | null) {
  const map = new Y.Map<unknown>();
  const label = new Y.Text();
  label.insert(0, text);
  map.set('text', label);
  map.set('parent', parent);
  map.set('order', 0);
  doc.getMap('mindmap').set(id, map);
}

/** Карта root → branch → leaf на обоих устройствах, сервер видел всё. */
function pair() {
  const a = new Y.Doc();
  a.transact(() => {
    node(a, 'root', 'центр', null);
    node(a, 'branch', 'ветка', 'root');
    node(a, 'leaf', 'лист', 'branch');
  });
  const b = new Y.Doc();
  Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
  const confirmed = Y.decodeStateVector(Y.encodeStateVector(a));
  const found: LostBlock[] = [];
  watchLostMindmap(
    a,
    EXCHANGE,
    (lost) => found.push(...lost),
    () => confirmed,
  );
  const label = (doc: Y.Doc, id: string) =>
    (doc.getMap('mindmap').get(id) as Y.Map<unknown>).get('text') as Y.Text;
  const exchange = () =>
    Y.applyUpdate(a, Y.encodeStateAsUpdate(b, Y.encodeStateVector(a)), EXCHANGE);
  return { a, b, found, label, exchange };
}

describe('потерянные дописки mind map', () => {
  it('узел с неотправленной правкой удалили на другом устройстве — подпись возвращается', () => {
    const { a, b, found, label, exchange } = pair();
    label(a, 'leaf').insert(4, ' — дописка');
    b.getMap('mindmap').delete('leaf');
    exchange();
    expect(found).toEqual([
      { text: 'лист — дописка', kind: MINDMAP_LOST_KIND, after: 'ветка', parent: 'branch' },
    ]);
  });

  it('удалили предка — узел вернётся под ближайшего уцелевшего', () => {
    const { a, b, found, label, exchange } = pair();
    label(a, 'leaf').insert(0, 'новый ');
    b.transact(() => {
      b.getMap('mindmap').delete('leaf');
      b.getMap('mindmap').delete('branch');
    });
    exchange();
    expect(found).toEqual([
      { text: 'новый лист', kind: MINDMAP_LOST_KIND, after: 'центр', parent: 'root' },
    ]);
  });

  it('без своих неподтверждённых правок удаление — просто удаление', () => {
    const { b, found, exchange } = pair();
    b.getMap('mindmap').delete('leaf');
    exchange();
    expect(found).toEqual([]);
  });

  it('правка уцелела — ничего не потеряно; чужие транзакции не смотрим', () => {
    const { a, b, found, label, exchange } = pair();
    label(a, 'leaf').insert(4, '!');
    label(b, 'branch').insert(0, '+');
    exchange();
    a.getMap('mindmap').delete('leaf');
    expect(found).toEqual([]);
  });

  it('обычный документ без карты не получает корневой тип mindmap', () => {
    const doc = new Y.Doc();
    watchLostMindmap(
      doc,
      EXCHANGE,
      () => {},
      () => new Map(),
    );
    doc.transact(() => doc.get('root', Y.XmlText).insert(0, 'текст'), EXCHANGE);
    expect(doc.share.has('mindmap')).toBe(false);
  });
});
