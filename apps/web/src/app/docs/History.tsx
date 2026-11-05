import {
  httpDocsTransport,
  type DocHandle,
  type DocStore,
  type DocsVersionsTransport,
  type DocVersion,
  type DocVersionItem,
} from '@qubite/sync-client';
import {
  Button,
  DotIcon,
  Field,
  Note,
  Presence,
  Sheet,
  Swap,
  Switch,
  useMedia,
  useSlide,
} from '@qubite/ui';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import * as Y from 'yjs';
import { SecHead } from '../parts';
import { plainPreview } from './preview';
import { groupVersions, useVersions } from './useVersions';
import { blocksFromDoc, diffBlocks, type BlockDiff, type VersionBlock } from './versions-diff';
import './history.css';

interface Props {
  id: string;
  open: boolean;
  handle: DocHandle | null;
  store: Pick<DocStore, 'createVersion' | 'restoreVersion'> | null;
  onClose: () => void;
  onRestored: () => void;
  children: ReactNode;
  transport?: DocsVersionsTransport;
}
interface Selection {
  item: DocVersionItem;
  version?: DocVersion;
  blocks?: VersionBlock[];
  error?: string;
}
type Action = { kind: 'rename' | 'delete'; item: DocVersionItem } | { kind: 'restore' };
const dateTime = (date: string) =>
  new Date(date).toLocaleString('ru', { dateStyle: 'long', timeStyle: 'short' });
const validName = (name: string) =>
  Array.from(name.trim()).length >= 1 && Array.from(name.trim()).length <= 80;

function actionError(error: unknown): string {
  const message = error instanceof Error ? error.message : '';
  if (message.includes('не загружен'))
    return 'Документ ещё не загружен на это устройство. Подключитесь к сети и откройте его.';
  if (message.includes('слишком большой'))
    return 'Документ слишком большой, чтобы восстановить версию целиком.';
  if (message.includes('Нужна связь'))
    return 'Нужна связь: дождитесь сохранения текущих правок и повторите.';
  return 'Не удалось выполнить действие. Проверьте связь и попробуйте ещё раз.';
}

/** Редактор остаётся подключённым к Yjs даже при просмотре старого снимка. */
export function History({
  id,
  open,
  handle,
  store,
  onClose,
  onRestored,
  children,
  transport: supplied,
}: Props) {
  const transport = useMemo(() => supplied ?? httpDocsTransport(), [supplied]);
  const wide = useMedia('(min-width: 840px)');
  const history = useVersions(id, open, transport);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [compare, setCompare] = useState(false);
  const [name, setName] = useState('');
  const [action, setAction] = useState<Action | null>(null);
  const [rename, setRename] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [current, setCurrent] = useState<{ doc: Y.Doc; blocks: VersionBlock[] } | null>(null);
  const selecting = useRef(0);
  const alive = useRef(false);
  const performing = useRef(false);
  const panel = useRef<HTMLElement>(null);
  const preview = useRef<HTMLElement>(null);
  const slide = useSlide(88);
  const viewing = open && selection !== null;

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      selecting.current++;
    };
  }, []);

  useEffect(() => {
    if (!open || !wide) return;
    const back = document.activeElement;
    panel.current?.focus({ preventScroll: true });
    return () => {
      if (back instanceof HTMLElement) back.focus({ preventScroll: true });
    };
  }, [open, wide]);

  useEffect(() => {
    if (!handle) return;
    const update = () => setCurrent({ doc: handle.doc, blocks: blocksFromDoc(handle.doc) });
    handle.doc.on('update', update);
    // Первое сравнение берёт дерево из handle; последующие — по событиям Yjs.
    return () => handle.doc.off('update', update);
  }, [handle]);

  useEffect(() => {
    if (!open) return;
    const row = panel.current?.querySelector<HTMLElement>('[aria-current="true"]');
    if (row) slide.to(row.offsetTop, row.offsetHeight);
    else slide.hide();
  }, [selection, wide, open, history.versions, slide.to, slide.hide]);

  useEffect(() => {
    if (!open || action) return;
    if (selection) preview.current?.focus({ preventScroll: true });
    else if (!wide) panel.current?.focus({ preventScroll: true });
  }, [open, wide, selection, action]);

  function close() {
    if (performing.current) return;
    selecting.current++;
    setSelection(null);
    setCompare(false);
    setAction(null);
    setError(null);
    setNotice(null);
    onClose();
  }

  function backToList() {
    selecting.current++;
    setSelection(null);
    setCompare(false);
    panel.current?.focus({ preventScroll: true });
  }

  async function select(item: DocVersionItem) {
    const ticket = ++selecting.current;
    setSelection({ item });
    setCompare(false);
    setError(null);
    try {
      const version = await transport.getVersion(id, item.id);
      if (!alive.current || ticket !== selecting.current) return;
      const doc = new Y.Doc();
      let blocks: VersionBlock[];
      try {
        Y.applyUpdate(doc, version.ystate);
        blocks = blocksFromDoc(doc);
      } finally {
        doc.destroy();
      }
      if (!alive.current || ticket !== selecting.current) return;
      setSelection({ item, version, blocks });
    } catch {
      if (!alive.current || ticket !== selecting.current) return;
      setSelection({
        item,
        error: 'Не удалось открыть версию. Проверьте связь и повторите.',
      });
    }
  }

  async function perform(operation: () => Promise<void>) {
    if (performing.current) return;
    performing.current = true;
    setBusy(true);
    setError(null);
    try {
      await operation();
    } catch (failure) {
      if (alive.current) setError(actionError(failure));
    } finally {
      performing.current = false;
      if (alive.current) setBusy(false);
    }
  }

  async function confirm() {
    if (!action) return;
    await perform(async () => {
      if (action.kind === 'restore') {
        if (!selection?.version || !store) return;
        if (!handle?.loaded) throw new Error('Документ не загружен');
        await store.restoreVersion(id, selection.version);
        if (!alive.current) return;
        selecting.current++;
        setSelection(null);
        setCompare(false);
        setAction(null);
        onRestored();
      } else {
        if (action.item.kind !== 'named' || !history.online) return;
        if (action.kind === 'rename') {
          if (!validName(rename)) return;
          const renamed = await transport.renameVersion(id, action.item.id, rename.trim());
          if (!alive.current) return;
          // Инвалидируем старый GET только при переименовании выбранного снимка.
          if (selection?.item.id === renamed.id) {
            selecting.current++;
            const doc = new Y.Doc();
            try {
              Y.applyUpdate(doc, renamed.ystate);
              setSelection({ item: renamed, version: renamed, blocks: blocksFromDoc(doc) });
            } finally {
              doc.destroy();
            }
          }
        } else {
          await transport.deleteVersion(id, action.item.id);
          if (!alive.current) return;
          if (selection?.item.id === action.item.id) backToList();
        }
        setAction(null);
        await history.refresh();
      }
    });
  }

  const diffs = useMemo(() => {
    if (!compare || !selection?.blocks) return [];
    const blocks =
      current && current.doc === handle?.doc
        ? current.blocks
        : handle
          ? blocksFromDoc(handle.doc)
          : [];
    // Пустые абзацы, появившиеся или исчезнувшие целиком, не считаем правкой (D-815).
    return diffBlocks(selection.blocks, blocks).filter(
      (part) => !((part.op === 'added' || part.op === 'removed') && part.block.text.trim() === ''),
    );
  }, [compare, selection, current, handle]);
  const changes = diffs.filter((part) => part.op !== 'equal').length;
  const compareControl = (
    <label className="docs-history-compare">
      <Switch checked={compare} onChange={setCompare} label="Сравнить с текущей" />
      <span>Сравнить с текущей</span>
    </label>
  );
  const restoreControl = (
    <Button
      variant="fill"
      disabled={busy || !selection?.version || !store}
      onClick={() => {
        setError(null);
        setAction({ kind: 'restore' });
      }}
    >
      Восстановить
    </Button>
  );

  const versionView = (
    <section
      ref={preview}
      tabIndex={-1}
      className="docs-history-preview"
      aria-label="Просмотр версии"
      aria-busy={!selection?.blocks && !selection?.error}
    >
      <div className="docs-history-banner">
        <span>Версия от {selection && dateTime(selection.item.created_at)}</span>
        {wide && selection?.version && (
          <>
            {compareControl}
            {restoreControl}
          </>
        )}
        <Button onClick={backToList}>{wide ? 'Закрыть версию' : 'К списку версий'}</Button>
      </div>
      {selection?.error ? (
        <div className="docs-history-retry">
          <Note tone="bad">{selection.error}</Note>
          <Button disabled={!history.online} onClick={() => void select(selection.item)}>
            Повторить
          </Button>
        </div>
      ) : !selection?.blocks ? (
        <Note>Открываю версию…</Note>
      ) : (
        <Swap
          view={`${selection.item.id}-${compare}`}
          order={[`${selection.item.id}-false`, `${selection.item.id}-true`]}
        >
          <h2 className="docs-history-title">{selection.item.title}</h2>
          {compare && <p role="status">Изменений: {changes} · От версии к текущему тексту</p>}
          <div className="docs-text" aria-label={compare ? 'Сравнение версий' : 'Текст версии'}>
            {compare ? (
              <DiffView parts={diffs} />
            ) : (
              selection.blocks.map((block, index, blocks) => (
                <VersionBlockView key={index} block={block} number={orderedNumber(blocks, index)} />
              ))
            )}
            {!selection.blocks.length && !compare && <p>Пустой документ</p>}
          </div>
        </Swap>
      )}
    </section>
  );

  const list = (
    <aside ref={panel} tabIndex={-1} className="docs-history-list" aria-label="Версии документа">
      {wide && (
        <SecHead text="ИСТОРИЯ" label="История">
          {/* Короткая подпись: в колонке 320 px кнопка помещается справа от заголовка (§0.2). */}
          <Button size="sm" aria-label="Закрыть историю" onClick={close}>
            Закрыть
          </Button>
        </SecHead>
      )}
      <form
        className="docs-history-save"
        onSubmit={(event) => {
          event.preventDefault();
          if (!validName(name) || !history.online || !store) return;
          void perform(async () => {
            await store.createVersion(id, name.trim());
            if (!alive.current) return;
            setName('');
            setNotice('Версия сохранена');
            await history.refresh();
          });
        }}
      >
        <Field
          label="Имя версии"
          value={name}
          onChange={(event) => setName(event.target.value)}
          maxLength={80}
          hint={history.online ? 'От 1 до 80 знаков' : 'Нужна связь: версия снимается на сервере'}
        />
        <Button type="submit" disabled={busy || !history.online || !store || !validName(name)}>
          Сохранить версию
        </Button>
      </form>
      <Presence show={!!notice}>
        <Note>{notice}</Note>
      </Presence>
      {!history.online ? (
        <Note>Нужна связь, чтобы посмотреть историю</Note>
      ) : (
        <>
          {history.loading && <Note>Загружаю историю…</Note>}
          {history.error && (
            <div className="docs-history-retry">
              <Note tone="bad">{history.error}</Note>
              <Button disabled={history.loading} onClick={() => void history.refresh()}>
                Повторить загрузку истории
              </Button>
            </div>
          )}
          {!history.loading && !history.error && !history.versions.length && (
            <Note>Версий пока нет — они появляются, когда вы правите документ</Note>
          )}
          <div className="docs-history-rows">
            {slide.node}
            {groupVersions(history.versions).map(({ day, items }) => (
              <section key={day} aria-label={day}>
                <SecHead text={day.toLocaleUpperCase('ru')} label={day} />
                {items.map((item) => (
                  <div key={item.id} className="docs-history-item">
                    <Button
                      className="docs-history-row"
                      dot={false}
                      aria-current={selection?.item.id === item.id ? 'true' : undefined}
                      disabled={busy}
                      onClick={() => void select(item)}
                    >
                      <time dateTime={item.created_at}>
                        {new Date(item.created_at).toLocaleTimeString('ru', {
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </time>
                      <span>
                        {item.kind === 'named'
                          ? `${item.name} · Версия`
                          : item.kind === 'before_restore'
                            ? 'Перед восстановлением'
                            : 'Автоснимок'}
                      </span>
                      <span className="docs-history-snippet">
                        {plainPreview(item.preview.split('\n')[0] ?? '') || 'Пустой документ'}
                      </span>
                    </Button>
                    {item.kind === 'named' && (
                      <div className="docs-history-row-actions">
                        <Button
                          size="sm"
                          disabled={busy}
                          aria-label={`Переименовать версию «${item.name}»`}
                          onClick={() => {
                            setError(null);
                            setRename(item.name ?? '');
                            setAction({ kind: 'rename', item });
                          }}
                        >
                          Переименовать
                        </Button>
                        <Button
                          size="sm"
                          disabled={busy}
                          aria-label={`Удалить версию «${item.name}»`}
                          onClick={() => {
                            setError(null);
                            setAction({ kind: 'delete', item });
                          }}
                        >
                          Удалить
                        </Button>
                      </div>
                    )}
                  </div>
                ))}
              </section>
            ))}
          </div>
          {history.more && (
            <Button disabled={history.loading || busy} onClick={() => void history.loadMore()}>
              Показать ещё
            </Button>
          )}
        </>
      )}
    </aside>
  );

  // Заголовок окна называет действие и на ПК, и на телефоне.
  const actionTitle =
    action?.kind === 'restore'
      ? 'Восстановить версию'
      : action?.kind === 'rename'
        ? 'Переименовать версию'
        : 'Удалить версию';
  // На телефоне подтверждение занимает тот же Sheet, без двух ловушек фокуса.
  const confirmation = (
    <div className="docs-history-confirm">
      {action?.kind === 'restore' ? (
        <p>Текущий текст сохранится в истории</p>
      ) : action?.kind === 'rename' ? (
        <Field
          autoFocus
          label="Новое имя версии"
          value={rename}
          maxLength={80}
          onChange={(event) => setRename(event.target.value)}
          hint="От 1 до 80 знаков"
        />
      ) : (
        <p>Удалить именованную версию «{action?.kind === 'delete' ? action.item.name : ''}»?</p>
      )}
      {!history.online && action?.kind !== 'restore' && (
        <Note>Нужна связь, чтобы изменить историю</Note>
      )}
      {error && <Note tone="bad">{error}</Note>}
      <div className="docs-history-actions">
        <Button
          variant="fill"
          disabled={
            busy ||
            (action?.kind !== 'restore' && !history.online) ||
            (action?.kind === 'rename' && !validName(rename))
          }
          onClick={() => void confirm()}
        >
          {action?.kind === 'restore'
            ? 'Восстановить'
            : action?.kind === 'rename'
              ? 'Сохранить имя'
              : 'Удалить'}
        </Button>
        <Button
          disabled={busy}
          onClick={() => {
            setAction(null);
            setError(null);
          }}
        >
          Отмена
        </Button>
      </div>
    </div>
  );

  return (
    <div
      className={wide ? 'docs-history-layout' : undefined}
      onKeyDown={(event) => {
        if (wide && open && !action && event.key === 'Escape') {
          event.stopPropagation();
          close();
        }
      }}
    >
      <div className="docs-history-document">
        <div hidden={viewing && wide}>{children}</div>
        {wide && (
          <Presence show={viewing} swap={selection?.item.id}>
            {versionView}
          </Presence>
        )}
      </div>
      {wide ? (
        <>
          <Presence show={open} className="docs-history-panel">
            {list}
            {!action && error && <Note tone="bad">{error}</Note>}
          </Presence>
          <Sheet
            open={open && !!action}
            onClose={() => {
              if (!busy) {
                setAction(null);
                setError(null);
              }
            }}
            title={actionTitle}
          >
            {confirmation}
          </Sheet>
        </>
      ) : (
        <Sheet
          open={open}
          onClose={close}
          title={action ? actionTitle : 'История'}
          className="docs-history-sheet"
          footer={
            !action && selection?.version ? (
              <div className="docs-history-actions">
                {compareControl}
                {restoreControl}
              </div>
            ) : undefined
          }
        >
          <Swap
            view={action ? 'confirm' : selection ? 'version' : 'list'}
            order={['list', 'version', 'confirm']}
          >
            {action ? (
              confirmation
            ) : (
              <>
                {!selection ? list : versionView}
                {error && <Note tone="bad">{error}</Note>}
              </>
            )}
          </Swap>
        </Sheet>
      )}
    </div>
  );
}

function orderedNumber(blocks: readonly VersionBlock[], index: number) {
  let start = index;
  while (start > 0 && blocks[start - 1]?.kind === 'ol') start--;
  return index - start + 1;
}

function VersionBlockView({
  block,
  children,
  number = 1,
}: {
  block: VersionBlock;
  children?: ReactNode;
  number?: number;
}) {
  return (
    <div
      className="docs-block"
      data-kind={block.kind}
      data-checked={String(!!block.checked)}
      data-number={number}
      role={block.kind === 'h1' || block.kind === 'h2' ? 'heading' : undefined}
      aria-level={block.kind === 'h1' ? 1 : block.kind === 'h2' ? 2 : undefined}
    >
      {block.kind === 'todo' && (
        <span className="docs-history-todo">
          <DotIcon name={block.checked ? 'check' : 'today'} />
          <span className="q-sr">{block.checked ? 'Выполнено' : 'Не выполнено'}</span>
        </span>
      )}
      <div className="docs-block-content">{children ?? block.text}</div>
    </div>
  );
}

function DiffView({ parts }: { parts: BlockDiff[] }) {
  let number = 0;
  return parts.map((part, index) => {
    const block = part.op === 'changed' ? part.newBlock : part.block;
    number = block.kind === 'ol' ? number + 1 : 0;
    return (
      <div key={index} className={`docs-history-diff docs-history-${part.op}`} data-diff={part.op}>
        {part.op !== 'equal' && (
          <span className="docs-history-diff-label">
            {part.op === 'added'
              ? '+ Добавлено'
              : part.op === 'removed'
                ? '− Удалено'
                : '± Изменено'}
          </span>
        )}
        <VersionBlockView block={block} number={number}>
          {part.op === 'changed' ? (
            <>
              {part.oldBlock.checked !== part.newBlock.checked && (
                <span className="docs-history-check-change">
                  {part.oldBlock.checked
                    ? '− Выполнено → + Не выполнено: '
                    : '− Не выполнено → + Выполнено: '}
                </span>
              )}
              {part.words.map((word, n) =>
                word.op === 'add' ? (
                  <ins key={n}>+{word.text}</ins>
                ) : word.op === 'del' ? (
                  <del key={n}>−{word.text}</del>
                ) : (
                  <span key={n}>{word.text}</span>
                ),
              )}
            </>
          ) : part.op === 'removed' ? (
            <del>{block.text}</del>
          ) : (
            block.text
          )}
        </VersionBlockView>
      </div>
    );
  });
}
