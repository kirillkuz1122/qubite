import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  LOCAL_DEFAULT_URL,
  checkLocal,
  localUrlProblem,
  localWhisperUrl,
  setLocalWhisperUrl,
  silence,
  transcribeLocal,
} from './voice-local';

/* Whisper подделан: настоящей сети нет. */

const fetchMock = vi.fn<typeof fetch>();
const audio = () => new Blob(['звук'], { type: 'audio/webm;codecs=opus' });

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  localStorage.clear();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('адрес Whisper', () => {
  it('по умолчанию — этот компьютер; хранится только в браузере', () => {
    expect(localWhisperUrl()).toBe(LOCAL_DEFAULT_URL);
    setLocalWhisperUrl(' http://127.0.0.1:9000 ');
    expect(localWhisperUrl()).toBe('http://127.0.0.1:9000');
    expect(localStorage.getItem('qubite.voice.local-url')).toBe('http://127.0.0.1:9000');
  });

  it('что не так с адресом — простыми словами', () => {
    expect(localUrlProblem('http://127.0.0.1:8080', 'https:')).toBeNull();
    expect(localUrlProblem('http://localhost:8080/', 'https:')).toBeNull();
    expect(localUrlProblem('https://pc.local:8080', 'https:')).toBeNull();
    expect(localUrlProblem('http://192.168.1.5:8080', 'http:')).toBeNull();
    expect(localUrlProblem('', 'https:')).toMatch(/Впишите адрес/);
    expect(localUrlProblem('127.0.0.1:8080', 'https:')).toMatch(/Адрес вида/);
    expect(localUrlProblem('ftp://127.0.0.1', 'https:')).toMatch(/Адрес вида/);
    // с https-страницы браузер не пустит на http другого компьютера
    expect(localUrlProblem('http://192.168.1.5:8080', 'https:')).toMatch(
      /только к этому компьютеру/,
    );
  });
});

describe('распознать своим Whisper', () => {
  it('запись уходит на /inference как файл, в ответ — текст', async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ text: '  Купить   хлеб\n' }));
    const heard = await transcribeLocal(
      'http://127.0.0.1:8080/',
      audio(),
      'audio/webm;codecs=opus',
    );
    expect(heard).toEqual({ text: 'Купить хлеб' });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('http://127.0.0.1:8080/inference');
    expect(init).toMatchObject({ method: 'POST', credentials: 'omit' });
    const form = init!.body as FormData;
    expect(form.get('response_format')).toBe('json');
    const file = form.get('file') as File;
    expect(file.name).toBe('voice.webm');
    expect(file.size).toBeGreaterThan(0);
  });

  it('сервер не запущен — причина, без исключения', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    expect(await transcribeLocal(LOCAL_DEFAULT_URL, audio(), 'audio/webm')).toEqual({
      why: 'Локальный Whisper не ответил',
    });
  });

  it('ошибка сервера, чужой ответ, тишина', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response('{"error":"failed to read audio"}', { status: 500 }),
    );
    expect(await transcribeLocal(LOCAL_DEFAULT_URL, audio(), 'audio/webm')).toEqual({
      why: 'Локальный Whisper ответил ошибкой 500',
    });
    fetchMock.mockResolvedValueOnce(new Response('<html>'));
    expect((await transcribeLocal(LOCAL_DEFAULT_URL, audio(), 'audio/webm')).why).toMatch(
      /не текстом/,
    );
    fetchMock.mockResolvedValueOnce(Response.json({ text: ' ' }));
    expect((await transcribeLocal(LOCAL_DEFAULT_URL, audio(), 'audio/webm')).why).toMatch(
      /не разобрал слов/,
    );
  });

  it('дольше минуты не ждёт', async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementationOnce(
      (_url, init) =>
        new Promise((_, reject) =>
          init!.signal!.addEventListener('abort', () => reject(new DOMException('', 'AbortError'))),
        ),
    );
    const heard = transcribeLocal(LOCAL_DEFAULT_URL, audio(), 'audio/webm');
    await vi.advanceTimersByTimeAsync(60_000);
    expect(await heard).toEqual({ why: 'Локальный Whisper не успел за минуту' });
  });

  it('адреса нет — даже не пытается', async () => {
    expect(await transcribeLocal('', audio(), 'audio/webm')).toEqual({
      why: 'Не задан адрес локального Whisper',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('«Проверить»', () => {
  it('тишина в WAV: сервер ответил как Whisper — всё хорошо', async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ text: '' }));
    expect(await checkLocal(LOCAL_DEFAULT_URL)).toEqual({ ok: true });
    const form = fetchMock.mock.calls[0]![1]!.body as FormData;
    expect((form.get('file') as File).name).toBe('voice.wav');
    expect(silence().size).toBe(44 + 16_000);
  });

  it('не отвечает или отвечает не он — объясняет, что сделать', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    expect(await checkLocal(LOCAL_DEFAULT_URL)).toMatchObject({
      ok: false,
      message: expect.stringMatching(/Whisper не отвечает\. Запущен ли он\?/),
    });
    fetchMock.mockResolvedValueOnce(new Response('нет', { status: 404 }));
    expect(await checkLocal(LOCAL_DEFAULT_URL)).toMatchObject({
      ok: false,
      message: expect.stringMatching(/ошибкой 404/),
    });
    expect(await checkLocal('')).toMatchObject({
      ok: false,
      message: expect.stringMatching(/Впишите/),
    });
  });
});
