import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installViewportVars } from './viewport';

describe('installViewportVars', () => {
  const style = document.documentElement.style;
  let viewport: EventTarget & { height: number; offsetTop: number };
  let uninstall: () => void;

  beforeEach(() => {
    vi.useFakeTimers();
    viewport = Object.assign(new EventTarget(), { height: 800, offsetTop: 0 });
    vi.stubGlobal('visualViewport', viewport);
    vi.stubGlobal('innerHeight', 800);
    uninstall = installViewportVars();
    vi.advanceTimersToNextFrame();
  });

  afterEach(() => {
    uninstall();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('выставляет высоту при открытии клавиатуры и снимает переменные при закрытии', () => {
    viewport.height = 480;
    viewport.offsetTop = 20;
    viewport.dispatchEvent(new Event('resize'));
    expect(style.getPropertyValue('--app-vh')).toBe('');
    vi.advanceTimersToNextFrame();
    expect(style.getPropertyValue('--app-kb')).toBe('300px');
    expect(style.getPropertyValue('--app-vh')).toBe('480px');

    viewport.height = 480.5;
    viewport.dispatchEvent(new Event('resize'));
    vi.advanceTimersToNextFrame();
    expect(style.getPropertyValue('--app-kb')).toBe('300px');
    expect(style.getPropertyValue('--app-vh')).toBe('480px');

    viewport.height = 800;
    viewport.offsetTop = 0;
    viewport.dispatchEvent(new Event('scroll'));
    vi.advanceTimersToNextFrame();
    expect(style.getPropertyValue('--app-kb')).toBe('');
    expect(style.getPropertyValue('--app-vh')).toBe('');
  });

  it('оставляет dvh управлять высотой при движении строки браузера', () => {
    viewport.height = 744;
    viewport.dispatchEvent(new Event('resize'));
    vi.advanceTimersToNextFrame();
    expect(style.getPropertyValue('--app-kb')).toBe('56px');
    expect(style.getPropertyValue('--app-vh')).toBe('');

    viewport.height = 743.5;
    viewport.dispatchEvent(new Event('scroll'));
    vi.advanceTimersToNextFrame();
    expect(style.getPropertyValue('--app-kb')).toBe('56px');
    expect(style.getPropertyValue('--app-vh')).toBe('');
  });

  it('прокручивает к полю один раз после двух кадров со стабильной высотой клавиатуры', () => {
    const input = document.createElement('textarea');
    const scrollIntoView = vi.fn();
    input.scrollIntoView = scrollIntoView;
    document.body.append(input);
    try {
      input.focus();
      viewport.height = 520;
      viewport.dispatchEvent(new Event('resize'));
      vi.advanceTimersToNextFrame();
      vi.advanceTimersToNextFrame();
      expect(scrollIntoView).not.toHaveBeenCalled();

      viewport.height = 480;
      viewport.dispatchEvent(new Event('resize'));
      vi.advanceTimersToNextFrame();
      vi.advanceTimersToNextFrame();
      expect(scrollIntoView).not.toHaveBeenCalled();

      vi.advanceTimersToNextFrame();
      expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest' });
      viewport.dispatchEvent(new Event('scroll'));
      vi.advanceTimersToNextFrame();
      expect(scrollIntoView).toHaveBeenCalledTimes(1);
    } finally {
      input.remove();
    }
  });

  it('iPhone: видимая область сдвинута вниз — обёртка листа едет на offsetTop', () => {
    viewport.height = 460;
    viewport.offsetTop = 120; // окно 800: клавиатура 220
    viewport.dispatchEvent(new Event('resize'));
    vi.advanceTimersToNextFrame();
    expect(style.getPropertyValue('--app-vh')).toBe('460px');
    expect(style.getPropertyValue('--app-vt')).toBe('120px');

    viewport.height = 800;
    viewport.offsetTop = 0;
    viewport.dispatchEvent(new Event('resize'));
    vi.advanceTimersToNextFrame();
    expect(style.getPropertyValue('--app-vt')).toBe('');
  });
});
