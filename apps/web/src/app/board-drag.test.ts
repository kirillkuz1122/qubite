import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { edgeScrollSpeed, startBoardDrag } from './board-drag';

describe('жест переноса карточки', () => {
  let board: HTMLElement;
  let card: HTMLElement;
  let cancel: (() => void) | undefined;
  const onDrop = vi.fn();
  const onEnd = vi.fn();

  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(window, 'requestAnimationFrame').mockReturnValue(1);
    board = document.body.appendChild(document.createElement('div'));
    card = board.appendChild(document.createElement('div'));
  });

  afterEach(() => {
    cancel?.();
    board.remove();
    vi.restoreAllMocks();
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  function start(pointerType = 'touch') {
    cancel = startBoardDrag({ pointerId: 1, pointerType, clientX: 20, clientY: 100 }, card, board, {
      onOver: vi.fn(),
      onDrop,
      onEnd,
    });
  }

  function moveBy(dx: number, dy: number) {
    window.dispatchEvent(
      new PointerEvent('pointermove', { pointerId: 1, clientX: 20 + dx, clientY: 100 + dy }),
    );
  }

  it.each(['touch', 'pen'])('%s: начинает перенос через 350 мс при сдвиге до 8 px', (type) => {
    start(type);
    moveBy(0, 8);
    vi.advanceTimersByTime(349);
    expect(card).not.toHaveClass('dragging');
    vi.advanceTimersByTime(1);
    expect(card).toHaveClass('dragging');
  });

  it('сдвиг больше 8 px отменяет ожидание переноса', () => {
    start();
    moveBy(0, 9);
    vi.advanceTimersByTime(350);
    expect(onEnd).toHaveBeenCalledOnce();
    expect(onDrop).not.toHaveBeenCalled();
    expect(card).not.toHaveClass('dragging');
  });

  it('перехватывает touchmove только во время переноса и отпускает после отмены', () => {
    const touchMove = () => window.dispatchEvent(new Event('touchmove', { cancelable: true }));
    start();
    expect(touchMove()).toBe(true);
    vi.advanceTimersByTime(350);
    expect(touchMove()).toBe(false);
    window.dispatchEvent(new PointerEvent('pointercancel', { pointerId: 1 }));
    expect(touchMove()).toBe(true);
    expect(card).not.toHaveClass('dragging');
    expect(onDrop).not.toHaveBeenCalled();
  });

  it('мышь начинает перенос при сдвиге от 6 px', () => {
    start('mouse');
    moveBy(0, 5);
    vi.advanceTimersByTime(350);
    expect(card).not.toHaveClass('dragging');
    moveBy(0, 6);
    expect(card).toHaveClass('dragging');
  });
});

describe('скорость автопрокрутки', () => {
  it.each([
    [80, -18],
    [100, -18],
    [136, -9],
    [172, 0],
    [400, 0],
    [628, 0],
    [664, 9],
    [700, 18],
    [720, 18],
  ])('для y=%i даёт %i px/кадр', (y, speed) => {
    expect(edgeScrollSpeed(y, 100, 700)).toBe(speed);
  });
});
