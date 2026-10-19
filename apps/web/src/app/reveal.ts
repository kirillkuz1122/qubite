import { loop } from '@qubite/motion';
import type { SectionId } from './data';

/**
 * Показать найденное из Command: дождаться, пока раздел откроется, прокрутить к объекту
 * и мягко обвести его. `open` — сразу открыть (документ раскрывается в страницу).
 */
export function reveal(screen: SectionId, obj: string, open = false) {
  const until = performance.now() + 2500;
  const sel = `.screen[data-screen="${screen}"] [data-obj="${CSS.escape(obj)}"]`;
  const step = () => {
    const el = document.querySelector<HTMLElement>(sel);
    if (!el) {
      if (performance.now() < until) requestAnimationFrame(step);
      return;
    }
    el.scrollIntoView({ block: 'center', behavior: loop().reduced ? 'auto' : 'smooth' });
    el.removeAttribute('data-found');
    void el.offsetWidth; // обводка заново, даже если тот же объект нашли второй раз
    el.setAttribute('data-found', '');
    setTimeout(() => el.removeAttribute('data-found'), 1900);
    if (open) el.click();
  };
  requestAnimationFrame(step);
}
