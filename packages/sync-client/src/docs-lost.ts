import * as Y from 'yjs';
import type { DocLinkKind } from './docs';

export type LostInline =
  { type: 'text'; text: string } | { type: 'mention'; target: string; kind: DocLinkKind };

export type LostBlock = {
  text: string;
  /** Порядок текста и чипов; у старых записей и чистого текста поля нет. Без названий. */
  content?: LostInline[];
  kind: string;
  /** Текст предыдущего живого блока; null — вставить в начало. */
  after: string | null;
};

type BeforeBlock = { deleted: boolean; kind: string; pending: LostInline[] };
type GcGuard = {
  users: number;
  previous: Y.Doc['gcFilter'];
  filter: Y.Doc['gcFilter'];
};

/** Тип узла блока в Yjs — getType() у BlockNode экрана. */
export const DOC_BLOCK_TYPE = 'qubite-block';

const gcGuards = new WeakMap<Y.Doc, GcGuard>();

/** Атрибут удалённого типа уже не виден через getAttribute, но его Item ещё нужен. */
function attribute(type: Y.XmlText | Y.XmlElement, name: string): unknown {
  return type._map.get(name)?.content.getContent()[0];
}

function blockType(item: Y.Item): Y.XmlText | null {
  const content = item.content;
  if (!(content instanceof Y.ContentType) || !(content.type instanceof Y.XmlText)) return null;
  return attribute(content.type, '__type') === DOC_BLOCK_TYPE ? content.type : null;
}

function inDeletedRoot(item: Y.Item, root: Y.XmlText): boolean {
  let parent = item.parent;
  // Чип, стёртый в живом блоке, должен стать ContentDeleted, как стёртый текст:
  // иначе получатель примет сохранённый ContentType за вставку в удалённый блок.
  // Чипы внутри удалённого родителя по-прежнему удерживает обход родителей ниже.
  let deletedType =
    item.deleted &&
    item.content instanceof Y.ContentType &&
    !(
      item.content.type instanceof Y.XmlElement &&
      attribute(item.content.type, '__type') === 'qubite-mention'
    );
  while (parent instanceof Y.AbstractType) {
    if (parent === root) return deletedType;
    deletedType ||= parent._item?.deleted === true;
    parent = parent._item?.parent ?? null;
  }
  return false;
}

/** Сохранить и родителя, и текстовые якоря: иначе поздняя вставка станет GC без текста. */
function retainRoot(doc: Y.Doc, root: Y.XmlText): () => void {
  let guard = gcGuards.get(doc);
  if (!guard) {
    const previous = doc.gcFilter;
    const filter: Y.Doc['gcFilter'] = (item) => !inDeletedRoot(item, root) && previous(item);
    guard = { users: 0, previous, filter };
    gcGuards.set(doc, guard);
    doc.gcFilter = filter;
  }
  const active = guard;
  active.users++;
  return () => {
    active.users--;
    if (active.users === 0) {
      if (doc.gcFilter === active.filter) doc.gcFilter = active.previous;
      gcGuards.delete(doc);
    }
  };
}

function isLinkKind(value: unknown): value is DocLinkKind {
  return (
    value === 'docs.page' ||
    value === 'planner.task' ||
    value === 'planner.project' ||
    value === 'calendar.event'
  );
}

/** Символы и атомарные чипы, без текстовых маркеров Lexical и форматирования. */
function contentIn(
  type: Y.XmlText,
  since: (item: Y.Item) => number,
  deleted = false,
): LostInline[] {
  const content: LostInline[] = [];
  const append = (part: LostInline) => {
    const last = content.at(-1);
    if (part.type === 'text' && last?.type === 'text') last.text += part.text;
    else content.push(part);
  };
  for (let item = type._start; item; item = item.right) {
    if (!deleted && item.deleted) continue;
    if (item.content instanceof Y.ContentString) {
      const text = stringSince(item, since(item));
      if (text) append({ type: 'text', text });
    } else if (item.content instanceof Y.ContentType) {
      const child = item.content.type;
      if (child instanceof Y.XmlText) {
        contentIn(child, since, deleted).forEach(append);
      } else if (
        child instanceof Y.XmlElement &&
        attribute(child, '__type') === 'qubite-mention' &&
        item.id.clock >= since(item)
      ) {
        const target = attribute(child, '__target');
        const kind = attribute(child, '__kind');
        if (typeof target === 'string' && target.length > 0 && isLinkKind(kind)) {
          append({ type: 'mention', target, kind });
        }
      }
    }
  }
  return content;
}

function stringSince(item: Y.Item, clock: number): string {
  if (!(item.content instanceof Y.ContentString)) return '';
  return item.content.str.slice(Math.max(0, clock - item.id.clock));
}

/**
 * Найти дописки, потерянные при удалении блока с другого устройства (D-399).
 * Установить после начальной загрузки Y.Doc, до редактирования и первого обмена.
 * origin должен совпадать с origin транзакций обмена по идентичности.
 * Нужны Item/ContentString/ContentType из закреплённого Yjs 13.6.33: observeDeep
 * не видит вставки в удалённого родителя, а после GC их восстановить нельзя.
 */
export function watchLostEdits(
  doc: Y.Doc,
  origin: unknown,
  cb: (lost: LostBlock[]) => void,
  /**
   * Что из своих правок уже подтвердил сервер (вектор состояния). Без него
   * подтверждённым считается всё, что было на момент прошлой транзакции обмена.
   */
  confirmed?: () => Map<number, number>,
  /** all: неотправленные Item всех клиентов, включая прошлые открытия и вкладки. */
  pendingClients: 'current' | 'all' = 'current',
): () => void {
  const root = doc.get('root', Y.XmlText);
  const release = retainRoot(doc, root);
  const snapshotKey = Symbol('docs-lost-before');
  // Содержимое на момент подключения считаем исходной согласованной копией.
  let exchanged = Y.decodeStateVector(Y.encodeStateVector(doc));
  let stopped = false;

  const beforeTransaction = (transaction: Y.Transaction) => {
    if (transaction.origin !== origin) return;
    const before = new Map<Y.XmlText, BeforeBlock>();
    const known = confirmed?.() ?? exchanged;
    for (let item = root._start; item; item = item.right) {
      const block = blockType(item);
      if (!block) continue;
      const kind = attribute(block, '__kind') ?? attribute(block, 'kind');
      before.set(block, {
        deleted: item.deleted,
        kind: typeof kind === 'string' ? kind : 'text',
        // До удаления видим только живое содержимое; намеренно стёртое не возвращаем.
        pending: item.deleted
          ? []
          : contentIn(block, (entry) =>
              pendingClients === 'all' || entry.id.client === doc.clientID
                ? (known.get(entry.id.client) ?? 0)
                : Infinity,
            ),
      });
    }
    transaction.meta.set(snapshotKey, before);
  };

  const afterTransaction = (transaction: Y.Transaction) => {
    if (transaction.origin !== origin) return;
    const before = transaction.meta.get(snapshotKey) as Map<Y.XmlText, BeforeBlock> | undefined;
    transaction.meta.delete(snapshotKey);
    const lost: LostBlock[] = [];
    const known = confirmed?.() ?? exchanged;
    let after: string | null = null;
    for (let item = root._start; item; item = item.right) {
      const block = blockType(item);
      if (!block) continue;
      if (!item.deleted) {
        // Якорь совпадает с getTextContent() Lexical: чип даёт ровно «@».
        after = contentIn(block, () => 0)
          .map((part) => (part.type === 'text' ? part.text : '@'))
          .join('');
        continue;
      }
      const previous = before?.get(block);
      if (!previous) continue;
      const content = previous.deleted
        ? contentIn(
            block,
            (entry) =>
              Math.max(
                transaction.beforeState.get(entry.id.client) ?? 0,
                pendingClients === 'all' ? (known.get(entry.id.client) ?? 0) : 0,
              ),
            true,
          )
        : previous.pending;
      if (content.length > 0) {
        const text = content.map((part) => (part.type === 'text' ? part.text : '')).join('');
        lost.push({
          text,
          kind: previous.kind,
          after,
          ...(content.some((part) => part.type === 'mention') ? { content } : {}),
        });
      }
    }
    // Даже пустой обмен подтверждает текущий вектор. Обновить до cb: он может
    // создать локальную транзакцию Lexical для возврата найденного текста.
    exchanged = new Map(transaction.afterState);
    if (lost.length > 0) cb(lost);
  };

  const stop = () => {
    if (stopped) return;
    stopped = true;
    doc.off('beforeTransaction', beforeTransaction);
    doc.off('afterTransaction', afterTransaction);
    doc.off('destroy', stop);
    release();
  };

  doc.on('beforeTransaction', beforeTransaction);
  doc.on('afterTransaction', afterTransaction);
  doc.on('destroy', stop);
  return stop;
}
