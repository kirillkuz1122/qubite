import { afterEach, describe, expect, it, vi } from 'vitest';
import { startVoice } from './voice-record';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('запуск записи', () => {
  it('если рекордер не стартовал, микрофон отпускается', async () => {
    const stop = vi.fn();
    const stream = { getTracks: () => [{ stop }] };
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: async () => stream } });
    class Broken {
      static isTypeSupported = () => true;
      mimeType = 'audio/webm';
      start() {
        throw new DOMException('нет кодека', 'NotSupportedError');
      }
    }
    vi.stubGlobal('MediaRecorder', Broken);
    await expect(startVoice({ speech: false, onLimit: () => {} })).rejects.toThrow();
    expect(stop).toHaveBeenCalledTimes(1);
  });

  it('после запрета на распознавание речь не перезапускается без конца', async () => {
    const stream = { getTracks: () => [{ stop: vi.fn() }] };
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: async () => stream } });
    class Rec {
      static isTypeSupported = () => true;
      mimeType = 'audio/webm';
      state = 'recording';
      start() {}
      stop() {}
    }
    vi.stubGlobal('MediaRecorder', Rec);
    let starts = 0;
    class Speech {
      lang = '';
      continuous = false;
      interimResults = false;
      onresult = null;
      onend: (() => void) | null = null;
      onerror: ((e: { error: string }) => void) | null = null;
      start() {
        starts += 1;
        queueMicrotask(() => {
          this.onerror?.({ error: 'not-allowed' });
          this.onend?.();
        });
      }
      stop() {}
      abort() {}
    }
    vi.stubGlobal('webkitSpeechRecognition', Speech);
    const session = await startVoice({ speech: true, onLimit: () => {} });
    await new Promise((r) => setTimeout(r, 20));
    expect(starts).toBe(1);
    session.cancel();
  });
});
