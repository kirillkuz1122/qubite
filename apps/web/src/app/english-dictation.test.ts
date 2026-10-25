import { afterEach, describe, expect, it, vi } from 'vitest';
import { dictated, settled, startDictation } from './english-dictation';
import { EMPTY, reduce } from './english-realtime';

describe('диктовка: текст', () => {
  it('только слова человека, по порядку', () => {
    const t = [
      { type: 'input_audio_buffer.speech_started', item_id: 'u1' },
      {
        type: 'conversation.item.input_audio_transcription.completed',
        item_id: 'u1',
        transcript: 'I went',
      },
      { type: 'input_audio_buffer.speech_started', item_id: 'u2' },
      {
        type: 'conversation.item.input_audio_transcription.delta',
        item_id: 'u2',
        delta: 'to school',
      },
    ].reduce(reduce, EMPTY);
    expect(dictated(t)).toBe('I went to school');
    expect(settled(t)).toBe(false);
  });
});

/** Поддельные микрофон и WebRTC: ответ OpenAI приходит сам после «стоп». */
function fakeBrowser() {
  const sent: string[] = [];
  const track = { enabled: true, stop: vi.fn() };
  class FakePC {
    dc = {
      readyState: 'open',
      onmessage: null as ((m: { data: string }) => void) | null,
      send: (s: string) => {
        sent.push(s);
        const e = (x: object) => this.dc.onmessage?.({ data: JSON.stringify(x) });
        e({ type: 'input_audio_buffer.committed', item_id: 'u1' });
        e({
          type: 'conversation.item.input_audio_transcription.completed',
          item_id: 'u1',
          transcript: 'Hello there',
        });
      },
      close: vi.fn(),
    };
    addTrack() {}
    createDataChannel() {
      return this.dc;
    }
    async createOffer() {
      return { sdp: 'offer' };
    }
    async setLocalDescription() {}
    async setRemoteDescription() {}
    close = vi.fn();
  }
  vi.stubGlobal('RTCPeerConnection', FakePC);
  vi.stubGlobal('navigator', {
    mediaDevices: { getUserMedia: async () => ({ getTracks: () => [track] }) },
  });
  return { sent, track };
}

afterEach(() => vi.unstubAllGlobals());

describe('диктовка через ChatGPT', () => {
  it('ключ с сервера → WebRTC → текст, сеанс закрыт и засчитан', async () => {
    const { sent, track } = fakeBrowser();
    const calls: { url: string; body: string | null }[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        calls.push({ url, body: (init?.body as string) ?? null });
        if (url === '/api/v1/english/dictation')
          return Response.json({
            id: 'd1',
            client_secret: 'ek_1',
            calls_url: 'https://realtime.test/calls',
            max_seconds: 120,
          });
        if (url === 'https://realtime.test/calls') return new Response('answer');
        return Response.json({ seconds: 1, session: null });
      }),
    );
    const d = await startDictation({ language: 'en' });
    expect(d.via).toBe('chatgpt');
    expect(JSON.parse(calls[0]!.body!)).toMatchObject({ language: 'en' });
    expect(await d.stop()).toBe('Hello there');
    expect(sent.map((s) => JSON.parse(s).type)).toEqual(['input_audio_buffer.commit']);
    expect(track.stop).toHaveBeenCalled();
    expect(calls.at(-1)!.url).toBe('/api/v1/english/realtime/d1/finish');
  });

  it('нет подписки и нет записи в браузере — понятная ошибка', async () => {
    fakeBrowser();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json({ error: 'chatgpt_not_connected', message: 'нет' }, { status: 409 }),
      ),
    );
    vi.stubGlobal('MediaRecorder', undefined);
    await expect(startDictation()).rejects.toThrow(/записывать звук/);
  });
});
