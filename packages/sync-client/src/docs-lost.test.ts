import { afterEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { watchLostEdits, type LostBlock } from './index';

const serverOrigin = Symbol('server');
const documents: Y.Doc[] = [];

afterEach(() => {
  for (const doc of documents.splice(0)) doc.destroy();
});

function document(): Y.Doc {
  const doc = new Y.Doc(); // Обычный GC включён: gc:false спрятал бы потерю родителя.
  documents.push(doc);
  return doc;
}

function root(doc: Y.Doc): Y.XmlText {
  return doc.get('root', Y.XmlText);
}

function addBlock(doc: Y.Doc, text: string, kind = 'text'): Y.XmlText {
  const block = new Y.XmlText();
  doc.transact(() => {
    root(doc).insertEmbed(root(doc).length, block);
    block.setAttribute('__type', 'block');
    block.setAttribute('kind', kind);
    block.setAttribute('checked', false);
    block.setAttribute('indent', 0);
    // Lexical 0.52 хранит маркер TextNode отдельно от самих символов.
    const marker = new Y.Map<unknown>();
    marker.set('__type', 'text');
    marker.set('__format', 0);
    block.insertEmbed(0, marker);
    block.insert(1, text);
  });
  return block;
}

function blockAt(doc: Y.Doc, index: number): Y.XmlText {
  const block: unknown = root(doc).toDelta()[index]?.insert;
  if (!(block instanceof Y.XmlText)) throw new Error('Нет блока Lexical');
  return block;
}

function receive(to: Y.Doc, from: Y.Doc, origin: unknown = serverOrigin): void {
  Y.applyUpdate(to, Y.encodeStateAsUpdate(from, Y.encodeStateVector(to)), origin);
}

/** Обе посылки снимаются до применения: настоящий обмен двух офлайн-копий. */
function exchange(a: Y.Doc, b: Y.Doc): void {
  const toA = Y.encodeStateAsUpdate(b, Y.encodeStateVector(a));
  const toB = Y.encodeStateAsUpdate(a, Y.encodeStateVector(b));
  Y.applyUpdate(a, toA, serverOrigin);
  Y.applyUpdate(b, toB, serverOrigin);
}

function pair(texts = ['Перед', 'Основа', 'После']): [Y.Doc, Y.Doc] {
  const a = document();
  const b = document();
  for (const text of texts) addBlock(a, text);
  receive(b, a);
  return [a, b];
}

function watch(doc: Y.Doc): { calls: LostBlock[][]; stop: () => void } {
  const calls: LostBlock[][] = [];
  const stop = watchLostEdits(doc, serverOrigin, (lost) => calls.push(lost));
  return { calls, stop };
}

describe('Документы: дописки в удалённые блоки Lexical', () => {
  it('на обоих устройствах находит ровно дописку, вид и предыдущий живой блок', () => {
    const [a, b] = pair();
    blockAt(a, 1).setAttribute('kind', 'quote');
    receive(b, a);
    const here = watch(a);
    const there = watch(b);
    blockAt(a, 1).insert(blockAt(a, 1).length, ' — дописано ✨');
    root(b).delete(1, 1);
    expect(here.calls).toEqual([]);
    expect(there.calls).toEqual([]);

    exchange(a, b);

    const expected = [[{ text: ' — дописано ✨', kind: 'quote', after: 'Перед' }]];
    expect(here.calls).toEqual(expected); // Здесь писали, пришло удаление.
    expect(there.calls).toEqual(expected); // Здесь удаляли, пришла вставка.
    expect(root(a).length).toBe(2);
    expect(root(b).length).toBe(2);
    exchange(a, b);
    Y.applyUpdate(a, Y.encodeStateAsUpdate(b), serverOrigin);
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a), serverOrigin);
    expect(here.calls).toEqual(expected);
    expect(there.calls).toEqual(expected);
  });

  it('работает и когда дописывает устройство, не создававшее исходный блок', () => {
    const [a, b] = pair();
    const here = watch(a);
    const there = watch(b);
    blockAt(b, 1).insert(blockAt(b, 1).length, ' с телефона');
    root(a).delete(1, 1);
    exchange(a, b);
    const expected = [[{ text: ' с телефона', kind: 'text', after: 'Перед' }]];
    expect(here.calls).toEqual(expected);
    expect(there.calls).toEqual(expected);
  });

  it('для первого блока возвращает after:null', () => {
    const [a, b] = pair(['Основа', 'После']);
    const here = watch(a);
    const there = watch(b);
    blockAt(a, 0).insert(1, 'В начале: ');
    root(b).delete(0, 1);
    exchange(a, b);
    const expected = [[{ text: 'В начале: ', kind: 'text', after: null }]];
    expect(here.calls).toEqual(expected);
    expect(there.calls).toEqual(expected);
  });

  it('пропускает удалённых соседей, учитывает новую редакцию живого соседа', () => {
    const [a, b] = pair(['Первый', 'Сосед', 'Основа']);
    const here = watch(a);
    const there = watch(b);
    blockAt(a, 2).insert(blockAt(a, 2).length, ' добавлено');
    b.transact(() => {
      blockAt(b, 0).insert(blockAt(b, 0).length, ' обновлён');
      root(b).delete(1, 2);
    });
    exchange(a, b);
    const expected = [[{ text: ' добавлено', kind: 'text', after: 'Первый обновлён' }]];
    expect(here.calls).toEqual(expected);
    expect(there.calls).toEqual(expected);
  });

  it('пустой живой сосед даёт пустую строку, а не null', () => {
    const [a, b] = pair(['', 'Основа']);
    const here = watch(a);
    const there = watch(b);
    blockAt(a, 1).insert(blockAt(a, 1).length, ' дописка');
    root(b).delete(1, 1);
    exchange(a, b);
    const expected = [[{ text: ' дописка', kind: 'text', after: '' }]];
    expect(here.calls).toEqual(expected);
    expect(there.calls).toEqual(expected);
  });

  it('группирует несколько фрагментов по блоку в порядке текста, а не часов вставки', () => {
    const [a, b] = pair();
    const here = watch(a);
    const there = watch(b);
    const block = blockAt(a, 1);
    block.insert(block.length, ' конец');
    block.insert(1, 'начало ');
    block.insert(block.length, ' 🧩');
    root(b).delete(1, 1);
    exchange(a, b);
    const expected = [[{ text: 'начало  конец 🧩', kind: 'text', after: 'Перед' }]];
    expect(here.calls).toEqual(expected);
    expect(there.calls).toEqual(expected);
  });

  it('срезает подтверждённую часть внутри объединённого Yjs Item', () => {
    const [a, b] = pair();
    const here = watch(a);
    const there = watch(b);
    const block = blockAt(a, 1);
    block.insert(block.length, ' известно');
    exchange(a, b);
    block.insert(block.length, ' неизвестно');
    root(b).delete(1, 1);
    exchange(a, b);
    const expected = [[{ text: ' неизвестно', kind: 'text', after: 'Перед' }]];
    expect(here.calls).toEqual(expected);
    expect(there.calls).toEqual(expected);
  });

  it('пустая транзакция обмена сдвигает границу подтверждения', () => {
    const [a, b] = pair();
    const here = watch(a);
    const there = watch(b);
    blockAt(a, 1).insert(blockAt(a, 1).length, ' известно');
    receive(b, a);
    // Ответ сервера не содержит новых Item, но обмен состоялся.
    receive(a, b);
    root(b).delete(1, 1);
    exchange(a, b);
    expect(here.calls).toEqual([]);
    expect(there.calls).toEqual([]);
  });

  it('не возвращает символы, которые автор сам стёр до слияния', () => {
    const [a, b] = pair();
    const here = watch(a);
    const there = watch(b);
    const block = blockAt(a, 1);
    block.insert(block.length, ' лишнее');
    block.delete(block.length - 'лишнее'.length, 'лишнее'.length);
    block.insert(block.length, 'нужное');
    root(b).delete(1, 1);
    exchange(a, b);
    const expected = [[{ text: ' нужное', kind: 'text', after: 'Перед' }]];
    expect(here.calls).toEqual(expected);
    expect(there.calls).toEqual(expected);
  });

  it('обычное удаление блока без дописок не даёт сигнала ни на одной копии', () => {
    const [a, b] = pair();
    const here = watch(a);
    const there = watch(b);
    root(b).delete(1, 1);
    exchange(a, b);
    exchange(a, b);
    expect(here.calls).toEqual([]);
    expect(there.calls).toEqual([]);
  });

  it('дописали и намеренно удалили блок на том же устройстве — пусто', () => {
    const [a, b] = pair();
    const here = watch(a);
    const there = watch(b);
    blockAt(a, 1).insert(blockAt(a, 1).length, ' дописка');
    root(a).delete(1, 1);
    exchange(a, b);
    expect(here.calls).toEqual([]);
    expect(there.calls).toEqual([]);
  });

  it('смена kind/checked/indent одновременно с допиской сохраняет блок без сигнала', () => {
    const [a, b] = pair();
    const here = watch(a);
    const there = watch(b);
    blockAt(a, 1).insert(blockAt(a, 1).length, ' дописка');
    b.transact(() => {
      const block = blockAt(b, 1);
      block.setAttribute('kind', 'check');
      block.setAttribute('checked', true);
      block.setAttribute('indent', 2);
    });
    exchange(a, b);
    expect(here.calls).toEqual([]);
    expect(there.calls).toEqual([]);
    expect(blockAt(a, 1).getAttribute('kind')).toBe('check');
    for (const doc of [a, b]) {
      const block = blockAt(doc, 1);
      expect(block.getAttribute('checked')).toBe(true);
      expect(block.getAttribute('indent')).toBe(2);
      expect(
        block
          .toDelta()
          .flatMap((delta) => (typeof delta.insert === 'string' ? [delta.insert] : []))
          .join(''),
      ).toBe('Основа дописка');
    }
  });

  it('параллельное редактирование разных блоков и удаление третьего — пусто', () => {
    const [a, b] = pair();
    const here = watch(a);
    const there = watch(b);
    blockAt(a, 0).insert(blockAt(a, 0).length, ' A');
    blockAt(b, 2).insert(blockAt(b, 2).length, ' Б');
    root(b).delete(1, 1);
    exchange(a, b);
    expect(here.calls).toEqual([]);
    expect(there.calls).toEqual([]);
  });

  it('атрибуты удалённого блока и маркеры Lexical не считаются дописанным текстом', () => {
    const [a, b] = pair();
    const here = watch(a);
    const there = watch(b);
    a.transact(() => {
      const block = blockAt(a, 1);
      block.setAttribute('kind', 'h1');
      const marker = new Y.Map<unknown>();
      marker.set('__type', 'text');
      marker.set('__format', 1);
      block.insertEmbed(block.length, marker);
    });
    root(b).delete(1, 1);
    exchange(a, b);
    expect(here.calls).toEqual([]);
    expect(there.calls).toEqual([]);
  });

  it('несколько потерянных блоков возвращаются одним списком в порядке документа', () => {
    const [a, b] = pair(['Перед', 'Первый', 'Второй']);
    const here = watch(a);
    const there = watch(b);
    blockAt(a, 2).insert(blockAt(a, 2).length, ' Б');
    blockAt(a, 1).insert(blockAt(a, 1).length, ' A');
    root(b).delete(1, 2);
    exchange(a, b);
    const expected = [
      [
        { text: ' A', kind: 'text', after: 'Перед' },
        { text: ' Б', kind: 'text', after: 'Перед' },
      ],
    ];
    expect(here.calls).toEqual(expected);
    expect(there.calls).toEqual(expected);
  });

  it('разные посылки в удалённый блок сообщают только новые символы', () => {
    const [a, b] = pair();
    const here = watch(a);
    const block = blockAt(b, 1);
    root(a).delete(1, 1);
    block.insert(block.length, ' первая');
    receive(a, b);
    receive(a, b);
    block.insert(block.length, ' вторая');
    receive(a, b);
    expect(here.calls).toEqual([
      [{ text: ' первая', kind: 'text', after: 'Перед' }],
      [{ text: ' вторая', kind: 'text', after: 'Перед' }],
    ]);
  });

  it('чужой origin не вызывает сигнал и не подтверждает локальные вставки', () => {
    const [a, b] = pair();
    const here = watch(a);
    blockAt(a, 1).insert(blockAt(a, 1).length, ' дописка');
    // Посторонняя транзакция не должна сдвинуть вектор последнего обмена.
    a.transact(() => a.getMap('other').set('value', 1), Symbol('other'));
    root(b).delete(1, 1);
    receive(a, b);
    expect(here.calls).toEqual([[{ text: ' дописка', kind: 'text', after: 'Перед' }]]);
  });

  it('не обрабатывает входящую вставку с другим origin', () => {
    const [a, b] = pair();
    const here = watch(a);
    root(a).delete(1, 1);
    blockAt(b, 1).insert(blockAt(b, 1).length, ' дописка');
    receive(a, b, Symbol('not-server'));
    expect(here.calls).toEqual([]);
  });

  it('локальная вставка из callback остаётся неподтверждённой до следующего обмена', () => {
    const [a, b] = pair();
    const calls: LostBlock[][] = [];
    watchLostEdits(a, serverOrigin, (lost) => {
      calls.push(lost);
      blockAt(a, 0).insert(blockAt(a, 0).length, lost[0]!.text);
    });
    blockAt(a, 1).insert(blockAt(a, 1).length, ' дописка');
    root(b).delete(1, 1);
    receive(a, b);
    root(b).delete(0, 1);
    receive(a, b);
    expect(calls).toEqual([
      [{ text: ' дописка', kind: 'text', after: 'Перед' }],
      [{ text: ' дописка', kind: 'text', after: null }],
    ]);
  });

  it('stop снимает обработчики, возвращает фильтр и допускает повторный вызов', () => {
    const [a, b] = pair();
    const previous = a.gcFilter;
    const here = watch(a);
    expect(a.gcFilter).not.toBe(previous);
    here.stop();
    here.stop();
    expect(a.gcFilter).toBe(previous);
    blockAt(a, 1).insert(blockAt(a, 1).length, ' дописка');
    root(b).delete(1, 1);
    receive(a, b);
    expect(here.calls).toEqual([]);
  });

  it('несколько наблюдателей удерживают root до остановки последнего', () => {
    const [a] = pair();
    const previous = a.gcFilter;
    const first = watch(a);
    const second = watch(a);
    first.stop();
    expect(a.gcFilter).not.toBe(previous);
    second.stop();
    expect(a.gcFilter).toBe(previous);
  });

  it('не заменяет установленный снаружи новый фильтр при остановке', () => {
    const [a] = pair();
    const here = watch(a);
    const replacement = () => false;
    a.gcFilter = replacement;
    here.stop();
    expect(a.gcFilter).toBe(replacement);
  });

  it('оставляет очистку остальных разделов документа прежнему фильтру', () => {
    const a = document();
    const filtered: Y.Item[] = [];
    a.gcFilter = (item) => {
      filtered.push(item);
      return true;
    };
    watch(a);
    const other = a.getText('other');
    other.insert(0, 'Не документ Lexical');
    other.delete(0, other.length);
    expect(filtered.length).toBeGreaterThan(0);
    expect(filtered.every((item) => item.parent === other)).toBe(true);
    addBlock(a, 'Удалить');
    root(a).delete(0, 1);
    expect(filtered.every((item) => item.parent === other)).toBe(true);
  });
});
