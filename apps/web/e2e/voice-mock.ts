import type { Page } from '@playwright/test';
import type { SyncMock } from './sync-mock';

/**
 * Голосовой ввод (CMD-005b) без настоящего микрофона и без платного ИИ: MediaRecorder и
 * getUserMedia подделаны в браузере, `POST /api/v1/inbox/voice` и `/api/v1/voice/prefs` —
 * в тесте. Сервер «распознаёт» заранее заданный текст и кладёт запись в поддельную синхронизацию.
 */
export interface VoiceMock {
  /** записи, которые дошли до сервера */
  calls: Record<string, unknown>[];
  /** ID всех попыток отправки, включая оборванные без сети */
  tried: string[];
  /** что «распознал» сервер; `null` — нет гранта на AI: «Голосовая запись» и причина */
  heard: string | null;
  method: 'cloud' | 'device' | 'local' | 'own_key';
}

/** Подделать микрофон: запись — тишина; `denied` — человек не разрешил микрофон. */
export async function fakeMicrophone(page: Page, denied = false) {
  await page.addInitScript((refuse: boolean) => {
    class FakeRecorder {
      static isTypeSupported(type: string) {
        return type.startsWith('audio/webm');
      }
      mimeType: string;
      state: 'inactive' | 'recording' = 'inactive';
      ondataavailable: ((e: { data: Blob }) => void) | null = null;
      onstop: (() => void) | null = null;
      onerror: (() => void) | null = null;
      constructor(_stream: unknown, options: { mimeType?: string } = {}) {
        this.mimeType = options.mimeType ?? 'audio/webm';
      }
      start() {
        this.state = 'recording';
      }
      stop() {
        if (this.state === 'inactive') return;
        this.state = 'inactive';
        this.ondataavailable?.({ data: new Blob([new Uint8Array(3000)], { type: this.mimeType }) });
        setTimeout(() => this.onstop?.(), 0);
      }
    }
    Object.defineProperty(window, 'MediaRecorder', {
      value: FakeRecorder,
      configurable: true,
      writable: true,
    });
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        getUserMedia: () =>
          refuse
            ? Promise.reject(new DOMException('denied', 'NotAllowedError'))
            : Promise.resolve({ getTracks: () => [{ stop() {} }] }),
      },
    });
  }, denied);
}

/** Тишина в WAV: у плеера есть длина, звук не нужен. */
function silence(seconds: number): Buffer {
  const rate = 8000;
  const data = rate * seconds;
  const b = Buffer.alloc(44 + data, 128);
  b.write('RIFF', 0);
  b.writeUInt32LE(36 + data, 4);
  b.write('WAVEfmt ', 8);
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20); // PCM
  b.writeUInt16LE(1, 22); // моно
  b.writeUInt32LE(rate, 24);
  b.writeUInt32LE(rate, 28);
  b.writeUInt16LE(1, 32);
  b.writeUInt16LE(8, 34);
  b.write('data', 36);
  b.writeUInt32LE(data, 40);
  return b;
}

export async function mockVoice(page: Page, sync: SyncMock): Promise<VoiceMock> {
  const mock: VoiceMock = {
    calls: [],
    tried: [],
    heard: 'Позвонить бабушке в субботу',
    method: 'cloud',
  };
  await page.route('**/api/v1/inbox/voice', async (route) => {
    const body = route.request().postDataJSON() as Record<string, unknown> & { id: string };
    mock.tried.push(body.id);
    if (sync.offline) return route.abort('internetdisconnected');
    mock.calls.push(body);
    // сервер берёт текст устройства только при способе device/local (D-845)
    const text =
      mock.method === 'device' || mock.method === 'local'
        ? typeof body.text === 'string' && body.text.trim()
          ? body.text
          : null
        : mock.heard;
    const again = sync.objects.has(body.id);
    sync.addVoice(body.id, text ?? 'Голосовая запись', String(body.source ?? 'web'));
    return route.fulfill({
      status: again ? 200 : 201,
      json: {
        item: { id: body.id, body: text ?? 'Голосовая запись', kind: 'voice' },
        transcribed: text !== null,
        reason: text === null ? 'Нет разрешения на AI-распознавание' : null,
      },
    });
  });
  await page.route('**/api/v1/voice/prefs', async (route) => {
    if (route.request().method() === 'PUT')
      mock.method = (route.request().postDataJSON() as { method: VoiceMock['method'] }).method;
    return route.fulfill({ json: { method: mock.method } });
  });
  // звук записи (#223): три секунды тишины
  await page.route('**/api/v1/inbox/*/audio', (route) =>
    route.fulfill({ status: 200, contentType: 'audio/wav', body: silence(3) }),
  );
  return mock;
}
