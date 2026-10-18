import { useEffect, useRef } from 'react';
import { DotEngine, type TextGroup } from './dots/engine';
import { PIXEL_FONT, textCells } from './dots/text';
import { useLook } from './look';
import type { ColorName } from './tokens';

export interface DotTextProps {
  /** надпись заглавными: Tiny5 раскладывается в точки */
  text: string;
  /** шаг точки, px */
  pitch: number;
  color?: ColorName;
  /** при появлении точки слетаются из облака */
  assemble?: boolean;
  /** радиус, в котором точки убегают от пальца */
  repel?: number;
  /** подпись для чтения с экрана (по умолчанию — сам текст) */
  label?: string;
  className?: string;
}

/**
 * Надпись из точек. Когда меняется text, те же точки разлетаются и собираются в новое слово.
 * Смену темы холст ловит сам (общая перекраска холстов).
 */
export function DotText({
  text,
  pitch,
  color = 'ink',
  assemble = true,
  repel = 40,
  label,
  className,
}: DotTextProps) {
  const ref = useRef<HTMLCanvasElement>(null);
  const { palette } = useLook();
  const start = useRef({ color: palette[color], ground: palette.bg, ink: palette.ink });
  /** последняя заказанная надпись: холст может появиться позже, когда загрузится шрифт */
  const want = useRef(text);
  const live = useRef<{ e: DotEngine; g: TextGroup; text: string } | null>(null);

  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    let cancelled = false;
    let engine: DotEngine | null = null;
    /* буквы раскладываются по пикселям шрифта, поэтому ждём Tiny5 — иначе получится каша из запасного шрифта */
    whenPixelFont(want.current).then(() => {
      if (cancelled) return;
      const s = start.current;
      const t = want.current;
      fit(cv, t, pitch);
      engine = new DotEngine(cv, { ground: s.ground, light: s.ink, repel });
      const g = engine.text(t, { x: 4, y: 4, pitch, color: s.color, assemble, r: 0.46 });
      live.current = { e: engine, g, text: t };
    });
    return () => {
      cancelled = true;
      engine?.destroy();
      live.current = null;
    };
  }, [pitch, repel, assemble]);

  useEffect(() => {
    want.current = text;
    const cur = live.current;
    if (!cur || cur.text === text) return;
    whenPixelFont(text).then(() => {
      if (live.current !== cur || want.current !== text) return;
      const cv = ref.current;
      if (cv && fit(cv, text, pitch, true)) cur.e.resize();
      cur.e.morph(cur.g, text, { r: 0.46 });
      cur.text = text;
    });
  }, [text, pitch]);

  return <canvas ref={ref} className={className} role="img" aria-label={label ?? text} />;
}

/** Размер холста под надпись; grow — только расширять (чтобы слово не обрезалось при перестройке). */
function fit(cv: HTMLCanvasElement, text: string, pitch: number, grow = false): boolean {
  const tc = textCells(text);
  const w = Math.ceil(tc.cols * pitch + 8);
  const h = Math.ceil(Math.max(tc.rows, 5) * pitch + 8);
  const cur = cv.getBoundingClientRect().width;
  if (grow && w <= cur) return false;
  cv.style.width = `${w}px`;
  cv.style.height = `${h}px`;
  return true;
}

/** Дождаться пиксельного шрифта для этих букв (в тестах без document.fonts — сразу). */
function whenPixelFont(text: string): Promise<unknown> {
  if (typeof document === 'undefined' || !document.fonts) return Promise.resolve();
  return document.fonts.load(`32px '${PIXEL_FONT}'`, text).catch(() => undefined);
}
