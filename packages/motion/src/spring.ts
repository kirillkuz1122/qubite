/**
 * Одна физика на весь интерфейс Qubite (D-142): любое движение — пружина из одного «материала».
 * Жёсткость и вязкость общие, отличается только масса: крупное (помощники, листы) тяжелее и мягче,
 * мелкое (кнопки, точки) легче и собраннее.
 */
export const MATERIAL = { stiffness: 220, damping: 20 } as const;

/** Массы, которые используют компоненты. Новое движение подбирай из них, а не придумывай своё. */
export const MASS = {
  /** точка, кнопка под пальцем */
  dot: 0.55,
  /** подсветка выбранного, ручка переключателя */
  pill: 0.8,
  /** строка списка, текст шага, экран */
  row: 1,
  /** меню, лист, страница документа */
  sheet: 1.2,
  /** помощник */
  companion: 2.1,
} as const;

/** Насколько близко к цели и насколько медленно — и пружина считается остановившейся. */
const REST = 0.003;

export type SpringListener = (x: number, v: number) => void;

export class Spring {
  x: number;
  v = 0;
  goal: number;
  m: number;
  onChange: SpringListener | null;

  constructor(x: number, mass = 1, onChange: SpringListener | null = null) {
    this.x = x;
    this.goal = x;
    this.m = mass;
    this.onChange = onChange;
  }

  /** Один шаг интегрирования (полуявный Эйлер). Шаг маленький — за это отвечает цикл. */
  step(h: number): void {
    const a = (-MATERIAL.stiffness * (this.x - this.goal) - MATERIAL.damping * this.v) / this.m;
    this.v += a * h;
    this.x += this.v * h;
  }

  /** Остановилась ли пружина; если да — ставим ровно в цель, чтобы не дрожала на последних долях. */
  settle(): boolean {
    if (Math.abs(this.v) < REST && Math.abs(this.x - this.goal) < REST) {
      this.x = this.goal;
      this.v = 0;
      return true;
    }
    return false;
  }

  emit(): void {
    this.onChange?.(this.x, this.v);
  }
}
