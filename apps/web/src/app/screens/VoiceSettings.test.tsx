import { LookProvider } from '@qubite/ui';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ME } from '../../auth/client';
import { voiceKeyKey, voicePrefsKey, type VoiceKey } from '../voice-api';
import type { VoiceMethod } from '../voice-view';
import { VoiceSettings } from './VoiceSettings';

// форма ключа проверяется так, будто сервер уже есть (по умолчанию вариант выключен)
vi.mock('../voice-view', async (orig) => ({
  ...(await orig<typeof import('../voice-view')>()),
  OWN_KEY_READY: true,
}));

const { put } = vi.hoisted(() => ({ put: vi.fn() }));
vi.mock('../../api', () => ({ api: { PUT: put, GET: vi.fn() } }));
// заголовок из точек рисует холст — здесь он не нужен
vi.mock('../parts', () => ({
  SecHead: ({ label, children }: { label: string; children?: ReactNode }) => (
    <div>
      <h2>{label}</h2>
      {children}
    </div>
  ),
}));

/* Сервер своего ключа и локальный Whisper подделаны: настоящих ключей и сети нет. */
const SECRET = 'sk-test-0000000000001234';
const NONE: VoiceKey = { configured: false, base_url: null, model: null, last4: null };
let stored: VoiceKey = NONE;
const fetchMock = vi.fn<typeof fetch>();

function server(url: string, init: RequestInit = {}): Promise<Response> {
  const method = init.method ?? 'GET';
  if (url === '/api/v1/voice/key') {
    if (method === 'GET') return Promise.resolve(Response.json(stored));
    if (method === 'DELETE') {
      stored = NONE;
      return Promise.resolve(new Response(null, { status: 204 }));
    }
    const body = JSON.parse(String(init.body)) as {
      api_key: string;
      base_url?: string;
      model?: string;
    };
    stored = {
      configured: true,
      base_url: body.base_url ?? null,
      model: body.model ?? null,
      last4: body.api_key.slice(-4),
    };
    return Promise.resolve(Response.json(stored));
  }
  return Promise.reject(new TypeError(`нет сети: ${url}`));
}

function setup(method: VoiceMethod = 'cloud') {
  const qc = new QueryClient();
  qc.setQueryData(ME, { id: 'u1', email: 'a@b.c', display_name: 'Я', is_owner: false });
  qc.setQueryData(voicePrefsKey('u1'), { method });
  render(
    <QueryClientProvider client={qc}>
      <LookProvider>
        <VoiceSettings />
      </LookProvider>
    </QueryClientProvider>,
  );
  return qc;
}

const keyForm = () => screen.getByRole('form', { name: 'Свой ключ API' });
const keyField = () => within(keyForm()).getByLabelText('Ключ API') as HTMLInputElement;
const keyCalls = (method: string) =>
  fetchMock.mock.calls.filter(
    ([url, init]) => url === '/api/v1/voice/key' && (init?.method ?? 'GET') === method,
  );

beforeEach(() => {
  put.mockReset();
  put.mockImplementation(async (_path: string, { body }: { body: { method: string } }) => ({
    data: body,
    response: new Response(null, { status: 200 }),
  }));
  stored = NONE;
  fetchMock.mockReset();
  fetchMock.mockImplementation((input, init) => server(String(input), init));
  vi.stubGlobal('fetch', fetchMock);
  localStorage.clear();
  document.cookie = 'qubite_csrf=csrf-1';
});
afterEach(() => vi.unstubAllGlobals());

describe('«Как распознавать речь»', () => {
  it('все четыре способа можно выбрать', () => {
    setup();
    expect(screen.getByRole('radiogroup', { name: 'Как распознавать речь' })).toBeInTheDocument();
    expect(
      screen.getByRole('radio', { name: /Облако \(ElevenLabs\) — по умолчанию/ }),
    ).toHaveAttribute('aria-checked', 'true');
    for (const name of [/Свой ключ API/, /Локально на компьютере/]) {
      const option = screen.getByRole('radio', { name });
      expect(option).not.toHaveAttribute('aria-disabled');
      expect(option).not.toHaveTextContent('Появится в следующем обновлении');
    }
    expect(screen.getByRole('radio', { name: /Встроенное/ })).toHaveTextContent(
      'На телефоне это распознавание браузера или Android',
    );
  });

  it('браузер умеет распознавать — «встроенное» сохраняется на сервере', async () => {
    vi.stubGlobal('webkitSpeechRecognition', class {});
    const qc = setup();
    fireEvent.click(screen.getByRole('radio', { name: /Встроенное в браузер или Android/ }));
    await waitFor(() =>
      expect(put).toHaveBeenCalledWith('/api/v1/voice/prefs', { body: { method: 'device' } }),
    );
    await waitFor(() => expect(qc.getQueryData(voicePrefsKey('u1'))).toEqual({ method: 'device' }));
    expect(screen.getByRole('radio', { name: /Встроенное/ })).toHaveAttribute(
      'aria-checked',
      'true',
    );
  });

  it('браузер не умеет — «встроенное» недоступно и сказано почему', () => {
    setup();
    const device = screen.getByRole('radio', { name: /Встроенное/ });
    expect(device).toHaveAttribute('aria-disabled', 'true');
    expect(device).toHaveTextContent('Этот браузер так не умеет');
    fireEvent.click(device);
    expect(put).not.toHaveBeenCalled();
  });

  it('не сохранилось — говорит почему', async () => {
    vi.stubGlobal('webkitSpeechRecognition', class {});
    put.mockResolvedValueOnce({
      error: { error: 'forbidden', message: 'Нет права записи' },
      response: new Response(null, { status: 403 }),
    });
    setup();
    fireEvent.click(screen.getByRole('radio', { name: /Встроенное/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Нет права записи');
  });
});

describe('свой ключ API', () => {
  it('выбрали — под вариантом форма; ключа нет — предупреждение', async () => {
    setup();
    expect(screen.queryByRole('form', { name: 'Свой ключ API' })).toBeNull();
    fireEvent.click(screen.getByRole('radio', { name: /Свой ключ API/ }));
    await waitFor(() =>
      expect(put).toHaveBeenCalledWith('/api/v1/voice/prefs', { body: { method: 'own_key' } }),
    );
    expect(await within(keyForm()).findByText(/Ключ не задан/)).toHaveTextContent(
      'Ключ не задан — записи будут сохраняться только звуком.',
    );
    expect(keyForm()).toHaveTextContent('Платите вы сами');
    expect(keyForm()).toHaveTextContent('хранится на сервере Qubite зашифрованным');
    expect(keyField()).toHaveAttribute('type', 'password');
    expect(keyField()).toHaveAttribute('autocomplete', 'off');
    expect(within(keyForm()).getByRole('button', { name: 'Удалить ключ' })).toBeDisabled();
    expect(within(keyForm()).getByRole('button', { name: 'Сохранить' })).toBeDisabled();
  });

  it('«Сохранить»: ключ уходит только телом запроса, поле очищается, видно …1234', async () => {
    setup('own_key');
    await within(keyForm()).findByText(/Ключ не задан/);
    fireEvent.click(within(keyForm()).getByRole('radio', { name: 'Groq' }));
    expect(keyForm()).toHaveTextContent('https://api.groq.com/openai/v1');
    fireEvent.change(keyField(), { target: { value: SECRET } });
    fireEvent.click(within(keyForm()).getByRole('button', { name: 'Сохранить' }));
    expect(await within(keyForm()).findByText(/Ключ сохранён: …1234/)).toHaveTextContent(
      'Ключ сохранён: …1234 · Groq, whisper-large-v3-turbo',
    );
    const [url, init] = keyCalls('PUT')[0]!;
    expect(url).toBe('/api/v1/voice/key');
    expect(JSON.parse(String(init!.body))).toEqual({
      api_key: SECRET,
      base_url: 'https://api.groq.com/openai/v1',
      model: 'whisper-large-v3-turbo',
    });
    expect((init!.headers as Record<string, string>)['X-CSRF-Token']).toBe('csrf-1');
    // поле пустое, ключ нигде на устройстве не остался
    expect(keyField().value).toBe('');
    expect(document.body.innerHTML).not.toContain(SECRET);
    expect(JSON.stringify({ ...localStorage })).not.toContain('1234');
    for (const [u] of fetchMock.mock.calls) expect(String(u)).not.toContain(SECRET);
    expect(within(keyForm()).getByRole('button', { name: 'Удалить ключ' })).toBeEnabled();
  });

  it('«Удалить ключ» — снова предупреждение', async () => {
    stored = {
      configured: true,
      base_url: 'https://api.openai.com/v1',
      model: 'whisper-1',
      last4: '9876',
    };
    const qc = setup('own_key');
    expect(await within(keyForm()).findByText(/Ключ сохранён/)).toHaveTextContent(
      'Ключ сохранён: …9876 · OpenAI, whisper-1',
    );
    fireEvent.click(within(keyForm()).getByRole('button', { name: 'Удалить ключ' }));
    expect(await within(keyForm()).findByText(/Ключ не задан/)).toBeInTheDocument();
    expect(keyCalls('DELETE')).toHaveLength(1);
    expect(qc.getQueryData(voiceKeyKey('u1'))).toEqual(NONE);
  });

  it('сервис не принял ключ — причина от сервера, поле не стирается', async () => {
    setup('own_key');
    await within(keyForm()).findByText(/Ключ не задан/);
    fetchMock.mockImplementationOnce(async () =>
      Response.json(
        { error: 'invalid_key', message: 'Сервис не принял ключ — проверьте его' },
        { status: 400 },
      ),
    );
    fireEvent.change(keyField(), { target: { value: 'sk-wrong-key' } });
    fireEvent.submit(keyForm());
    expect(await within(keyForm()).findByRole('alert')).toHaveTextContent(
      'Сервис не принял ключ — проверьте его',
    );
    expect(keyField().value).toBe('sk-wrong-key');
    expect(stored).toEqual(NONE);
  });

  it('«Другой»: свой адрес и модель; без адреса не отправляет', async () => {
    setup('own_key');
    await within(keyForm()).findByText(/Ключ не задан/);
    fireEvent.click(within(keyForm()).getByRole('radio', { name: 'Другой' }));
    fireEvent.change(keyField(), { target: { value: SECRET } });
    fireEvent.click(within(keyForm()).getByRole('button', { name: 'Сохранить' }));
    expect(await within(keyForm()).findByRole('alert')).toHaveTextContent('Впишите адрес API');
    expect(keyCalls('PUT')).toHaveLength(0);
    fireEvent.change(within(keyForm()).getByLabelText('Адрес API'), {
      target: { value: 'https://stt.example.com/v1' },
    });
    fireEvent.change(within(keyForm()).getByLabelText('Модель'), {
      target: { value: 'my-whisper' },
    });
    fireEvent.click(within(keyForm()).getByRole('button', { name: 'Сохранить' }));
    await within(keyForm()).findByText(/Ключ сохранён: …1234/);
    expect(JSON.parse(String(keyCalls('PUT')[0]![1]!.body))).toEqual({
      api_key: SECRET,
      base_url: 'https://stt.example.com/v1',
      model: 'my-whisper',
    });
    // сохранённый свой сервис так и показан
    expect(within(keyForm()).getByRole('radio', { name: 'Другой' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
  });
});

describe('локально на компьютере', () => {
  const localForm = () => screen.getByRole('form', { name: 'Локальный Whisper' });
  const address = () => within(localForm()).getByLabelText('Адрес Whisper') as HTMLInputElement;

  it('адрес — только на этом устройстве; «Проверить» стучится в Whisper', async () => {
    setup('local');
    expect(address().value).toBe('http://127.0.0.1:8080');
    expect(localForm()).toHaveTextContent('whisper-server -m ggml-small.bin -l ru --convert');
    fireEvent.change(address(), { target: { value: 'http://localhost:9000' } });
    expect(localStorage.getItem('qubite.voice.local-url')).toBe('http://localhost:9000');
    fetchMock.mockImplementationOnce(async () => Response.json({ text: '' }));
    fireEvent.click(within(localForm()).getByRole('button', { name: 'Проверить' }));
    expect(await within(localForm()).findByText(/Whisper отвечает/)).toBeInTheDocument();
    expect(fetchMock).toHaveBeenLastCalledWith(
      'http://localhost:9000/inference',
      expect.objectContaining({ method: 'POST' }),
    );
    // на сервер Qubite адрес не уходит
    expect(put).not.toHaveBeenCalled();
  });

  it('Whisper не запущен — объясняет простыми словами', async () => {
    setup('local');
    fireEvent.click(within(localForm()).getByRole('button', { name: 'Проверить' }));
    expect(await within(localForm()).findByRole('alert')).toHaveTextContent(
      'Whisper не отвечает. Запущен ли он?',
    );
  });

  it('пустой адрес — подсказка под полем', async () => {
    setup('local');
    fireEvent.change(address(), { target: { value: '' } });
    fireEvent.blur(address());
    expect(await within(localForm()).findByRole('alert')).toHaveTextContent('Впишите адрес');
  });
});
