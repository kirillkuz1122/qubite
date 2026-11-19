/**
 * Движение карты без перерисовки React (§0.4): у каждого узла пружины x, y и «появления»,
 * у вида — сдвиг и масштаб. Кадр пишет только transform и opacity, линии пересчитываются
 * из текущих положений узлов в том же кадре.
 */
import { loop, MASS, type Spring } from '@qubite/motion';
import type { Box, Layout } from './layout';

interface Item {
  el: HTMLElement | null;
  x: Spring;
  y: Spring;
  a: Spring;
  box: Box;
  parent: string | null;
  gone: boolean;
  reported: boolean;
}

export const MIN_ZOOM = 0.25;
export const MAX_ZOOM = 2;
const clampZoom = (k: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, k));

export class Scene {
  readonly L = loop();
  private items = new Map<string, Item>();
  /** DOM узлов отдельно от пружин: React зовёт ref нового узла раньше, чем sync создаст его. */
  private els = new Map<string, HTMLElement>();
  private lines = new Map<string, SVGPathElement>();
  private anchors = new Map<HTMLElement, () => string | null>();
  private readonly paint: () => void;
  private first = true;
  readonly vx: Spring;
  readonly vy: Spring;
  readonly vk: Spring;
  layer: HTMLElement | null = null;
  grid: HTMLElement | null = null;
  /** Узел (и его ветка), который сейчас ведёт палец: пружины не тянут его к раскладке. */
  private held = new Set<string>();
  onGone: (id: string) => void = () => {};
  onZoom: (k: number) => void = () => {};

  constructor() {
    this.paint = this.L.render(() => this.draw());
    this.vx = this.spring(0, MASS.sheet);
    this.vy = this.spring(0, MASS.sheet);
    this.vk = this.spring(1, MASS.sheet);
  }

  private spring(x: number, mass: number = MASS.row): Spring {
    const s = this.L.spring(x, mass);
    s.onChange = this.paint;
    return s;
  }

  node(id: string, el: HTMLElement | null): void {
    if (el) this.els.set(id, el);
    else this.els.delete(id);
    const item = this.items.get(id);
    if (item) item.el = el;
    if (el) this.paint();
  }

  line(id: string, el: SVGPathElement | null): void {
    if (el) this.lines.set(id, el);
    else this.lines.delete(id);
    this.paint();
  }

  /** Элемент поверх холста, который следует за узлом (кнопка «Ещё» у выделенного). */
  anchor(el: HTMLElement | null, id: () => string | null): () => void {
    if (!el) return () => {};
    this.anchors.set(el, id);
    this.paint();
    return () => this.anchors.delete(el);
  }

  /** Новая раскладка: узлы едут к местам, новые выходят из родителя, ушедшие уходят в него. */
  sync(layout: Layout, parents: ReadonlyMap<string, string | null>): void {
    const instant = this.first;
    this.first = false;
    for (const box of layout.boxes.values()) {
      let item = this.items.get(box.id);
      const parent = parents.get(box.id) ?? null;
      if (!item) {
        const from = parent ? this.items.get(parent) : undefined;
        const sx = from ? from.x.x + from.box.w / 2 - box.w / 2 : box.x;
        const sy = from ? from.y.x + from.box.h / 2 - box.h / 2 : box.y;
        item = {
          el: this.els.get(box.id) ?? null,
          x: this.spring(instant ? box.x : sx),
          y: this.spring(instant ? box.y : sy),
          a: this.spring(instant ? 1 : 0),
          box,
          parent,
          gone: false,
          reported: false,
        };
        this.items.set(box.id, item);
      }
      item.box = box;
      item.parent = parent;
      item.gone = false;
      item.reported = false;
      if (!this.held.has(box.id)) {
        this.L.to(item.x, box.x);
        this.L.to(item.y, box.y);
      }
      this.L.to(item.a, 1);
    }
    for (const [id, item] of this.items) {
      if (layout.boxes.has(id) || item.gone) continue;
      item.gone = true;
      const to = item.parent ? layout.boxes.get(item.parent) : undefined;
      if (to) {
        this.L.to(item.x, to.x + to.w / 2 - item.box.w / 2);
        this.L.to(item.y, to.y + to.h / 2 - item.box.h / 2);
      }
      this.L.to(item.a, 0);
    }
    this.paint();
  }

  forget(id: string): void {
    this.items.delete(id);
  }

  /** Текущее (анимированное) положение узла в координатах карты. */
  position(id: string): { x: number; y: number; w: number; h: number } | null {
    const item = this.items.get(id);
    return item ? { x: item.x.x, y: item.y.x, w: item.box.w, h: item.box.h } : null;
  }

  /** Перетаскивание: ветка едет за пальцем на dx, dy от своих мест в раскладке. */
  hold(ids: readonly string[], dx: number, dy: number): void {
    for (const id of ids) {
      const item = this.items.get(id);
      if (!item) continue;
      this.held.add(id);
      this.L.hold(item.x, item.box.x + dx);
      this.L.hold(item.y, item.box.y + dy);
    }
  }

  release(): void {
    for (const id of this.held) {
      const item = this.items.get(id);
      if (!item) continue;
      this.L.to(item.x, item.box.x);
      this.L.to(item.y, item.box.y);
    }
    this.held.clear();
  }

  get zoom(): number {
    return this.vk.goal;
  }

  /** Сдвиг вида пальцем или колесом — сразу, без пружины. */
  panBy(dx: number, dy: number): void {
    this.L.hold(this.vx, this.vx.goal + dx);
    this.L.hold(this.vy, this.vy.goal + dy);
  }

  /** Масштаб вокруг точки экрана (px, py): точка под пальцем остаётся на месте. */
  zoomAt(k: number, px: number, py: number, animate = false): void {
    const next = clampZoom(k);
    const ratio = next / this.vk.goal;
    const x = px - (px - this.vx.goal) * ratio;
    const y = py - (py - this.vy.goal) * ratio;
    if (animate) {
      this.L.to(this.vk, next);
      this.L.to(this.vx, x);
      this.L.to(this.vy, y);
    } else {
      this.L.hold(this.vk, next);
      this.L.hold(this.vx, x);
      this.L.hold(this.vy, y);
    }
    this.onZoom(next);
  }

  /** Вид: точка карты (cx, cy) в точке экрана (px, py) при масштабе k. */
  look(cx: number, cy: number, k: number, px: number, py: number, animate = true): void {
    const next = clampZoom(k);
    const move = animate && !this.first ? this.L.to.bind(this.L) : this.L.set.bind(this.L);
    move(this.vk, next);
    move(this.vx, px - cx * next);
    move(this.vy, py - cy * next);
    this.onZoom(next);
  }

  /** Экран → карта. */
  world(px: number, py: number): { x: number; y: number } {
    return { x: (px - this.vx.goal) / this.vk.goal, y: (py - this.vy.goal) / this.vk.goal };
  }

  private draw(): void {
    const k = this.vk.x;
    if (this.layer)
      this.layer.style.transform = `translate(${this.vx.x}px, ${this.vy.x}px) scale(${k})`;
    if (this.grid) {
      const step = 24;
      const mod = (v: number) => ((v % step) + step) % step;
      this.grid.style.transform = `translate(${mod(this.vx.x) - step}px, ${mod(this.vy.x) - step}px)`;
    }
    for (const [id, item] of this.items) {
      const a = Math.max(0, Math.min(1, item.a.x));
      if (item.el) {
        item.el.style.transform = `translate(${item.x.x}px, ${item.y.x}px) scale(${0.6 + 0.4 * a})`;
        item.el.style.opacity = String(a);
      }
      if (item.gone && !item.reported && a < 0.02 && item.a.goal === 0) {
        item.reported = true;
        queueMicrotask(() => this.onGone(id));
      }
    }
    for (const [id, path] of this.lines) {
      const child = this.items.get(id);
      const parent = child?.parent ? this.items.get(child.parent) : undefined;
      if (!child || !parent) continue;
      const right = child.box.side !== 'l';
      const x0 = right ? parent.x.x + parent.box.w : parent.x.x;
      const y0 = parent.y.x + parent.box.h / 2;
      const x1 = right ? child.x.x : child.x.x + child.box.w;
      const y1 = child.y.x + child.box.h / 2;
      const mx = (x0 + x1) / 2;
      const f = (v: number) => v.toFixed(1);
      path.setAttribute(
        'd',
        `M ${f(x0)} ${f(y0)} C ${f(mx)} ${f(y0)} ${f(mx)} ${f(y1)} ${f(x1)} ${f(y1)}`,
      );
      path.style.opacity = String(Math.max(0, Math.min(1, child.a.x)));
    }
    for (const [el, which] of this.anchors) {
      const id = which();
      const item = id ? this.items.get(id) : undefined;
      if (!item || item.gone) {
        el.style.opacity = '0';
        continue;
      }
      const sx = this.vx.x + (item.x.x + item.box.w) * k;
      const sy = this.vy.x + (item.y.x + item.box.h / 2) * k;
      el.style.opacity = '1';
      el.style.transform = `translate(${sx + 8}px, ${sy}px) translateY(-50%)`;
    }
  }
}
