import { afterEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { watchLostEdits, type LostBlock } from './index';

const SERVER = Symbol('server');
const documents: Y.Doc[] = [];

afterEach(() => {
  for (const doc of documents) doc.destroy();
  documents.length = 0;
});

function newDoc(): Y.Doc {
  // gc включён по умолчанию: второй сценарий должен работать и после сборки мусора.
  const doc = new Y.Doc();
  documents.push(doc);
  return doc;
}

/** Формат @lexical/yjs: XmlText-блок, Y.Map с метаданными текста, затем строка. */
function appendBlock(root: Y.XmlText, text: string, kind: string): Y.XmlText {
  const block = new Y.XmlText();
  root.insertEmbed(root.length, block);
  block.setAttribute('__type', 'block');
  block.setAttribute('kind', kind);
  block.setAttribute('checked', false);
  block.setAttribute('indent', 0);
  const marker = new Y.Map<unknown>();
  marker.set('__type', 'text');
  marker.set('__format', 0);
  block.insertEmbed(0, marker);
  block.insert(1, text);
  return block;
}

function pair(texts = ['Перед', 'Исходный', 'После']) {
  const a = newDoc();
  const b = newDoc();
  const rootA = a.get('root', Y.XmlText);
  const blocksA: Y.XmlText[] = [];
  a.transact(() => {
    texts.forEach((text, index) => {
      blocksA.push(appendBlock(rootA, text, index === 1 ? 'quote' : 'p'));
    });
  });
  const rootB = b.get('root', Y.XmlText);
  Y.applyUpdate(b, Y.encodeStateAsUpdate(a), SERVER);
  const blocksB: Y.XmlText[] = [];
  for (const op of rootB.toDelta()) {
    if (op.insert instanceof Y.XmlText) blocksB.push(op.insert);
  }
  return { a, b, rootA, rootB, blocksA, blocksB };
}

/** Обе разницы готовятся до слияния: удаление ещё не поглотило дописку. */
function exchange(a: Y.Doc, b: Y.Doc): void {
  const toA = Y.encodeStateAsUpdate(b, Y.encodeStateVector(a));
  const toB = Y.encodeStateAsUpdate(a, Y.encodeStateVector(b));
  Y.applyUpdate(a, toA, SERVER);
  Y.applyUpdate(b, toB, SERVER);
}

function listen(doc: Y.Doc) {
  const callback = vi.fn<(lost: LostBlock[]) => void>();
  const stop = watchLostEdits(doc, SERVER, callback);
  return { callback, stop };
}

describe('Дописки в удалённый блок', () => {
  it('на обоих устройствах находит только дописку, вид блока и живого соседа', () => {
    const { a, b, rootB, blocksA } = pair();
    const here = listen(a);
    const there = listen(b);
    const block = blocksA[1]!;
    block.insert(block.length, ' + дописано');
    rootB.delete(1, 1);
    expect(here.callback).not.toHaveBeenCalled();
    expect(there.callback).not.toHaveBeenCalled();

    exchange(a, b);

    const expected = [{ text: ' + дописано', kind: 'quote', after: 'Перед' }];
    expect(here.callback.mock.calls).toEqual([[expected]]);
    expect(there.callback.mock.calls).toEqual([[expected]]);
    exchange(a, b);
    exchange(a, b);
    expect(here.callback).toHaveBeenCalledTimes(1);
    expect(there.callback).toHaveBeenCalledTimes(1);
  });

  it('находит пришедшую вставку после того, как местное удаление уже прошло GC', () => {
    const { a, b, rootB, blocksA } = pair();
    const { callback } = listen(b);
    rootB.delete(1, 1);
    // Это отдельные завершённые транзакции: GC был включён при удалении.
    a.transact(() => blocksA[1]!.insert(1, 'Новая мысль. '));
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a, Y.encodeStateVector(b)), SERVER);
    const expected = [{ text: 'Новая мысль. ', kind: 'quote', after: 'Перед' }];
    expect(callback.mock.calls).toEqual([[expected]]);
  });

  it('учитывает последний обмен даже без новых элементов и границу внутри строки', () => {
    const { a, b, rootB, blocksA } = pair();
    const here = listen(a);
    const there = listen(b);
    const block = blocksA[1]!;
    block.insert(block.length, ' — уже известно');
    exchange(a, b);
    // Пустой серверный ответ тоже завершает обмен.
    Y.applyUpdate(a, Y.encodeStateAsUpdate(b, Y.encodeStateVector(a)), SERVER);
    block.insert(block.length, ' — новое 📝');
    rootB.delete(1, 1);
    exchange(a, b);
    const expected = [{ text: ' — новое 📝', kind: 'quote', after: 'Перед' }];
    expect(here.callback.mock.calls).toEqual([[expected]]);
    expect(there.callback.mock.calls).toEqual([[expected]]);
  });

  it('не возвращает вставленное, а затем намеренно стёртое самим автором', () => {
    const { a, b, rootB, blocksA } = pair();
    const here = listen(a);
    const there = listen(b);
    const block = blocksA[1]!;
    const end = block.length;
    block.insert(end, 'лишнее');
    block.delete(end, 'лишнее'.length);
    block.insert(end, 'оставить');
    rootB.delete(1, 1);
    exchange(a, b);
    const expected = [{ text: 'оставить', kind: 'quote', after: 'Перед' }];
    expect(here.callback.mock.calls).toEqual([[expected]]);
    expect(there.callback.mock.calls).toEqual([[expected]]);
  });

  it('собирает вставки по порядку текста, пропуская метаданные и форматирование', () => {
    const { a, b, rootB, blocksA } = pair();
    const here = listen(a);
    const there = listen(b);
    const block = blocksA[1]!;
    // Сначала дописали конец, затем начало: порядок client clock здесь другой.
    block.insert(block.length, ' конец', { bold: true });
    block.insert(1, 'начало ', { italic: true });
    const marker = new Y.Map<unknown>();
    marker.set('__type', 'text');
    block.insertEmbed(block.length, marker);
    block.insert(block.length, ' ещё');
    rootB.delete(1, 1);
    exchange(a, b);
    const expected = [{ text: 'начало  конец ещё', kind: 'quote', after: 'Перед' }];
    expect(here.callback.mock.calls).toEqual([[expected]]);
    expect(there.callback.mock.calls).toEqual([[expected]]);
  });

  it('для первого блока сообщает after: null', () => {
    const { a, b, rootB, blocksA } = pair();
    const here = listen(a);
    const there = listen(b);
    blocksA[0]!.insert(1, 'новое');
    rootB.delete(0, 1);
    exchange(a, b);
    const expected = [{ text: 'новое', kind: 'p', after: null }];
    expect(here.callback.mock.calls).toEqual([[expected]]);
    expect(there.callback.mock.calls).toEqual([[expected]]);
  });

  it('пропускает удалённого соседа и берёт актуальный текст предыдущего живого', () => {
    const { a, b, rootB, blocksA, blocksB } = pair(['Первый', 'Сосед', 'Цель', 'После']);
    const here = listen(a);
    const there = listen(b);
    blocksA[2]!.insert(1, 'дописка');
    blocksB[0]!.insert(blocksB[0]!.length, ' изменён');
    rootB.delete(1, 2);
    exchange(a, b);
    const expected = [{ text: 'дописка', kind: 'p', after: 'Первый изменён' }];
    expect(here.callback.mock.calls).toEqual([[expected]]);
    expect(there.callback.mock.calls).toEqual([[expected]]);
  });

  it('пустой живой блок остаётся якорем с текстом пустой строки', () => {
    const { a, b, rootB, blocksA } = pair(['', 'Исходный']);
    const here = listen(a);
    const there = listen(b);
    blocksA[1]!.insert(1, 'новое');
    rootB.delete(1, 1);
    exchange(a, b);
    const expected = [{ text: 'новое', kind: 'quote', after: '' }];
    expect(here.callback.mock.calls).toEqual([[expected]]);
    expect(there.callback.mock.calls).toEqual([[expected]]);
  });

  it('несколько удалённых блоков сообщает одним вызовом в порядке документа', () => {
    const { a, b, rootB, blocksA } = pair();
    const here = listen(a);
    const there = listen(b);
    blocksA[2]!.insert(1, 'третий');
    blocksA[1]!.insert(1, 'второй');
    rootB.delete(1, 2);
    exchange(a, b);
    const expected = [
      { text: 'второй', kind: 'quote', after: 'Перед' },
      { text: 'третий', kind: 'p', after: 'Перед' },
    ];
    expect(here.callback.mock.calls).toEqual([[expected]]);
    expect(there.callback.mock.calls).toEqual([[expected]]);
  });

  it('поздний второй пакет даёт только новую порцию потерянного текста', () => {
    const { a, b, rootB, blocksA } = pair();
    const { callback } = listen(b);
    rootB.delete(1, 1);
    const block = blocksA[1]!;
    block.insert(block.length, ' раз');
    const first = Y.encodeStateAsUpdate(a, Y.encodeStateVector(b));
    Y.applyUpdate(b, first, SERVER);
    block.insert(block.length, ' два');
    const second = Y.encodeStateAsUpdate(a, Y.encodeStateVector(b));
    Y.applyUpdate(b, second, SERVER);
    Y.applyUpdate(b, first, SERVER);
    Y.applyUpdate(b, second, SERVER);
    expect(callback.mock.calls).toEqual([
      [[{ text: ' раз', kind: 'quote', after: 'Перед' }]],
      [[{ text: ' два', kind: 'quote', after: 'Перед' }]],
    ]);
  });
});

describe('Обычные правки без потерь', () => {
  it('удаление блока без дописок не вызывает сигнал', () => {
    const { a, b, rootB } = pair();
    const here = listen(a);
    const there = listen(b);
    rootB.delete(1, 1);
    exchange(a, b);
    expect(here.callback).not.toHaveBeenCalled();
    expect(there.callback).not.toHaveBeenCalled();
  });

  it('свои дописки, уже известные при обмене, не считаются потерянными', () => {
    const { a, b, rootB, blocksA } = pair();
    const here = listen(a);
    const there = listen(b);
    blocksA[1]!.insert(1, 'сохранено');
    exchange(a, b);
    rootB.delete(1, 1);
    exchange(a, b);
    expect(here.callback).not.toHaveBeenCalled();
    expect(there.callback).not.toHaveBeenCalled();
  });

  it('собственное удаление блока с собственной допиской не вызывает сигнал', () => {
    const { a, b, rootA, blocksA } = pair();
    const here = listen(a);
    const there = listen(b);
    blocksA[1]!.insert(1, 'сам стёр');
    rootA.delete(1, 1);
    exchange(a, b);
    expect(here.callback).not.toHaveBeenCalled();
    expect(there.callback).not.toHaveBeenCalled();
  });

  it('смена kind вместе с допиской на другом устройстве сохраняет текст без сигнала', () => {
    const { a, b, blocksA, blocksB } = pair();
    const here = listen(a);
    const there = listen(b);
    blocksA[1]!.insert(1, 'новое');
    blocksB[1]!.setAttribute('kind', 'h1');
    exchange(a, b);
    expect(here.callback).not.toHaveBeenCalled();
    expect(there.callback).not.toHaveBeenCalled();
  });

  it('атрибуты удалённого блока не принимаются за пришедший текст', () => {
    const { a, b, rootB, blocksA } = pair();
    const here = listen(a);
    const there = listen(b);
    rootB.delete(1, 1);
    a.transact(() => {
      blocksA[1]!.setAttribute('kind', 'todo');
      blocksA[1]!.setAttribute('checked', true);
      blocksA[1]!.setAttribute('indent', 2);
    });
    exchange(a, b);
    expect(here.callback).not.toHaveBeenCalled();
    expect(there.callback).not.toHaveBeenCalled();
  });

  it('параллельные дописки в разные живые блоки не вызывают сигнал', () => {
    const { a, b, blocksA, blocksB } = pair();
    const here = listen(a);
    const there = listen(b);
    blocksA[0]!.insert(1, 'на первом ');
    blocksB[2]!.insert(1, 'на третьем ');
    exchange(a, b);
    expect(here.callback).not.toHaveBeenCalled();
    expect(there.callback).not.toHaveBeenCalled();
  });

  it('правка с другим origin не сдвигает границу серверного обмена', () => {
    const { a, b, rootB, blocksA } = pair();
    const { callback } = listen(a);
    blocksA[1]!.insert(1, 'новое');
    a.transact(() => blocksA[0]!.setAttribute('checked', true), Symbol('editor'));
    rootB.delete(1, 1);
    exchange(a, b);
    const expected = [{ text: 'новое', kind: 'quote', after: 'Перед' }];
    expect(callback.mock.calls).toEqual([[expected]]);
  });
});

describe('Остановка наблюдения', () => {
  it('stop отсоединяет обработчики, восстанавливает GC-фильтр и допускает повтор', () => {
    const { a, b, rootB, blocksA } = pair();
    const original = a.gcFilter;
    const { callback, stop } = listen(a);
    stop();
    stop();
    expect(a.gcFilter).toBe(original);
    blocksA[1]!.insert(1, 'новое');
    rootB.delete(1, 1);
    exchange(a, b);
    expect(callback).not.toHaveBeenCalled();
  });

  it('остановка первого наблюдателя не ломает второй при поздней вставке', () => {
    const { a, b, rootB, blocksA } = pair();
    const original = b.gcFilter;
    const first = listen(b);
    const second = listen(b);
    first.stop();
    rootB.delete(1, 1);
    blocksA[1]!.insert(1, 'дописано');
    exchange(a, b);
    expect(first.callback).not.toHaveBeenCalled();
    const expected = [{ text: 'дописано', kind: 'quote', after: 'Перед' }];
    expect(second.callback.mock.calls).toEqual([[expected]]);
    second.stop();
    expect(b.gcFilter).toBe(original);
  });

  it('сохраняет существующий запрет GC для других типов и освобождается при destroy', () => {
    const doc = newDoc();
    const original = vi.fn(() => false);
    doc.gcFilter = original;
    listen(doc);
    const map = doc.getMap('other');
    map.set('key', 'value');
    map.delete('key');
    expect(original).toHaveBeenCalled();
    doc.destroy();
    expect(doc.gcFilter).toBe(original);
  });
});
