/** Потерянные дописки в удалённые блоки Lexical (@lexical/yjs 0.52). */
import * as Y from 'yjs';

export interface LostBlock {
  text: string;
  kind: string;
  /** Текст ближайшего предыдущего живого блока; null — вставить в начало. */
  after: string | null;
}

interface BlockState {
  kind: string;
  deleted: boolean;
}

interface Retention {
  users: number;
  previous: Y.Doc['gcFilter'];
  filter: Y.Doc['gcFilter'];
}

const retention = new WeakMap<Y.Doc, Retention>();

/**
 * Если собрать ContentType удалённого блока, поздняя вставка превратится в GC
 * ещё при интеграции: у неё уже нельзя будет узнать ни текст, ни родителя.
 * Сохраняем только контейнеры блоков, а не весь текст и не весь документ.
 * Общий фильтр позволяет остановить несколько наблюдателей в любом порядке.
 */
function retainBlocks(doc: Y.Doc, root: Y.XmlText): () => void {
  let state = retention.get(doc);
  if (!state) {
    const previous = doc.gcFilter;
    const filter: Y.Doc['gcFilter'] = (item) =>
      !(
        item.parent === root &&
        item.content instanceof Y.ContentType &&
        item.content.type instanceof Y.XmlText
      ) && previous(item);
    state = { users: 0, previous, filter };
    retention.set(doc, state);
    doc.gcFilter = filter;
  }
  const retained = state;
  retained.users++;
  return () => {
    if (--retained.users !== 0) return;
    if (doc.gcFilter === retained.filter) doc.gcFilter = retained.previous;
    retention.delete(doc);
  };
}

/** Без XML-разметки и служебных Y.Map, которыми Lexical разделяет текстовые узлы. */
function liveText(block: Y.XmlText): string {
  let text = '';
  for (let item = block._start; item; item = item.right) {
    if (!item.deleted && item.content instanceof Y.ContentString) text += item.content.str;
  }
  return text;
}

/**
 * Подключать после загрузки локальной копии, до правок и серверного обмена.
 * origin — та же метка, с которой транспорт вызывает Y.applyUpdate.
 * Наблюдатель только сообщает дописки; вставлять их обратно должен экран.
 */
export function watchLostEdits(
  doc: Y.Doc,
  origin: unknown,
  cb: (lost: LostBlock[]) => void,
): () => void {
  const root = doc.get('root', Y.XmlText);
  const release = retainBlocks(doc, root);
  const blocks = new Map<Y.XmlText, BlockState>();
  const pending = new Map<Y.Transaction, LostBlock[]>();
  let exchanged = Y.decodeStateVector(Y.encodeStateVector(doc));
  let stopped = false;

  function scan(transaction?: Y.Transaction): LostBlock[] {
    const remote = transaction !== undefined && transaction.origin === origin;
    const lost: LostBlock[] = [];
    let after: string | null = null;
    for (let entry = root._start; entry; entry = entry.right) {
      if (!(entry.content instanceof Y.ContentType)) continue;
      const block = entry.content.type;
      if (!(block instanceof Y.XmlText)) continue;
      const previous = blocks.get(block);
      if (!entry.deleted) {
        if (block.getAttribute('__type') !== 'block') continue;
        const kind: unknown = block.getAttribute('kind');
        blocks.set(block, { kind: typeof kind === 'string' ? kind : 'p', deleted: false });
        // Текст якоря нужен только при обмене, где возможен сигнал.
        if (remote) after = liveText(block);
        continue;
      }
      if (!previous) continue;
      if (remote) {
        let text = '';
        for (let item = block._start; item; item = item.right) {
          if (!(item.content instanceof Y.ContentString) || item.parentSub !== null) continue;
          let clock: number;
          if (previous.deleted) {
            // Блок уже был удалён здесь: берём только пришедшие сейчас символы.
            clock = transaction.beforeState.get(item.id.client) ?? 0;
          } else {
            // Пришло удаление: спасаем свои ещё не обменянные вставки,
            // которые были живы перед этой транзакцией. Ранее стёртое не спасаем.
            if (item.id.client !== doc.clientID || !Y.isDeleted(transaction.deleteSet, item.id)) {
              continue;
            }
            clock = exchanged.get(item.id.client) ?? 0;
          }
          // Yjs сливает соседние вставки одного клиента в ContentString.
          // Граница вектора может оказаться посередине такого элемента (UTF-16).
          const offset = Math.max(0, clock - item.id.clock);
          text += item.content.str.slice(offset);
        }
        if (text) lost.push({ text, kind: previous.kind, after });
      }
      previous.deleted = true;
    }
    return lost;
  }

  // Исходная копия считается уже известной; последующие локальные вставки — нет.
  scan();
  const collect = (transaction: Y.Transaction) => {
    // observeDeep не видит правки удалённого родителя. Здесь данные ещё не GC,
    // а наблюдатели Lexical ещё не начали свои ответные транзакции.
    const lost = scan(transaction);
    if (transaction.origin === origin) exchanged = new Map(transaction.afterState);
    if (lost.length) pending.set(transaction, lost);
  };
  const notify = (transaction: Y.Transaction) => {
    const lost = pending.get(transaction);
    pending.delete(transaction);
    if (lost && !stopped) cb(lost);
  };
  const stop = () => {
    if (stopped) return;
    stopped = true;
    doc.off('beforeObserverCalls', collect);
    doc.off('afterTransaction', notify);
    doc.off('destroy', stop);
    blocks.clear();
    pending.clear();
    release();
  };
  doc.on('beforeObserverCalls', collect);
  doc.on('afterTransaction', notify);
  doc.on('destroy', stop);
  return stop;
}
