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
});
