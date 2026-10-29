import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { playCue, readFeedback, writeFeedback } from './english-feedback';

const KEY = 'qubite.english.feedback';

beforeEach(() => {
  const saved = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => saved.get(key) ?? null,
    setItem: (key: string, value: string) => saved.set(key, value),
    removeItem: (key: string) => saved.delete(key),
  });
  vi.stubGlobal('AudioContext', undefined);
  vi.stubGlobal('navigator', {});
  writeFeedback({ sound: true, haptics: true });
  localStorage.removeItem(KEY);
});

afterEach(() => vi.unstubAllGlobals());

function fakeAudio() {
  const oscillator = {
    type: '',
    frequency: { setValueAtTime: vi.fn() },
    connect: vi.fn(),
    disconnect: vi.fn(),
    start: vi.fn(),
    stop: vi.fn(),
    onended: null as (() => void) | null,
  };
  const gain = {
    gain: { setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn() },
    connect: vi.fn(),
    disconnect: vi.fn(),
  };
  const context = {
    state: 'running',
    currentTime: 10,
    destination: {},
    createOscillator: () => oscillator,
    createGain: () => gain,
    resume: vi.fn(async () => {}),
    close: vi.fn(async () => {}),
  };
  const Audio = vi.fn(function () {
    return context;
  });
  vi.stubGlobal('AudioContext', Audio);
  return { Audio, context, oscillator, gain };
}

describe('настройки сигналов английского', () => {
  it('по умолчанию включены, сохраняются под общим ключом и читаются заново', () => {
    expect(readFeedback()).toEqual({ sound: true, haptics: true });
    writeFeedback({ sound: false, haptics: true });
    expect(JSON.parse(localStorage.getItem(KEY)!)).toEqual({ sound: false, haptics: true });
    expect(readFeedback()).toEqual({ sound: false, haptics: true });
    localStorage.setItem(KEY, JSON.stringify({ sound: true, haptics: false }));
    expect(readFeedback()).toEqual({ sound: true, haptics: false });
  });

  it('повреждённое или неполное значение не ломает урок', () => {
    for (const saved of ['broken', 'null', '42', '{}', '{"sound":"false"}']) {
      localStorage.setItem(KEY, saved);
      expect(readFeedback()).toEqual({ sound: true, haptics: true });
    }
    localStorage.setItem(KEY, '{"sound":false}');
    expect(readFeedback()).toEqual({ sound: false, haptics: true });
  });

  it('при недоступном хранилище настройки работают в памяти', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    });
    expect(() => writeFeedback({ sound: false, haptics: false })).not.toThrow();
    expect(readFeedback()).toEqual({ sound: false, haptics: false });
    expect(() => playCue('bad')).not.toThrow();
  });
});

describe('сигнал верного и неверного ответа', () => {
  it('без браузерных API ничего не бросает', () => {
    vi.stubGlobal('navigator', undefined);
    vi.stubGlobal('localStorage', undefined);
    expect(() => playCue('ok')).not.toThrow();
    expect(() => playCue('bad')).not.toThrow();
  });

  it('вибрация: 15 мс на успех и короткий рисунок на ошибку', () => {
    const vibrate = vi.fn();
    vi.stubGlobal('navigator', { vibrate });
    playCue('ok');
    playCue('bad');
    expect(vibrate.mock.calls).toEqual([[15], [[20, 40, 20]]]);
  });

  it.each(['ok', 'bad'] as const)('тон %s: тихий, короткий, с закрытием', (cue) => {
    const { context, oscillator, gain } = fakeAudio();
    playCue(cue);
    expect(oscillator.frequency.setValueAtTime).toHaveBeenCalledWith(cue === 'ok' ? 740 : 220, 10);
    expect(oscillator.start).toHaveBeenCalledWith(10);
    expect(oscillator.stop).toHaveBeenCalledWith(10.12);
    expect(gain.gain.setValueAtTime).toHaveBeenCalledWith(0, 10);
    expect(gain.gain.linearRampToValueAtTime.mock.calls).toEqual([
      [0.05, 10.008],
      [0, 10.11],
    ]);
    oscillator.onended?.();
    expect(context.close).toHaveBeenCalledOnce();
  });

  it('звук и вибрация выключаются независимо', () => {
    const { Audio, oscillator } = fakeAudio();
    const vibrate = vi.fn();
    vi.stubGlobal('navigator', { vibrate });
    writeFeedback({ sound: false, haptics: true });
    playCue('ok');
    expect(Audio).not.toHaveBeenCalled();
    expect(vibrate).toHaveBeenCalledOnce();
    writeFeedback({ sound: true, haptics: false });
    playCue('bad');
    expect(Audio).toHaveBeenCalledOnce();
    expect(vibrate).toHaveBeenCalledOnce();
    oscillator.onended?.();
    writeFeedback({ sound: false, haptics: false });
    playCue('bad');
    expect(Audio).toHaveBeenCalledOnce();
    expect(vibrate).toHaveBeenCalledOnce();
  });

  it('отказ WebAudio и вибрации не мешает ответу', () => {
    vi.stubGlobal(
      'AudioContext',
      class {
        constructor() {
          throw new Error('blocked');
        }
      },
    );
    vi.stubGlobal('navigator', {
      vibrate: () => {
        throw new Error('blocked');
      },
    });
    expect(() => playCue('bad')).not.toThrow();
  });

  it('отказ запуска звука закрывает контекст', async () => {
    const { context } = fakeAudio();
    context.state = 'suspended';
    context.resume.mockRejectedValueOnce(new Error('blocked'));
    playCue('ok');
    await Promise.resolve();
    expect(context.close).toHaveBeenCalledOnce();
  });
});
