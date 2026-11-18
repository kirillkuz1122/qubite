import * as Y from 'yjs';
import type { LostBlock } from './docs-lost';

/** Вид потерянной правки узла mind map (DOC-006). */
export const MINDMAP_LOST_KIND = 'mindmap';

/**
 * Неподтверждённые подписи узлов mind map, которые удалили с другого устройства (D-399 для карты).
 * Узлы карты — Y.Map('mindmap'): id → Y.Map {text: Y.Text, parent, …} (D-1001). Удаление
 * записи узла при обмене скрывает и его Y.Text вместе с допиской, которую сервер ещё не видел.
 * Поэтому до транзакции обмена запоминаем подписи узлов с такими вставками, после — отдаём
 * те, чьих узлов больше нет. Подпись берётся целиком: узел возвращают, а не кусок текста.
 * Строки сняты до транзакции, так что защита от GC здесь не нужна.
 */
export function watchLostMindmap(
  doc: Y.Doc,
  origin: unknown,
  cb: (lost: LostBlock[]) => void,
  /** Что из правок уже подтвердил сервер (вектор состояния). */
  confirmed: () => Map<number, number>,
): () => void {
  const key = Symbol('mindmap-lost-before');
  type Pending = { id: string; text: string; ancestors: string[] };

  // Обычный документ не получает лишний корневой тип: смотрим, только если карта уже есть.
  const nodes = () => (doc.share.has('mindmap') ? doc.getMap<unknown>('mindmap') : null);

  const before = (transaction: Y.Transaction) => {
    if (transaction.origin !== origin) return;
    const map = nodes();
    if (!map?.size) return;
    const known = confirmed();
    const pending: Pending[] = [];
    map.forEach((value, id) => {
      if (!(value instanceof Y.Map)) return;
      const text = value.get('text');
      if (!(text instanceof Y.Text)) return;
      for (let item = text._start; item; item = item.right) {
        // Yjs склеивает подряд набранное в один Item: неподтверждённым может быть только хвост,
        // поэтому смотрим на конец диапазона, а не на начало.
        if (item.deleted || item.id.clock + item.length <= (known.get(item.id.client) ?? 0))
          continue;
        // Предки снимаются сейчас: после обмена записей удалённых предков уже не прочесть.
        const ancestors: string[] = [];
        let up = value.get('parent');
        while (typeof up === 'string' && !ancestors.includes(up)) {
          ancestors.push(up);
          const next = map.get(up);
          up = next instanceof Y.Map ? next.get('parent') : null;
        }
        pending.push({ id, text: text.toString(), ancestors });
        return;
      }
    });
    if (pending.length) transaction.meta.set(key, pending);
  };

  const after = (transaction: Y.Transaction) => {
    if (transaction.origin !== origin) return;
    const pending = transaction.meta.get(key) as Pending[] | undefined;
    transaction.meta.delete(key);
    const map = nodes();
    if (!pending || !map) return;
    const lost: LostBlock[] = [];
    for (const item of pending) {
      const text = item.text.trim();
      if (map.has(item.id) || !text) continue;
      // Родитель — ближайший уцелевший предок: туда узел и вернётся.
      const parent = item.ancestors.find((id) => map.has(id)) ?? null;
      const above = parent ? map.get(parent) : undefined;
      const label = above instanceof Y.Map ? above.get('text') : undefined;
      lost.push({
        text,
        kind: MINDMAP_LOST_KIND,
        after: label instanceof Y.Text ? label.toString() : null,
        ...(parent ? { parent } : {}),
      });
    }
    if (lost.length) cb(lost);
  };

  const stop = () => {
    doc.off('beforeTransaction', before);
    doc.off('afterTransaction', after);
    doc.off('destroy', stop);
  };
  doc.on('beforeTransaction', before);
  doc.on('afterTransaction', after);
  doc.on('destroy', stop);
  return stop;
}
