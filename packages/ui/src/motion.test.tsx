import { loop } from '@qubite/motion';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Button } from './Button';
import { DEFAULT_FEEL, FEELS, feelOf } from './feel';
import { LookProvider, LOOK_STORE, useLook } from './look';
import { Range } from './Range';

/** Событие указателя в jsdom: тип pointer*, координаты как у мыши. */
const ptr = (el: Element, type: string, x: number, y = 0) =>
  fireEvent(el, new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y }));

let frameTime = 0;
const frame = () => act(() => loop().frame((frameTime += 16)));

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe('кнопка: нажатие и его отмена', () => {
  it.each([
    { disabled: true },
    { 'aria-disabled': true } as const,
    { 'aria-disabled': 'true' } as const,
  ])('недоступная кнопка не нажимается и не двигается: %j', (props) => {
    const onClick = vi.fn();
    const onClickCapture = vi.fn();
    render(
      <Button {...props} onClick={onClick} onClickCapture={onClickCapture}>
        Начать
      </Button>,
    );
    const b = screen.getByRole('button', { name: 'Начать' });
    ptr(b, 'pointerdown', 10);
    ptr(b, 'pointermove', 30);
    frame();
    expect(b.style.transform).toBe('');
    ptr(b, 'pointerup', 30);
    fireEvent.click(b, { detail: 1 });
    fireEvent.click(b, { detail: 0 });
    frame();
    expect(onClick).not.toHaveBeenCalled();
    expect(onClickCapture).not.toHaveBeenCalled();
    expect(b.style.transform).toBe('');
  });

  it.each(['disabled', 'aria-disabled'] as const)(
    '%s посреди жеста сбрасывает движение; после включения кнопка снова работает',
    (kind) => {
      const onClick = vi.fn();
      const { rerender } = render(<Button onClick={onClick}>Начать</Button>);
      const b = screen.getByRole('button', { name: 'Начать' });
      ptr(b, 'pointerdown', 10);
      ptr(b, 'pointermove', 30);
      frame();
      expect(b.style.transform).not.toBe('');
      const props = kind === 'disabled' ? { disabled: true } : { 'aria-disabled': true as const };
      rerender(
        <Button {...props} onClick={onClick}>
          Начать
        </Button>,
      );
      expect(b.style.transform).toBe('');
      ptr(b, 'pointerup', 30);
      fireEvent.click(b);
      frame();
      expect(b.style.transform).toBe('');
      expect(onClick).not.toHaveBeenCalled();
      rerender(<Button onClick={onClick}>Начать</Button>);
      ptr(b, 'pointerdown', 10);
      ptr(b, 'pointerup', 10);
      fireEvent.click(b, { detail: 1 });
      expect(onClick).toHaveBeenCalledTimes(1);
    },
  );

  it('обычное нажатие доходит до onClick', () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Начать</Button>);
    const b = screen.getByRole('button', { name: 'Начать' });
    ptr(b, 'pointerdown', 10);
    ptr(b, 'pointerup', 10);
    fireEvent.click(b, { detail: 1 });
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('увёл палец далеко — щелчка нет', () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Начать</Button>);
    const b = screen.getByRole('button', { name: 'Начать' });
    ptr(b, 'pointerdown', 10);
    ptr(b, 'pointermove', 60);
    ptr(b, 'pointermove', 200);
    ptr(b, 'pointerup', 200);
    fireEvent.click(b, { detail: 1 });
    expect(onClick).not.toHaveBeenCalled();
    // следующее нажатие снова работает
    ptr(b, 'pointerdown', 10);
    ptr(b, 'pointerup', 10);
    fireEvent.click(b, { detail: 1 });
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('Escape посреди жеста отменяет нажатие', () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Начать</Button>);
    const b = screen.getByRole('button', { name: 'Начать' });
    ptr(b, 'pointerdown', 10);
    ptr(b, 'pointermove', 20);
    fireEvent.keyDown(window, { key: 'Escape' });
    ptr(b, 'pointerup', 20);
    fireEvent.click(b, { detail: 1 });
    expect(onClick).not.toHaveBeenCalled();
  });

  it('с клавиатуры (detail = 0) нажатие работает всегда', () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Начать</Button>);
    fireEvent.click(screen.getByRole('button', { name: 'Начать' }), { detail: 0 });
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});

function FeelDemo() {
  const { look, set } = useLook();
  return (
    <>
      <button onClick={() => set('feel', { ...look.feel, button: 'tight' })}>собранный</button>
      <button onClick={() => set('tempo', 60)}>спокойнее</button>
      <button onClick={() => set('motion', 'less')}>меньше</button>
      <button onClick={() => set('lite', true)}>легче</button>
    </>
  );
}

describe('ощущения', () => {
  it('по умолчанию — выбор владельца «Пружинистый»; «Живой» совпадает с прежними массами', () => {
    expect(DEFAULT_FEEL).toEqual({
      button: 'bouncy',
      flow: 'bouncy',
      switch: 'bouncy',
      range: 'bouncy',
    });
    expect(FEELS.flow.live.mass * 0.625).toBeCloseTo(0.5);
    expect(FEELS.flow.live.mass * 1.375).toBeCloseTo(1.1);
    expect(FEELS.button.live).toEqual({ mass: 0.6, damping: 20 });
  });

  it('характер, живость, облегчённый режим и «меньше движения» попадают в цикл и запоминаются', () => {
    render(
      <LookProvider>
        <FeelDemo />
      </LookProvider>,
    );
    act(() => screen.getByText('собранный').click());
    act(() => screen.getByText('спокойнее').click());
    act(() => screen.getByText('меньше').click());
    act(() => screen.getByText('легче').click());
    expect(feelOf('button')).toEqual(FEELS.button.tight);
    const L = loop();
    expect(L.tempo).toBeCloseTo(0.6);
    expect(L.reduced).toBe(true);
    expect(L.lite).toBe(true);
    expect(document.documentElement.dataset.motion).toBe('less');
    expect(document.documentElement.dataset.lite).toBe('');
    const saved = JSON.parse(localStorage.getItem(LOOK_STORE) ?? '{}');
    expect(saved).toMatchObject({
      tempo: 60,
      motion: 'less',
      lite: true,
      feel: { button: 'tight' },
    });
  });

  it('старое сохранение без новых полей открывается со значениями по умолчанию', () => {
    localStorage.setItem(LOOK_STORE, JSON.stringify({ theme: 'light', round: 20, size: 90 }));
    render(
      <LookProvider>
        <FeelDemo />
      </LookProvider>,
    );
    const L = loop();
    expect(L.tempo).toBe(1);
    expect(L.lite).toBe(false);
    expect(feelOf('switch')).toEqual(FEELS.switch.bouncy);
  });
});

describe('ползунок', () => {
  it('остаётся настоящим ползунком: значение и клавиатура', () => {
    function Demo() {
      const [v, setV] = useState(40);
      return <Range label="Живость" value={v} min={50} max={150} onChange={setV} />;
    }
    render(<Demo />);
    const s = screen.getByRole('slider', { name: 'Живость' });
    fireEvent.change(s, { target: { value: '120' } });
    expect(s).toHaveValue('120');
    expect(screen.getByText('120%')).toBeInTheDocument();
  });
});
