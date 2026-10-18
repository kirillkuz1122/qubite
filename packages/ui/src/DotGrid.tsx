import { useLook } from './look';

/** Сетка точек той же формы, что и всё остальное: рисунок фона одной клетки. */
export function gridImage(
  pitch: number,
  half: number,
  round: number,
  color: string,
  alpha: number,
) {
  const c = half * round;
  const svg =
    `<svg xmlns='http://www.w3.org/2000/svg' width='${pitch}' height='${pitch}'>` +
    `<rect x='${pitch / 2 - half}' y='${pitch / 2 - half}' width='${2 * half}' height='${2 * half}' rx='${c}' fill='${color}' fill-opacity='${alpha}'/></svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

/** Фоновая сетка точек на весь экран: шаг 14, форма и размер — из настроек вида. */
export function DotGrid({ pitch = 14, half = 1.2 }: { pitch?: number; half?: number }) {
  const { look, theme, palette } = useLook();
  const alpha = theme === 'light' ? 0.1 : 0.085;
  return (
    <div
      className="q-grid"
      aria-hidden="true"
      style={{
        backgroundImage: gridImage(
          pitch,
          half * (look.size / 100),
          look.round / 100,
          palette.ink,
          alpha,
        ),
      }}
    />
  );
}
