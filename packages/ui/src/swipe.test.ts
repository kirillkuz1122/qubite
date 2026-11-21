import { afterEach, describe, expect, it, vi } from 'vitest';
import { swipe, swipeAxis } from './swipe';

let dispose: (() => void) | undefined;

afterEach(() => {
  dispose?.();
  document.body.replaceChildren();
  window.getSelection()?.removeAllRanges();
});

function setup() {
  const root = document.createElement('div');
  document.body.append(root);
  const handlers = { onStart: vi.fn(), onMove: vi.fn(), onEnd: vi.fn(), onCancel: vi.fn() };
  dispose = swipe(root, { axis: 'y', direction: 1, ...handlers });
  return { root, ...handlers };
}

function pointer(
  target: EventTarget,
  type: string,
  x: number,
  y: number,
  time: number,
  pointerType = 'touch',
) {
  const event = new PointerEvent(type, {
    bubbles: true,
    cancelable: true,
    pointerType,
    pointerId: 1,
    isPrimary: true,
    clientX: x,
    clientY: y,
  });
  Object.defineProperty(event, 'timeStamp', { value: time });
  target.dispatchEvent(event);
}

describe('swipe', () => {
  it('фиксирует ось после 10 px и отклоняет угол больше 30°', () => {
    expect(swipeAxis(0, 9)).toBe('pending');
    expect(swipeAxis(20, 11)).toBe('x');
    expect(swipeAxis(20, 12)).toBe('diagonal');
    expect(swipeAxis(11, -20)).toBe('y');
  });

  it('ведёт касание и перо, включая возврат пальца', () => {
    const { root, onStart, onMove, onEnd } = setup();
    for (const kind of ['touch', 'pen']) {
      pointer(root, 'pointerdown', 30, 100, 0, kind);
      pointer(root, 'pointermove', 30, 109, 10, kind);
      pointer(root, 'pointermove', 30, 145, 20, kind);
      pointer(root, 'pointermove', 30, 104, 130, kind);
      pointer(root, 'pointerup', 30, 103, 135, kind);
    }
    expect(onStart).toHaveBeenCalledTimes(2);
    expect(onMove.mock.calls).toEqual([[45], [4], [45], [4]]);
    expect(onEnd.mock.calls).toEqual([[3, -200], [3, -200]]);
  });

  it('отдаёт движение прокручиваемому предку до его верхней границы', () => {
    const { root, onStart } = setup();
    root.style.overflowY = 'auto';
    Object.defineProperties(root, {
      scrollHeight: { value: 500 },
      clientHeight: { value: 100 },
    });
    const child = root.appendChild(document.createElement('p'));
    root.scrollTop = 30;
    pointer(child, 'pointerdown', 30, 100, 0);
    pointer(child, 'pointermove', 30, 120, 20);
    pointer(child, 'pointerup', 30, 120, 40);
    expect(onStart).not.toHaveBeenCalled();
    root.scrollTop = 0;
    pointer(child, 'pointerdown', 30, 100, 50);
    pointer(child, 'pointermove', 30, 120, 70);
    expect(onStart).toHaveBeenCalledOnce();
  });

  it('пропускает мышь, начало в поле ввода, выделенный текст и движение поперёк', () => {
    const { root, onStart } = setup();
    const input = root.appendChild(document.createElement('input'));
    const p = root.appendChild(document.createElement('p'));
    p.textContent = 'Выделенный текст';
    window.getSelection()?.selectAllChildren(p);
    pointer(p, 'pointerdown', 30, 100, 0);
    pointer(p, 'pointermove', 30, 150, 20);
    window.getSelection()?.removeAllRanges();
    pointer(root, 'pointerdown', 30, 100, 40, 'mouse');
    pointer(root, 'pointermove', 30, 150, 60, 'mouse');
    pointer(input, 'pointerdown', 30, 100, 80);
    pointer(input, 'pointermove', 30, 150, 100);
    pointer(root, 'pointerdown', 30, 100, 120);
    pointer(root, 'pointermove', 80, 120, 140);
    pointer(root, 'pointermove', 30, 170, 160);
    expect(onStart).not.toHaveBeenCalled();
  });

  it('отменяет захваченный жест при pointercancel', () => {
    const { root, onCancel, onEnd } = setup();
    pointer(root, 'pointerdown', 30, 100, 0);
    pointer(root, 'pointermove', 30, 130, 20);
    pointer(root, 'pointercancel', 30, 130, 40);
    pointer(root, 'pointerup', 30, 150, 60);
    expect(onCancel).toHaveBeenCalledOnce();
    expect(onEnd).not.toHaveBeenCalled();
  });
});
