import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import type { DocHandle, DocLinkTarget } from '@qubite/sync-client';
import { Button, Presence, useMedia, useSlide, WIDE } from '@qubite/ui';
import {
  $getNodeByKey,
  $getRoot,
  $getSelection,
  $isElementNode,
  $isNodeSelection,
  COMMAND_PRIORITY_CRITICAL,
  KEY_BACKSPACE_COMMAND,
  KEY_ENTER_COMMAND,
  type LexicalNode,
} from 'lexical';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { caretPoint } from '../../lab/caret';
import { $createMentionNode, $isMentionNode } from './MentionNode';
import { httpLinkSource, linkHref, LINK_LABELS, mentionLabel, type LinkSource } from './links';
import { $extractLinks } from './markdown';
import {
  $backspaceMention,
  $mentionQuery,
  $selectMentionQuery,
  type MentionQuery,
} from './mention-menu';

const EMPTY_TARGETS: DocLinkTarget[] = [];

export function Mentions({ handle, source: supplied }: { handle: DocHandle; source?: LinkSource }) {
  const [editor] = useLexicalComposerContext();
  const source = useMemo(() => supplied ?? httpLinkSource(), [supplied]);
  const [query, setQuery] = useState<MentionQuery | null>(null);
  const [search, setSearch] = useState<{
    key: string;
    targets: DocLinkTarget[];
    message: string;
  } | null>(null);
  const [active, setActive] = useState(0);
  const dismissed = useRef<string | null>(null);
  const menu = useRef<HTMLDivElement>(null);
  const layer = useRef<HTMLDivElement>(null);
  const wide = useMedia(WIDE);
  const highlight = useSlide(44);
  const triggerId = query?.id;
  const queryText = query?.query ?? '';
  const searchKey = `${triggerId}:${queryText}`;
  const found = search?.key === searchKey ? search : null;
  const results = found?.targets ?? EMPTY_TARGETS;
  const message = found?.message ?? 'Ищем…';

  useEffect(() => {
    const refreshChips = () =>
      editor.getEditorState().read(() => {
        const selected = $getSelection();
        const visit = (node: LexicalNode) => {
          if ($isElementNode(node)) node.getChildren().forEach(visit);
          if (!$isMentionNode(node)) return;
          const dom = editor.getElementByKey(node.getKey());
          if (!dom) return;
          const link = handle.links.find((value) => value.id === node.getTarget());
          dom.textContent = mentionLabel(link);
          dom.dataset.deleted = String(!!link?.deleted);
          dom.dataset.selected = String($isNodeSelection(selected) && selected.has(node.getKey()));
          dom.setAttribute('role', 'link');
          dom.setAttribute('aria-disabled', String(!!link?.deleted));
          dom.tabIndex = link?.deleted ? -1 : 0;
          dom.setAttribute(
            'aria-label',
            `${LINK_LABELS[link?.type ?? node.getKind()]}: ${mentionLabel(link)}`,
          );
        };
        visit($getRoot());
      });
    const stop = editor.registerUpdateListener(() => {
      refreshChips();
      editor.getEditorState().read(() => {
        const next = editor.isComposing() ? null : $mentionQuery();
        if (!next) dismissed.current = null;
        const value = next?.id === dismissed.current ? null : next;
        setQuery((current) =>
          current?.id === value?.id && current?.query === value?.query ? current : value,
        );
      });
    });
    const stopLinks = handle.onLinks(refreshChips);
    refreshChips();
    return () => {
      stop();
      stopLinks();
    };
  }, [editor, handle]);

  useEffect(() => {
    let abort: AbortController | undefined;
    const refresh = () => {
      abort?.abort();
      abort = new AbortController();
      const request = abort;
      void source
        .links(handle.id, request.signal)
        .then((links) => {
          if (!request.signal.aborted) void handle.cacheLinks(links).catch(() => {});
        })
        .catch(() => {});
    };
    const stop = handle.onStatus((status) => {
      if (status === 'saved') refresh();
    });
    refresh();
    window.addEventListener('online', refresh);
    window.addEventListener('focus', refresh);
    return () => {
      abort?.abort();
      stop();
      window.removeEventListener('online', refresh);
      window.removeEventListener('focus', refresh);
    };
  }, [handle, source]);

  useEffect(() => {
    if (!triggerId) return;
    const key = `${triggerId}:${queryText}`;
    const abort = new AbortController();
    const timer = setTimeout(() => {
      void source
        .search(queryText, abort.signal)
        .then((targets) => {
          if (abort.signal.aborted) return;
          // Сам документ в меню не предлагаем: сервер такую связь отбросит (D-792).
          setSearch({
            key,
            targets: targets.filter((target) => target.id !== handle.id),
            message: 'Ничего не найдено',
          });
          setActive(0);
        })
        .catch(() => {
          if (abort.signal.aborted) return;
          const cached = handle.links
            .filter(
              (link) =>
                !link.deleted &&
                link.id !== handle.id &&
                link.title.toLocaleLowerCase('ru').includes(queryText.toLocaleLowerCase('ru')),
            )
            .slice(-8)
            .reverse();
          setSearch({ key, targets: cached, message: 'Без сети — нет сохранённых целей' });
          setActive(0);
        });
    }, 150);
    return () => {
      clearTimeout(timer);
      abort.abort();
    };
  }, [triggerId, queryText, handle, source]);

  const pick = useCallback(
    (target: DocLinkTarget) => {
      if (!query) return;
      let inserted = false;
      editor.update(
        () => {
          const current = $mentionQuery();
          if (current?.id !== query.id || current.query !== query.query) return;
          const links = $extractLinks();
          if (links.length >= 200 && !links.includes(target.id)) {
            setSearch({
              key: searchKey,
              targets: [],
              message: 'В документе может быть до 200 разных ссылок',
            });
            return;
          }
          $selectMentionQuery(current);
          $getSelection()?.insertNodes([$createMentionNode(target.id, target.type)]);
          inserted = true;
        },
        { discrete: true },
      );
      if (!inserted) return;
      void handle.cacheLinks([{ ...target, deleted: false }]).catch(() => {});
      dismissed.current = query.id;
      setQuery(null);
      editor.focus();
    },
    [editor, handle, query, searchKey],
  );

  useEffect(() => {
    const open = (node: LexicalNode | null, newTab = false) => {
      if (!$isMentionNode(node)) return false;
      const link = handle.links.find((value) => value.id === node.getTarget());
      if (link?.deleted) return true;
      const href = linkHref(node.getTarget(), link?.type ?? node.getKind());
      if (newTab) window.open(href, '_blank', 'noopener,noreferrer');
      else window.location.assign(href);
      return true;
    };
    const stopBackspace = editor.registerCommand(
      KEY_BACKSPACE_COMMAND,
      (event) => {
        if (!$backspaceMention()) return false;
        event.preventDefault();
        return true;
      },
      COMMAND_PRIORITY_CRITICAL,
    );
    const stopEnter = editor.registerCommand(
      KEY_ENTER_COMMAND,
      (event) => {
        const selection = $getSelection();
        if (!$isNodeSelection(selection) || selection.getNodes().length !== 1) return false;
        if (!open(selection.getNodes()[0] ?? null, !!(event?.ctrlKey || event?.metaKey))) return false;
        event?.preventDefault();
        return true;
      },
      COMMAND_PRIORITY_CRITICAL,
    );
    const root = editor.getRootElement();
    const chip = (event: Event) => {
      const target =
        event.target instanceof Element
          ? event.target.closest<HTMLElement>('[data-mention]')
          : null;
      return target && root?.contains(target) ? target.dataset.mention : undefined;
    };
    const click = (event: MouseEvent) => {
      const key = chip(event);
      if (!key) return;
      event.preventDefault();
      editor.getEditorState().read(() => open($getNodeByKey(key), event.ctrlKey || event.metaKey));
    };
    const blur = (event: FocusEvent) => {
      if (
        event.relatedTarget instanceof Node &&
        (root?.contains(event.relatedTarget) || menu.current?.contains(event.relatedTarget))
      ) {
        return;
      }
      dismissed.current = query?.id ?? null;
      setQuery(null);
    };
    const keydown = (event: KeyboardEvent) => {
      const key = chip(event);
      if (key && event.key === 'Enter') {
        event.preventDefault();
        event.stopPropagation();
        editor.getEditorState().read(() => open($getNodeByKey(key), event.ctrlKey || event.metaKey));
        return;
      }
      if (!query || event.isComposing) return;
      if (event.key === 'Escape') {
        dismissed.current = query.id;
        setQuery(null);
      } else if (results.length && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
        setActive(
          (value) => (value + (event.key === 'ArrowDown' ? 1 : -1) + results.length) % results.length,
        );
      } else if (results.length && (event.key === 'Enter' || event.key === 'Tab')) {
        pick(results[Math.min(active, results.length - 1)]!);
      } else return;
      event.preventDefault();
      event.stopPropagation();
    };
    root?.addEventListener('click', click);
    root?.addEventListener('blur', blur, true);
    root?.addEventListener('keydown', keydown, true);
    return () => {
      stopBackspace();
      stopEnter();
      root?.removeEventListener('click', click);
      root?.removeEventListener('blur', blur, true);
      root?.removeEventListener('keydown', keydown, true);
    };
  }, [editor, handle, query, results, active, pick]);

  useEffect(() => {
    const box = menu.current;
    const row = box?.querySelector<HTMLElement>('[aria-selected="true"]');
    if (row && box) {
      highlight.to(row.offsetTop, row.offsetHeight);
      if (row.offsetTop < box.scrollTop) box.scrollTop = row.offsetTop;
      else if (row.offsetTop + row.offsetHeight > box.scrollTop + box.clientHeight) {
        box.scrollTop = row.offsetTop + row.offsetHeight - box.clientHeight;
      }
    } else highlight.hide();
  }, [active, results, highlight.to, highlight.hide]);

  useEffect(() => {
    if (!query) return;
    const viewport = window.visualViewport;
    const place = () => {
      const visibleBottom = (viewport?.offsetTop ?? 0) + (viewport?.height ?? window.innerHeight);
      if (!menu.current) return;
      const root = editor.getRootElement();
      if (!root) return;
      const point = caretPoint(root);
      const box = root.getBoundingClientRect();
      const tools = document.querySelector('.docs-tools-layer .docs-tools');
      const withoutKeyboard = window.innerHeight - visibleBottom < 88;
      const floor = wide
        ? visibleBottom - 96
        : Math.min(
            visibleBottom - (withoutKeyboard ? 88 : 0),
            tools?.getBoundingClientRect().top ?? visibleBottom,
          ) - 8;
      const header =
        Math.max(
          viewport?.offsetTop ?? 0,
          document.querySelector('.head')?.getBoundingClientRect().bottom ?? 0,
          document.querySelector('.docs-page-head')?.getBoundingClientRect().bottom ?? 0,
        ) + 8;
      layer.current?.style.setProperty('--docs-mention-room', `${Math.max(44, floor - header)}px`);
      layer.current?.style.setProperty('--docs-mention-bottom', `${window.innerHeight - floor}px`);
      if (!wide) return;
      const height = menu.current.offsetHeight;
      const y = Math.min(box.top + point.y, floor - height);
      const x = Math.max(
        18,
        Math.min(box.left + point.x, window.innerWidth - menu.current.offsetWidth - 18),
      );
      menu.current.style.transform = `translate(${x}px, ${Math.max(header, y)}px)`;
    };
    place();
    viewport?.addEventListener('resize', place);
    viewport?.addEventListener('scroll', place);
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    return () => {
      viewport?.removeEventListener('resize', place);
      viewport?.removeEventListener('scroll', place);
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
    };
  }, [query, results.length, editor, wide]);

  return createPortal(
    <div ref={layer} className="docs-mention-layer" inert={!query}>
      <Presence show={!!query} className="docs-mention-wrap">
        <div
          ref={menu}
          className="docs-slash docs-mention-menu"
          role="listbox"
          aria-label="Ссылка на объект"
        >
          {highlight.node}
          {results.length ? (
            results.map((target, index) => (
              <div role="option" aria-selected={index === active} key={target.id}>
                <Button
                  dot={false}
                  onMouseDown={(event) => event.preventDefault()}
                  onMouseEnter={() => setActive(index)}
                  onClick={() => pick(target)}
                >
                  <span className="docs-mention-title">{target.title}</span>
                  <span className="docs-mention-kind">{LINK_LABELS[target.type]}</span>
                </Button>
              </div>
            ))
          ) : (
            <div className="docs-mention-empty" role="status">
              {message}
            </div>
          )}
        </div>
      </Presence>
    </div>,
    document.body,
  );
}
