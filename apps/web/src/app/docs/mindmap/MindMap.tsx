/**
 * Экран mind map (DOC-006, макеты — docs/design/MINDMAP.md). Данные — Yjs документа (model.ts),
 * раскладка — layout.ts, движение — scene.ts. Ввод — одни Pointer Events для мыши, пальца и пера
 * (D-1006): палец по пустому — панорама, два — масштаб, долгое нажатие на узел — перетащить.
 */
import { useNavigate } from '@tanstack/react-router';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type * as Y from 'yjs';
import {
  MINDMAP_LOST_KIND,
  type DocHandle,
  type DocLink,
  type DocLinkKind,
  type DocLinkTarget,
  type LostBlock,
} from '@qubite/sync-client';
import {
  Button,
  DotIcon,
  Field,
  Note,
  IconButton,
  Menu,
  Presence,
  Sheet,
  useMedia,
  WIDE,
  type IconName,
} from '@qubite/ui';
import { httpLinkSource, LINK_LABELS, linkHref } from '../links';
import { layoutTree, neighbour, type Box, type Layout } from './layout';
import { ADVANCE, descendants, measureNode, probeAdvance, type NodeSize } from './measure';
import {
  addChild,
  addLinkChild,
  addSibling,
  BRANCH_COLORS,
  findNode,
  moveNode,
  parentNode,
  readTree,
  removeNode,
  restoreLostNodes,
  ROOT,
  setColor,
  setFolded,
  setText,
  type BranchColor,
  type MindNode,
  type Side,
} from './model';
import { MAX_ZOOM, MIN_ZOOM, Scene } from './scene';
import { nodeLabel } from './text';
import './mindmap.css';

const COLOR_NAMES: Record<BranchColor, string> = {
  sky: 'голубой',
  green: 'зелёный',
  orange: 'оранжевый',
  yellow: 'жёлтый',
  peach: 'персиковый',
};
const NARROW_GAP = '(min-width: 600px)';
/** Долгое нажатие пальцем или пером — перетаскивание (D-1006). */
export const LONG_PRESS = 400;
const MOVE = 6;

function useTree(doc: Y.Doc): MindNode {
  const [tree, setTree] = useState(() => readTree(doc));
  // Другой Y.Doc — другой ключ компонента (Docs.tsx), поэтому начальное дерево всегда своё.
  useEffect(() => {
    const update = () => setTree(readTree(doc));
    doc.on('update', update);
    return () => doc.off('update', update);
  }, [doc]);
  return tree;
}

function useLinks(handle: DocHandle): readonly DocLink[] {
  const [links, setLinks] = useState(handle.links);
  useEffect(() => handle.onLinks(() => setLinks(handle.links)), [handle]);
  // Названия целей не едут через Yjs: подгружаем их с сервера, как Mentions у документа, —
  // при открытии, после сохранения, при возврате сети и окна. Иначе на другом устройстве
  // узел-ссылка показывает «…», а переименованная цель — старое название.
  useEffect(() => {
    const source = httpLinkSource();
    let abort: AbortController | undefined;
    const refresh = () => {
      abort?.abort();
      abort = new AbortController();
      const request = abort;
      void source
        .links(handle.id, request.signal)
        .then((found) => {
          if (!request.signal.aborted) void handle.cacheLinks(found).catch(() => {});
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
  }, [handle]);
  return links;
}

interface View {
  node: MindNode;
  label: string;
  size: NodeSize;
  fold: number;
  parent: string | null;
  box: Box;
}

const placeholder = (node: MindNode) => (node.depth === 0 ? 'Центральная тема' : 'Новый узел');

function subtreeIds(node: MindNode): string[] {
  return [node.id, ...node.children.flatMap(subtreeIds)];
}

type Gesture =
  | { kind: 'press'; id: string; x: number; y: number; touch: boolean; timer: number }
  | { kind: 'drag'; id: string; ids: string[]; x: number; y: number }
  | { kind: 'pan'; x: number; y: number; moved: boolean }
  | { kind: 'pinch'; d: number; k: number }
  | null;

export function MindMap({ handle, title }: { handle: DocHandle; title: string }) {
  const doc = handle.doc;
  const tree = useTree(doc);
  const links = useLinks(handle);
  // Узлы, удалённые на другом устройстве поверх здешней правки (watchLostMindmap).
  const [lost, setLost] = useState<LostBlock[]>(handle.lost);
  useEffect(() => handle.onLost(setLost), [handle]);
  const lostNodes = lost.filter((item) => item.kind === MINDMAP_LOST_KIND);
  const [busy, setBusy] = useState(false);
  /** Отказ модели: лимиты узлов, текста, ссылок — показываем, а не роняем экран. */
  const [problem, setProblem] = useState<string | null>(null);
  const settleLost = useCallback(
    async (restore: boolean) => {
      setBusy(true);
      try {
        if (restore) restoreLostNodes(doc, handle.lost);
        await handle.clearLost();
      } catch (error) {
        setProblem(error instanceof Error ? error.message : 'Вернуть не вышло.');
      } finally {
        setBusy(false);
      }
    },
    [doc, handle],
  );
  const wide = useMedia(WIDE);
  const roomy = useMedia(NARROW_GAP);
  const navigate = useNavigate();
  const [scene] = useState(() => new Scene());
  const stage = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLDivElement>(null);
  // Новая пустая карта — сразу правка центра (макет «пусто»).
  const [blank] = useState(() => !tree.text && !tree.children.length);
  const [chosen, setSelected] = useState<string | null>(blank ? ROOT : null);
  const [opened, setEditing] = useState<{ id: string; original: string; fresh: boolean } | null>(
    blank ? { id: ROOT, original: '', fresh: false } : null,
  );
  const [drop, setDrop] = useState<string | null>(null);
  const [sheet, setSheet] = useState<'node' | 'color' | 'link' | null>(null);
  const [zoom, setZoom] = useState(1);
  const [ghosts, setGhosts] = useState<ReadonlyMap<string, View>>(new Map());
  const [advance, setAdvance] = useState(ADVANCE);
  const gesture = useRef<Gesture>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const lastTap = useRef<{ id: string; t: number } | null>(null);
  scene.onZoom = setZoom;

  // Выделенный узел исчез (удалили здесь или на другом устройстве) — выделения нет.
  const editing = opened && findNode(tree, opened.id) ? opened : null;
  const views = useMemo(() => {
    const out = new Map<string, View>();
    const sizes = new Map<string, NodeSize>();
    const labelOf = (node: MindNode) => nodeLabel(node, links) || placeholder(node);
    const layout: Layout = layoutTree(
      tree,
      (node) => {
        const size = measureNode(node, labelOf(node), node.folded ? descendants(node) : 0, advance);
        sizes.set(node.id, size);
        return size;
      },
      { gap: roomy ? 40 : 24 },
    );
    const walk = (node: MindNode, parent: string | null) => {
      const box = layout.boxes.get(node.id);
      if (!box) return;
      out.set(node.id, {
        node,
        label: labelOf(node),
        size: sizes.get(node.id)!,
        fold: node.folded ? descendants(node) : 0,
        parent,
        box,
      });
      if (!node.folded) node.children.forEach((child) => walk(child, node.id));
    };
    walk(tree, null);
    return { out, layout };
  }, [tree, links, roomy, advance]);

  const selected = chosen && views.out.has(chosen) ? chosen : null;

  // Ушедшие узлы ещё видны, пока уходят в родителя.
  const previous = useRef<ReadonlyMap<string, View>>(new Map());
  useLayoutEffect(() => {
    const removed = [...previous.current].filter(([id]) => !views.out.has(id));
    const back = [...ghosts.keys()].filter((id) => views.out.has(id));
    if (removed.length || back.length)
      setGhosts((current) => {
        const next = new Map(current);
        removed.forEach(([id, view]) => next.set(id, view));
        back.forEach((id) => next.delete(id));
        return next;
      });
    previous.current = views.out;
    const parents = new Map<string, string | null>();
    for (const [id, view] of views.out) parents.set(id, view.parent);
    scene.sync(views.layout, parents);
    // ghosts намеренно не в зависимостях: реагируем только на новую раскладку.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [views, scene]);
  useEffect(() => {
    scene.onGone = (id) => {
      scene.forget(id);
      setGhosts((current) => {
        if (!current.has(id)) return current;
        const next = new Map(current);
        next.delete(id);
        return next;
      });
    };
  }, [scene]);

  const viewport = useCallback(() => {
    const rect = canvas.current?.getBoundingClientRect();
    return {
      w: rect?.width ?? 0,
      h: rect?.height ?? 0,
      left: rect?.left ?? 0,
      top: rect?.top ?? 0,
    };
  }, []);
  // Снизу холст закрывают Command / нижняя панель (и панель узла на телефоне).
  const bottomInset = wide ? 96 : 180;

  const fit = useCallback(
    (animate = true) => {
      const { w, h } = viewport();
      if (!w || !h) return;
      const b = views.layout.bounds;
      const k = Math.min(1, (w - 64) / b.w, (h - 64 - bottomInset) / b.h);
      scene.look(b.x + b.w / 2, b.y + b.h / 2, k, w / 2, (h - bottomInset) / 2 + 16, animate);
    },
    [scene, viewport, views, bottomInset],
  );

  // Первый вид: центр карты по центру холста в 100 % (D-1006), на ПК — вся карта, если влезает.
  const placed = useRef(false);
  const touched = useRef(false);
  const [frame, setFrame] = useState('');
  useEffect(() => {
    const box = canvas.current;
    if (!box || typeof ResizeObserver !== 'function') return;
    const watch = new ResizeObserver(() =>
      requestAnimationFrame(() => setFrame(`${box.clientWidth}x${box.clientHeight}`)),
    );
    watch.observe(box);
    return () => watch.disconnect();
  }, []);
  useLayoutEffect(() => {
    // Пока карту не трогали, первый вид следует за размером холста.
    if (placed.current && touched.current) return;
    const { w, h } = viewport();
    if (!w || !h) return;
    placed.current = true;
    const b = views.layout.bounds;
    // ПК: вся карта, если для неё хватает 60 % масштаба; телефон — 100 % у центра (D-1006).
    const k = Math.min(1, (w - 64) / b.w, (h - 64 - bottomInset) / b.h);
    if (wide && k >= 0.6) fit(false);
    else scene.look(0, 0, 1, w / 2, (h - bottomInset) / 2, false);
    // views — только для первого вида; дальше раскладка вид не двигает.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewport, frame, wide, scene, bottomInset]);

  // Холст — от края до края рабочей области и до низа экрана; Command и нижняя панель — поверх.
  useLayoutEffect(() => {
    const box = stage.current;
    const host = box?.parentElement;
    if (!box || !host) return;
    // offsetLeft/offsetTop не видят transform: замер верен и посреди перехода между экранами.
    const offset = (el: HTMLElement, until: HTMLElement) => {
      let x = 0;
      let y = 0;
      let at: HTMLElement | null = el;
      while (at && at !== until) {
        x += at.offsetLeft;
        y += at.offsetTop;
        at = at.offsetParent as HTMLElement | null;
      }
      return at === until ? { x, y } : null;
    };
    const size = () => {
      const area = box.closest<HTMLElement>('.main');
      const inner = box.closest<HTMLElement>('.main-in');
      const at = area ? offset(host, area) : null;
      if (area && at) {
        box.style.setProperty('--mm-left', `${at.x}px`);
        box.style.setProperty(
          '--mm-right',
          `${Math.max(0, area.clientWidth - at.x - host.offsetWidth)}px`,
        );
      }
      const pad = inner ? parseFloat(getComputedStyle(inner).paddingBottom) || 0 : 0;
      box.style.setProperty('--mm-bottom', `${pad}px`);
      const top = area
        ? (offset(box, area)?.y ?? 0) + area.getBoundingClientRect().top + scrollY
        : 0;
      box.style.setProperty('--mm-height', `${Math.max(320, innerHeight - top)}px`);
    };
    size();
    addEventListener('resize', size);
    // Колонка меняет ширину, когда список документов уступает место карте.
    const watch =
      typeof ResizeObserver === 'function'
        ? new ResizeObserver(() => requestAnimationFrame(size))
        : null;
    watch?.observe(host);
    return () => {
      removeEventListener('resize', size);
      watch?.disconnect();
    };
  }, []);

  // Ширина знака — замером, когда шрифт загружен: перенос строк совпадает с расчётом.
  useLayoutEffect(() => {
    const box = canvas.current;
    if (!box) return;
    setAdvance(probeAdvance(box));
    let alive = true;
    void document.fonts?.ready.then(() => {
      if (alive && canvas.current) setAdvance(probeAdvance(canvas.current));
    });
    return () => {
      alive = false;
    };
  }, []);

  /** Узел вне видимой части — вид мягко подъезжает к нему. */
  const reveal = useCallback(
    (id: string) => {
      const box = views.out.get(id)?.box ?? scene.position(id);
      const { w, h } = viewport();
      if (!box || !w) return;
      const k = scene.zoom;
      const sx = scene.vx.goal + box.x * k;
      const sy = scene.vy.goal + box.y * k;
      const margin = 24;
      const bottom = h - bottomInset;
      if (sx >= margin && sy >= margin && sx + box.w * k <= w - margin && sy + box.h * k <= bottom)
        return;
      scene.look(box.x + box.w / 2, box.y + box.h / 2, k, w / 2, bottom / 2);
    },
    [scene, viewport, views, bottomInset],
  );

  const select = useCallback(
    (id: string | null) => {
      setSelected(id);
      if (id) requestAnimationFrame(() => reveal(id));
    },
    [reveal],
  );

  const edit = useCallback(
    (id: string, fresh = false) => {
      const node = findNode(readTree(doc), id);
      if (!node || node.link) return;
      setSelected(id);
      setEditing({ id, original: node.text, fresh });
      requestAnimationFrame(() => reveal(id));
    },
    [doc, reveal],
  );

  const finish = useCallback(
    (cancel: boolean) => {
      if (!editing) return;
      const current = readTree(doc);
      const node = findNode(current, editing.id);
      const parent = parentNode(current, editing.id)?.id ?? ROOT;
      let kept = !!node;
      if (node && node.id !== ROOT && editing.fresh && (cancel || !node.text.trim())) {
        // Новый узел без текста или отменённый — не остаётся пустой точкой на карте.
        removeNode(doc, node.id);
        kept = false;
      } else if (node && cancel) setText(doc, node.id, editing.original);
      setEditing(null);
      setSelected(kept ? editing.id : parent);
      canvas.current?.focus({ preventScroll: true });
    },
    [doc, editing],
  );

  const addKid = useCallback(
    (id: string) => {
      let created: string;
      try {
        created = addChild(doc, id);
      } catch (error) {
        setProblem(error instanceof Error ? error.message : 'Узел добавить не вышло.');
        return;
      }
      edit(created, true);
    },
    [doc, edit],
  );
  const addNext = useCallback(
    (id: string) => {
      let created: string;
      try {
        created = addSibling(doc, id);
      } catch (error) {
        setProblem(error instanceof Error ? error.message : 'Узел добавить не вышло.');
        return;
      }
      edit(created, true);
    },
    [doc, edit],
  );
  const remove = useCallback(
    (id: string) => {
      if (id === ROOT) return;
      const parent = parentNode(readTree(doc), id)?.id ?? ROOT;
      removeNode(doc, id);
      select(parent);
    },
    [doc, select],
  );
  const toggleFold = useCallback(
    (id: string) => {
      const node = findNode(readTree(doc), id);
      if (node && node.children.length) setFolded(doc, id, !node.folded);
    },
    [doc],
  );
  const openLink = useCallback(
    (node: MindNode) => {
      if (node.link) void navigate({ href: linkHref(node.link.target, node.link.kind) });
    },
    [navigate],
  );

  /** Узел-ссылка @ под выделенным (DOC-003): подпись — из кэша названий документа. */
  const link = useCallback(
    (target: DocLinkTarget) => {
      if (!selected) return;
      const id = addLinkChild(doc, selected, { target: target.id, kind: target.type });
      void handle.cacheLinks([
        ...handle.links.filter((item) => item.id !== target.id),
        { ...target, deleted: false },
      ]);
      setSheet(null);
      select(id);
    },
    [doc, handle, selected, select],
  );

  // Ушли со страницы посреди правки: пустой новый узел не остаётся.
  const editingRef = useRef(editing);
  editingRef.current = editing;
  useEffect(
    () => () => {
      const open = editingRef.current;
      if (!open?.fresh || open.id === ROOT) return;
      const node = findNode(readTree(doc), open.id);
      if (node && !node.text.trim()) removeNode(doc, open.id);
    },
    [doc],
  );

  const zoomBy = useCallback(
    (factor: number) => {
      const { w, h } = viewport();
      scene.zoomAt(scene.zoom * factor, w / 2, (h - bottomInset) / 2, true);
    },
    [scene, viewport, bottomInset],
  );

  function onKeyDown(event: React.KeyboardEvent) {
    touched.current = true;
    if (editing) return;
    const mod = event.ctrlKey || event.metaKey;
    if (mod && (event.key === '=' || event.key === '+')) {
      event.preventDefault();
      zoomBy(1.25);
      return;
    }
    if (mod && event.key === '-') {
      event.preventDefault();
      zoomBy(0.8);
      return;
    }
    if (mod && event.key === '0') {
      event.preventDefault();
      fit();
      return;
    }
    const id = selected;
    if (!id) {
      if (event.key.startsWith('Arrow') || event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        select(ROOT);
      }
      return;
    }
    const node = findNode(tree, id);
    if (!node) return;
    if (event.key === 'Tab' && !event.shiftKey) {
      event.preventDefault();
      addKid(id);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      addNext(id);
    } else if (event.key === 'F2' || event.key === ' ') {
      event.preventDefault();
      if (node.link) openLink(node);
      else edit(id);
    } else if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault();
      remove(id);
    } else if (mod && event.key === '.') {
      event.preventDefault();
      toggleFold(id);
    } else if (event.key === 'Escape') {
      setSelected(null);
    } else if (event.key.startsWith('Arrow')) {
      event.preventDefault();
      const direction = event.key.slice(5).toLowerCase() as 'left' | 'right' | 'up' | 'down';
      const next = neighbour(views.layout, id, direction);
      if (next) select(next);
    }
  }

  // Колесо: прокрутка, с Ctrl — масштаб у курсора. Нужен не-passive слушатель.
  useEffect(() => {
    const box = canvas.current;
    if (!box) return;
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      touched.current = true;
      const rect = box.getBoundingClientRect();
      if (event.ctrlKey || event.metaKey) {
        const factor = Math.exp(-event.deltaY * 0.002);
        scene.zoomAt(scene.zoom * factor, event.clientX - rect.left, event.clientY - rect.top);
      } else scene.panBy(-event.deltaX, -event.deltaY);
    };
    box.addEventListener('wheel', wheel, { passive: false });
    return () => box.removeEventListener('wheel', wheel);
  }, [scene]);

  const local = (event: { clientX: number; clientY: number }) => {
    const { left, top } = viewport();
    return { x: event.clientX - left, y: event.clientY - top };
  };

  /** Куда бросили ветку: узел под пальцем (не из своей ветки) или сторона центра. */
  const target = (x: number, y: number, skip: readonly string[]): string | null => {
    const p = scene.world(x, y);
    for (const [id, view] of views.out) {
      if (skip.includes(id)) continue;
      const b = view.box;
      if (p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h) return id;
    }
    return null;
  };

  function startDrag(id: string, x: number, y: number) {
    const node = findNode(tree, id);
    if (!node || id === ROOT) {
      gesture.current = { kind: 'pan', x, y, moved: true };
      return;
    }
    if (editing) finish(false);
    setSelected(id);
    gesture.current = { kind: 'drag', id, ids: subtreeIds(node), x, y };
    navigator.vibrate?.(10);
  }

  function onPointerDown(event: React.PointerEvent) {
    touched.current = true;
    if ((event.target as Element).closest('.mm-input, .mm-overlay')) return;
    if (event.button !== 0 && event.pointerType === 'mouse') return;
    canvas.current?.setPointerCapture?.(event.pointerId);
    const at = local(event);
    pointers.current.set(event.pointerId, at);
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      if (gesture.current?.kind === 'press') clearTimeout(gesture.current.timer);
      if (gesture.current?.kind === 'drag') scene.release();
      gesture.current = { kind: 'pinch', d: Math.hypot(a!.x - b!.x, a!.y - b!.y), k: scene.zoom };
      setDrop(null);
      return;
    }
    const el = (event.target as Element).closest<HTMLElement>('[data-node]');
    const id = el?.dataset.node;
    if (id) {
      const touch = event.pointerType !== 'mouse';
      const timer = touch
        ? window.setTimeout(() => {
            if (gesture.current?.kind === 'press' && gesture.current.id === id)
              startDrag(id, gesture.current.x, gesture.current.y);
          }, LONG_PRESS)
        : 0;
      gesture.current = { kind: 'press', id, x: at.x, y: at.y, touch, timer };
    } else gesture.current = { kind: 'pan', x: at.x, y: at.y, moved: false };
  }

  function onPointerMove(event: React.PointerEvent) {
    if (!pointers.current.has(event.pointerId)) return;
    const at = local(event);
    pointers.current.set(event.pointerId, at);
    const g = gesture.current;
    if (!g) return;
    if (g.kind === 'pinch') {
      const [a, b] = [...pointers.current.values()];
      if (!a || !b) return;
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      scene.zoomAt((g.k * d) / g.d, (a.x + b.x) / 2, (a.y + b.y) / 2);
      return;
    }
    if (g.kind === 'press') {
      if (Math.hypot(at.x - g.x, at.y - g.y) < MOVE) return;
      clearTimeout(g.timer);
      // Мышь тянет узел сразу; палец и перо до долгого нажатия двигают карту.
      if (!g.touch) startDrag(g.id, g.x, g.y);
      else gesture.current = { kind: 'pan', x: g.x, y: g.y, moved: true };
      onPointerMove(event);
      return;
    }
    if (g.kind === 'pan') {
      scene.panBy(at.x - g.x, at.y - g.y);
      gesture.current = {
        kind: 'pan',
        x: at.x,
        y: at.y,
        moved: g.moved || Math.hypot(at.x - g.x, at.y - g.y) > 1,
      };
      return;
    }
    const k = scene.zoom;
    scene.hold(g.ids, (at.x - g.x) / k, (at.y - g.y) / k);
    setDrop(target(at.x, at.y, g.ids));
  }

  function onPointerUp(event: React.PointerEvent) {
    if (!pointers.current.has(event.pointerId)) return;
    const at = local(event);
    pointers.current.delete(event.pointerId);
    const g = gesture.current;
    if (g?.kind === 'pinch') {
      if (pointers.current.size === 0) gesture.current = null;
      else {
        const [rest] = [...pointers.current.values()];
        gesture.current = { kind: 'pan', x: rest!.x, y: rest!.y, moved: true };
      }
      return;
    }
    gesture.current = null;
    if (!g) return;
    if (g.kind === 'press') {
      clearTimeout(g.timer);
      const now = performance.now();
      const node = findNode(tree, g.id);
      const twice = lastTap.current?.id === g.id && now - lastTap.current.t < 350;
      lastTap.current = { id: g.id, t: now };
      if (editing && editing.id !== g.id) finish(false);
      if (twice && node) {
        lastTap.current = null;
        if (node.link) openLink(node);
        else edit(g.id);
      } else select(g.id);
      canvas.current?.focus({ preventScroll: true });
      return;
    }
    if (g.kind === 'pan') {
      if (!g.moved && event.type === 'pointerup') {
        if (editing) finish(false);
        else setSelected(null);
      }
      return;
    }
    // Бросили ветку.
    setDrop(null);
    if (event.type === 'pointercancel') {
      // Жест прервала система или браузер — ветку не бросали: вернуть на место, модель не трогать.
      scene.release();
      return;
    }
    const onto = target(at.x, at.y, g.ids);
    const node = findNode(tree, g.id);
    try {
      if (onto && node) moveNode(doc, g.id, onto);
      else if (node?.depth === 1) {
        // В пустоту: ветка встаёт на ту сторону центра и на ту высоту, куда её бросили.
        const p = scene.world(at.x, at.y);
        const side: Side = p.x < 0 ? 'l' : 'r';
        const others = tree.children.filter((child) => child.id !== g.id);
        const anchor = others.find((child) => {
          const b = views.layout.boxes.get(child.id);
          return b?.side === side && b.y + b.h / 2 > p.y;
        });
        moveNode(doc, g.id, ROOT, anchor ? others.indexOf(anchor) : others.length, side);
      }
    } catch (error) {
      // Лимит текста карты: ветка возвращается на место, причина — сообщением.
      setProblem(error instanceof Error ? error.message : 'Перенести не вышло.');
    }
    scene.release();
  }

  const selectedNode = selected ? findNode(tree, selected) : null;
  const shown = useMemo(() => {
    const list = [...views.out.values()];
    for (const [id, view] of ghosts) if (!views.out.has(id)) list.push(view);
    return list;
  }, [views, ghosts]);

  const actions = (node: MindNode) => ({
    child: () => addKid(node.id),
    sibling: () => addNext(node.id),
    fold: () => toggleFold(node.id),
    remove: () => remove(node.id),
  });

  return (
    <div ref={stage} className="mm-stage">
      <div
        ref={canvas}
        className="mm-canvas"
        role="tree"
        tabIndex={0}
        aria-label={`Mind map «${title}»`}
        aria-activedescendant={selected ? `mm-${selected}` : undefined}
        onKeyDown={onKeyDown}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onContextMenu={(event) => {
          const id = (event.target as Element).closest<HTMLElement>('[data-node]')?.dataset.node;
          if (!id || !wide) return;
          event.preventDefault();
          select(id);
          requestAnimationFrame(() =>
            stage.current?.querySelector<HTMLButtonElement>('.mm-overlay .q-icon-btn')?.click(),
          );
        }}
        onDoubleClick={(event) => {
          const id = (event.target as Element).closest<HTMLElement>('[data-node]')?.dataset.node;
          const node = id ? findNode(tree, id) : null;
          if (!node) return;
          if (node.link) openLink(node);
          else edit(node.id);
        }}
      >
        <div
          ref={(el) => {
            scene.grid = el;
          }}
          className="mm-grid"
          aria-hidden="true"
        />
        <div
          ref={(el) => {
            scene.layer = el;
          }}
          className="mm-layer"
        >
          <svg className="mm-edges" aria-hidden="true">
            {shown
              .filter((view) => view.parent)
              .map((view) => (
                <path
                  key={view.node.id}
                  ref={(el) => scene.line(view.node.id, el)}
                  className={`mm-edge mm-tone-${view.node.tone}`}
                  strokeWidth={view.node.depth === 1 ? 3 : 2}
                />
              ))}
          </svg>
          {shown.map((view) => {
            const { node } = view;
            const isEditing = editing?.id === node.id;
            const empty = !node.text && !node.link;
            return (
              <div
                key={node.id}
                id={`mm-${node.id}`}
                ref={(el) => scene.node(node.id, el)}
                data-node={node.id}
                role="treeitem"
                aria-level={node.depth + 1}
                aria-selected={selected === node.id}
                aria-expanded={node.children.length ? !node.folded : undefined}
                aria-label={view.label}
                className={[
                  'mm-node',
                  `mm-d${Math.min(node.depth, 2)}`,
                  `mm-tone-${node.tone}`,
                  selected === node.id ? 'mm-selected' : '',
                  isEditing ? 'mm-editing' : '',
                  drop === node.id ? 'mm-drop' : '',
                  empty ? 'mm-empty' : '',
                ].join(' ')}
                style={{ width: view.size.w, minHeight: view.size.h }}
              >
                {node.depth === 1 && <span className="mm-dot" aria-hidden="true" />}
                {isEditing ? (
                  <NodeInput
                    node={node}
                    width={view.size.text}
                    placeholder={placeholder(node)}
                    onInput={(value) => setText(doc, node.id, value)}
                    onDone={() => finish(false)}
                    onCancel={() => finish(true)}
                    onChild={() => {
                      finish(false);
                      if (node.text.trim() || node.id === ROOT) addKid(node.id);
                    }}
                  />
                ) : node.link ? (
                  <span className="mm-link" style={{ width: view.size.text + 18 }}>
                    <span className="mm-at">@</span> {view.label}
                  </span>
                ) : (
                  <span className="mm-label" style={{ width: view.size.text }}>
                    {view.label}
                  </span>
                )}
                {view.fold > 0 && <span className="mm-fold">+{view.fold}</span>}
              </div>
            );
          })}
        </div>
      </div>
      {wide && (
        <div
          className="mm-overlay"
          ref={(el) => {
            if (el) scene.anchor(el, () => (editing ? null : selected));
          }}
        >
          {selectedNode && (
            <Menu
              label="Действия с узлом"
              align="start"
              variant="quiet"
              items={[
                { label: 'Дочерний узел', icon: 'plus', onPick: actions(selectedNode).child },
                {
                  label: 'Соседний узел',
                  icon: 'down',
                  onPick: actions(selectedNode).sibling,
                },
                ...(selectedNode.children.length
                  ? [
                      {
                        label: selectedNode.folded ? 'Развернуть ветку' : 'Свернуть ветку',
                        icon: (selectedNode.folded ? 'down' : 'up') as IconName,
                        onPick: actions(selectedNode).fold,
                      },
                    ]
                  : []),
                ...(selectedNode.depth > 0
                  ? [
                      {
                        label: 'Цвет ветки…',
                        icon: 'spark' as IconName,
                        onPick: () => setSheet('color'),
                      },
                    ]
                  : []),
                {
                  label: 'Ссылка на объект…',
                  icon: 'link' as IconName,
                  onPick: () => setSheet('link'),
                },
                ...(selectedNode.link
                  ? [
                      {
                        label: 'Открыть ссылку',
                        icon: 'link' as IconName,
                        onPick: () => openLink(selectedNode),
                      },
                    ]
                  : [
                      {
                        label: 'Править текст',
                        icon: 'edit' as IconName,
                        onPick: () => edit(selectedNode.id),
                      },
                    ]),
                ...(selectedNode.depth > 0
                  ? [
                      {
                        label: 'Удалить узел',
                        icon: 'trash' as IconName,
                        tone: 'bad' as const,
                        onPick: actions(selectedNode).remove,
                      },
                    ]
                  : []),
              ]}
            />
          )}
        </div>
      )}
      <Presence show={lostNodes.length > 0 || !!problem} className="mm-notice">
        {lostNodes.length > 0 ? (
          <Note>
            <p>
              На другом устройстве удалили узлы, в которых здесь были правки:{' '}
              {lostNodes.map((item) => `«${item.text}»`).join(', ')}. Вернуть?
            </p>
            <div className="mm-notice-actions">
              <Button
                size="sm"
                variant="fill"
                disabled={busy}
                onClick={() => void settleLost(true)}
              >
                Вернуть
              </Button>
              <Button
                size="sm"
                variant="quiet"
                disabled={busy}
                onClick={() => void settleLost(false)}
              >
                Не нужно
              </Button>
            </div>
          </Note>
        ) : (
          <Note tone="bad">
            <p>{problem}</p>
            <div className="mm-notice-actions">
              <Button size="sm" variant="quiet" onClick={() => setProblem(null)}>
                Понятно
              </Button>
            </div>
          </Note>
        )}
      </Presence>
      {wide && (
        <Presence show={!!editing} className="mm-keys">
          <span>
            <kbd>Enter</kbd> готово
          </span>
          <span>
            <kbd>Tab</kbd> вложить
          </span>
          <span>
            <kbd>Esc</kbd> отмена
          </span>
        </Presence>
      )}
      <Presence show={wide || !selectedNode || !!editing} className="mm-corner">
        {wide && (
          <>
            <IconButton
              icon="minus"
              label="Уменьшить"
              disabled={zoom <= MIN_ZOOM + 0.001}
              onClick={() => zoomBy(0.8)}
            />
            <span className="mm-zoom" aria-live="polite">
              {Math.round(zoom * 100)}%
            </span>
            <IconButton
              icon="plus"
              label="Увеличить"
              disabled={zoom >= MAX_ZOOM - 0.001}
              onClick={() => zoomBy(1.25)}
            />
          </>
        )}
        <IconButton icon="fit" label="Вся карта" onClick={() => fit()} />
      </Presence>
      {!wide && (
        <Presence show={!!selectedNode && !editing} className="mm-bar">
          {selectedNode && (
            <div className="mm-bar-in" role="toolbar" aria-label="Действия с узлом">
              <BarItem icon="plus" label="Ветка" onClick={actions(selectedNode).child} />
              <BarItem icon="down" label="Рядом" onClick={actions(selectedNode).sibling} />
              <BarItem
                label="Цвет"
                disabled={selectedNode.depth === 0}
                onClick={() => setSheet('color')}
                swatch={selectedNode.tone}
              />
              <BarItem
                icon={selectedNode.folded ? 'down' : 'up'}
                label={selectedNode.folded ? 'Развернуть' : 'Свернуть'}
                disabled={!selectedNode.children.length}
                onClick={actions(selectedNode).fold}
              />
              <BarItem icon="more" label="Ещё" onClick={() => setSheet('node')} />
            </div>
          )}
        </Presence>
      )}
      <Sheet
        open={sheet !== null && !!selectedNode}
        title={
          sheet === 'color'
            ? 'Цвет ветки'
            : sheet === 'link'
              ? 'Ссылка на объект'
              : `Ветка «${selectedNode ? nodeLabel(selectedNode, links) || placeholder(selectedNode) : ''}»`
        }
        onClose={() => setSheet(null)}
      >
        {selectedNode && sheet === 'link' && <LinkPicker onPick={link} />}
        {selectedNode && sheet !== 'link' && (
          <div className="mm-sheet">
            {sheet === 'node' && (
              <>
                <SheetRow
                  icon="plus"
                  label="Дочерний узел"
                  onClick={() => {
                    setSheet(null);
                    actions(selectedNode).child();
                  }}
                />
                <SheetRow
                  icon="down"
                  label="Соседний узел"
                  onClick={() => {
                    setSheet(null);
                    actions(selectedNode).sibling();
                  }}
                />
                {selectedNode.children.length > 0 && (
                  <SheetRow
                    icon={selectedNode.folded ? 'down' : 'up'}
                    label={selectedNode.folded ? 'Развернуть ветку' : 'Свернуть ветку'}
                    onClick={() => {
                      setSheet(null);
                      actions(selectedNode).fold();
                    }}
                  />
                )}
                <SheetRow icon="link" label="Ссылка на объект" onClick={() => setSheet('link')} />
                {selectedNode.link ? (
                  <SheetRow
                    icon="link"
                    label="Открыть ссылку"
                    onClick={() => {
                      setSheet(null);
                      openLink(selectedNode);
                    }}
                  />
                ) : (
                  <SheetRow
                    icon="edit"
                    label="Править текст"
                    onClick={() => {
                      setSheet(null);
                      edit(selectedNode.id);
                    }}
                  />
                )}
              </>
            )}
            {selectedNode.depth > 0 && (
              <div className="mm-colors" role="group" aria-label="Цвет ветки">
                {sheet === 'node' && <span className="mm-colors-label">Цвет ветки</span>}
                <div className="mm-swatches">
                  {BRANCH_COLORS.map((color) => (
                    <button
                      key={color}
                      type="button"
                      className={`mm-swatch mm-tone-${color}`}
                      aria-label={`Цвет: ${COLOR_NAMES[color]}`}
                      aria-pressed={selectedNode.tone === color}
                      onClick={() => {
                        setColor(doc, selectedNode.id, color);
                        if (sheet === 'color') setSheet(null);
                      }}
                    >
                      <span aria-hidden="true" />
                    </button>
                  ))}
                </div>
              </div>
            )}
            {sheet === 'node' && selectedNode.depth > 0 && (
              <SheetRow
                icon="trash"
                label="Удалить узел"
                bad
                onClick={() => {
                  setSheet(null);
                  actions(selectedNode).remove();
                }}
              />
            )}
          </div>
        )}
      </Sheet>
    </div>
  );
}

function NodeInput({
  node,
  width,
  placeholder,
  onInput,
  onDone,
  onCancel,
  onChild,
}: {
  node: MindNode;
  width: number;
  placeholder: string;
  onInput: (value: string) => void;
  onDone: () => void;
  onCancel: () => void;
  onChild: () => void;
}) {
  const input = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = input.current;
    if (!el) return;
    el.focus({ preventScroll: true });
    el.setSelectionRange(el.value.length, el.value.length);
  }, []);
  // Текст узла поменяли с другого устройства или вкладки, пока поле открыто: показываем его,
  // иначе следующее нажатие отправит старую строку целиком и сотрёт чужую правку.
  // Каретка остаётся на месте относительно своего текста.
  const composing = useRef(false);
  useEffect(() => {
    const el = input.current;
    if (!el || composing.current || el.value === node.text) return;
    const old = el.value;
    const next = node.text;
    let same = 0;
    while (same < old.length && same < next.length && old[same] === next[same]) same++;
    const shift = (at: number) => (at > same ? Math.max(same, at + next.length - old.length) : at);
    const start = shift(el.selectionStart);
    const end = shift(el.selectionEnd);
    el.value = next;
    if (document.activeElement === el) el.setSelectionRange(start, end);
  }, [node.text]);
  return (
    // Правка подписи прямо в узле, как в редакторе документа: общий Field здесь — лишняя рамка.
    <textarea
      ref={input}
      className="mm-input"
      aria-label="Текст узла"
      rows={1}
      maxLength={300}
      defaultValue={node.text}
      placeholder={placeholder}
      style={{ width }}
      onInput={(event) => onInput(event.currentTarget.value)}
      onCompositionStart={() => {
        composing.current = true;
      }}
      onCompositionEnd={(event) => {
        composing.current = false;
        onInput(event.currentTarget.value);
      }}
      onBlur={onDone}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
          event.preventDefault();
          onDone();
        } else if (event.key === 'Escape') {
          event.preventDefault();
          onCancel();
        } else if (event.key === 'Tab' && !event.shiftKey) {
          event.preventDefault();
          onChild();
        }
      }}
    />
  );
}

function BarItem({
  icon,
  label,
  onClick,
  disabled,
  swatch,
}: {
  icon?: IconName;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  swatch?: BranchColor;
}) {
  return (
    <Button
      variant="quiet"
      dot={false}
      className="mm-bar-item"
      disabled={disabled}
      onClick={onClick}
    >
      {swatch ? (
        <span className={`mm-bar-swatch mm-tone-${swatch}`} aria-hidden="true" />
      ) : (
        icon && <DotIcon name={icon} />
      )}
      <span>{label}</span>
    </Button>
  );
}

function SheetRow({
  icon,
  label,
  onClick,
  bad,
}: {
  icon: IconName;
  label: string;
  onClick: () => void;
  bad?: boolean;
}) {
  return (
    <Button
      variant="quiet"
      dot={false}
      className={`mm-sheet-row${bad ? ' mm-bad' : ''}`}
      onClick={onClick}
    >
      <DotIcon name={icon} />
      <span>{label}</span>
    </Button>
  );
}

const KIND_ICON: Record<DocLinkKind, IconName> = {
  'docs.page': 'docs',
  'planner.task': 'check',
  'planner.project': 'folder',
  'calendar.event': 'calendar',
};

/** Поиск цели ссылки — тот же API, что у @ в тексте документа (DOC-003). */
function LinkPicker({ onPick }: { onPick: (target: DocLinkTarget) => void }) {
  const [query, setQuery] = useState('');
  const [found, setFound] = useState<{ query: string; targets: DocLinkTarget[] } | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  // Модель отказывает, например, на 201-й разной ссылке — показываем причину здесь же.
  const [refused, setRefused] = useState<string | null>(null);
  const source = useMemo(() => httpLinkSource(), []);
  const q = query.trim();
  useEffect(() => {
    if (!q) return;
    const abort = new AbortController();
    const timer = window.setTimeout(() => {
      source
        .search(q, abort.signal)
        .then((targets) => {
          setFound({ query: q, targets });
          setFailed(null);
        })
        .catch(() => {
          if (!abort.signal.aborted) setFailed(q);
        });
    }, 150);
    return () => {
      clearTimeout(timer);
      abort.abort();
    };
  }, [q, source]);
  const targets = found && found.query === q ? found.targets : [];
  return (
    <div className="mm-sheet">
      <Field
        label="Дело, документ или событие"
        placeholder="Начните писать название"
        value={query}
        autoFocus
        onChange={(event) => setQuery(event.target.value)}
      />
      {failed === q && q && <Note tone="bad">Поиск недоступен. Проверьте сеть и повторите.</Note>}
      {found?.query === q && q && !targets.length && <Note>Ничего не найдено.</Note>}
      {refused && <Note tone="bad">{refused}</Note>}
      {targets.map((target) => (
        <SheetRow
          key={target.id}
          icon={KIND_ICON[target.type]}
          label={`${target.title || 'Без названия'} · ${LINK_LABELS[target.type]}`}
          onClick={() => {
            try {
              onPick(target);
            } catch (error) {
              setRefused(error instanceof Error ? error.message : 'Ссылку добавить не вышло.');
            }
          }}
        />
      ))}
    </div>
  );
}
