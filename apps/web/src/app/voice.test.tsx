import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ME } from '../auth/client';
import { InboxCtx, type InboxApi, type NewVoice, type VoiceSaved } from './inbox-context';
import { VoiceBar } from './VoiceCapture';
import { VoiceProvider } from './voice';
import { voicePrefsKey } from './voice-api';
import { startVoice } from './voice-record';
import type { VoiceMethod } from './voice-view';

/* Микрофон и запись подделаны: настоящего звука и сети нет, платный ИИ не вызывается. */

let supported: string[] = [];
let recorders: FakeRecorder[] = [];
let clock = 1000;
const stopped = vi.fn();

class FakeRecorder {
  static isTypeSupported = (t: string) => supported.includes(t);
  state: 'inactive' | 'recording' = 'inactive';
  mimeType: string;
  ondataavailable: ((e: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(
    readonly stream: unknown,
    readonly options: { mimeType?: string; audioBitsPerSecond?: number } = {},
  ) {
    this.mimeType = options.mimeType ?? 'audio/webm';
    recorders.push(this);
  }
  start() {
    this.state = 'recording';
  }
  stop() {
    this.state = 'inactive';
    this.ondataavailable?.({ data: new Blob(['звук'.repeat(500)], { type: this.mimeType }) });
    this.onstop?.();
  }
}

const getUserMedia = vi.fn(async () => ({ getTracks: () => [{ stop: stopped }] }));

/** Распознавание браузера: на старте «слышит» фразу, на стоп — заканчивает сеанс. */
class FakeSpeech {
  lang = '';
  continuous = false;
  interimResults = false;
  onresult: ((e: unknown) => void) | null = null;
  onend: (() => void) | null = null;
  onerror: (() => void) | null = null;
  start() {
    queueMicrotask(() =>
      this.onresult?.({ results: [{ isFinal: true, 0: { transcript: 'Купить хлеб' } }] }),
    );
  }
  stop() {
    queueMicrotask(() => this.onend?.());
  }
  abort() {}
}

beforeEach(() => {
  supported = ['audio/webm;codecs=opus', 'audio/mp4'];
  recorders = [];
  clock = 1000;
  stopped.mockClear();
  getUserMedia.mockClear();
  vi.stubGlobal('MediaRecorder', FakeRecorder);
  Object.defineProperty(navigator, 'mediaDevices', {
    value: { getUserMedia },
    configurable: true,
  });
  vi.spyOn(performance, 'now').mockImplementation(() => clock);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

function setup(method: VoiceMethod = 'cloud') {
  const qc = new QueryClient();
  qc.setQueryData(ME, { id: 'u1', email: 'a@b.c', display_name: 'Я', is_owner: false });
  qc.setQueryData(voicePrefsKey('u1'), { method });
  const voice = vi.fn<(take: NewVoice) => Promise<VoiceSaved>>(async () => ({
    id: 'v1',
    kept: 'device',
  }));
  const inbox: InboxApi = {
    items: [],
    sync: { status: 'synced', pending: 0, problems: 0 },
    capture: vi.fn(),
    done: vi.fn(),
    later: vi.fn(),
    voice,
    dropVoice: vi.fn(),
  };
  const saved = vi.fn();
  render(
    <QueryClientProvider client={qc}>
      <InboxCtx.Provider value={inbox}>
        <VoiceProvider>
          <VoiceBar onSaved={saved} />
        </VoiceProvider>
      </InboxCtx.Provider>
    </QueryClientProvider>,
  );
  return { voice, saved };
}

const mic = () => screen.getByRole('button', { name: 'Записать голосом' });

describe('кнопка записи во «Входящих»', () => {
  it('готов → идёт запись → отправка → готов; запись уходит с форматом и длиной', async () => {
    const { voice, saved } = setup();
    fireEvent.click(mic());
    const stop = await screen.findByRole('button', { name: 'Остановить и отправить' });
    expect(screen.getByRole('status')).toHaveTextContent('Идёт запись');
    expect(screen.getByRole('button', { name: 'Отменить' })).toBeInTheDocument();
    expect(recorders[0]!.options).toEqual({
      mimeType: 'audio/webm;codecs=opus',
      audioBitsPerSecond: 32_000,
    });
    clock += 3200;
    fireEvent.click(stop);
    await waitFor(() => expect(voice).toHaveBeenCalledTimes(1));
    const take = voice.mock.calls[0]![0];
    expect(take).toMatchObject({ mime: 'audio/webm;codecs=opus', duration_ms: 3200 });
    expect(take.audio_base64.length).toBeGreaterThan(100);
    expect(take).not.toHaveProperty('text');
    await waitFor(() => expect(mic()).toBeEnabled());
    expect(saved).toHaveBeenCalledWith({ id: 'v1', kept: 'device' });
    // микрофон выключен
    expect(stopped).toHaveBeenCalled();
  });

  it('Safari: пишет в mp4', async () => {
    supported = ['audio/mp4'];
    const { voice } = setup();
    fireEvent.click(mic());
    const stop = await screen.findByRole('button', { name: 'Остановить и отправить' });
    clock += 2000;
    fireEvent.click(stop);
    await waitFor(() => expect(voice).toHaveBeenCalled());
    expect(voice.mock.calls[0]![0].mime).toBe('audio/mp4');
  });

  it('нет доступа к микрофону — говорит простыми словами, что сделать', async () => {
    getUserMedia.mockRejectedValueOnce(new DOMException('denied', 'NotAllowedError'));
    const { voice } = setup();
    fireEvent.click(mic());
    expect(await screen.findByRole('alert')).toHaveTextContent(
      /Нет доступа к микрофону\. Разрешите его браузеру/,
    );
    expect(mic()).toBeEnabled();
    expect(voice).not.toHaveBeenCalled();
  });

  it('браузер вовсе не умеет записывать', async () => {
    vi.stubGlobal('MediaRecorder', undefined);
    setup();
    fireEvent.click(mic());
    expect(await screen.findByRole('alert')).toHaveTextContent(/не умеет записывать звук/);
    expect(getUserMedia).not.toHaveBeenCalled();
  });

  it('«Отменить» — ничего не уходит, микрофон выключен', async () => {
    const { voice } = setup();
    fireEvent.click(mic());
    await screen.findByRole('button', { name: 'Остановить и отправить' });
    fireEvent.click(screen.getByRole('button', { name: 'Отменить' }));
    await waitFor(() => expect(mic()).toBeEnabled());
    expect(stopped).toHaveBeenCalled();
    expect(voice).not.toHaveBeenCalled();
  });

  it('случайное короткое нажатие не отправляется', async () => {
    const { voice } = setup();
    fireEvent.click(mic());
    const stop = await screen.findByRole('button', { name: 'Остановить и отправить' });
    clock += 150;
    fireEvent.click(stop);
    expect(await screen.findByRole('alert')).toHaveTextContent(/Слишком коротко/);
    expect(voice).not.toHaveBeenCalled();
  });

  it('«встроенное»: текст браузера уходит в том же запросе, что и звук', async () => {
    vi.stubGlobal('webkitSpeechRecognition', FakeSpeech);
    const { voice } = setup('device');
    fireEvent.click(mic());
    const stop = await screen.findByRole('button', { name: 'Остановить и отправить' });
    expect(await screen.findByText('Купить хлеб')).toBeInTheDocument();
    clock += 2500;
    fireEvent.click(stop);
    await waitFor(() => expect(voice).toHaveBeenCalled());
    expect(voice.mock.calls[0]![0]).toMatchObject({ text: 'Купить хлеб', duration_ms: 2500 });
  });

  it('«встроенное», а браузер не умеет — честно говорит, что сохранит только звук', () => {
    setup('device');
    expect(screen.getByText(/этот браузер не распознаёт речь сам/)).toBeInTheDocument();
  });
});

describe('запись с микрофона', () => {
  it('сама останавливается через две минуты', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const onLimit = vi.fn();
    const session = await startVoice({ speech: false, onLimit });
    await act(async () => {
      vi.advanceTimersByTime(119_999);
    });
    expect(onLimit).not.toHaveBeenCalled();
    await act(async () => {
      vi.advanceTimersByTime(1);
    });
    expect(onLimit).toHaveBeenCalledTimes(1);
    clock += 121_000;
    const take = await session.stop();
    // сервер не примет дольше 120 с — длина обрезается
    expect(take.ms).toBe(120_000);
  });
});
