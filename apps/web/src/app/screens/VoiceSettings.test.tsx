import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ME } from '../../auth/client';
import { VOICE_PREFS } from '../voice-api';
import { VoiceSettings } from './VoiceSettings';

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

function setup(method: 'cloud' | 'device' = 'cloud') {
  const qc = new QueryClient();
  qc.setQueryData(ME, { id: 'u1', email: 'a@b.c', display_name: 'Я', is_owner: false });
  qc.setQueryData(VOICE_PREFS, { method });
  render(
    <QueryClientProvider client={qc}>
      <VoiceSettings />
    </QueryClientProvider>,
  );
  return qc;
}

beforeEach(() => {
  put.mockReset();
  put.mockImplementation(async (_path: string, { body }: { body: { method: string } }) => ({
    data: body,
    response: new Response(null, { status: 200 }),
  }));
});
afterEach(() => vi.unstubAllGlobals());

describe('«Как распознавать речь»', () => {
  it('четыре способа; свой ключ и локально — в следующем обновлении', () => {
    setup();
    expect(screen.getByRole('radiogroup', { name: 'Как распознавать речь' })).toBeInTheDocument();
    expect(
      screen.getByRole('radio', { name: /Облако \(ElevenLabs\) — по умолчанию/ }),
    ).toHaveAttribute('aria-checked', 'true');
    for (const name of [/Свой ключ API/, /Локально на устройстве/]) {
      const option = screen.getByRole('radio', { name });
      expect(option).toHaveAttribute('aria-disabled', 'true');
      expect(option).toHaveTextContent('Появится в следующем обновлении');
      fireEvent.click(option);
    }
    expect(put).not.toHaveBeenCalled();
  });

  it('браузер умеет распознавать — «встроенное» сохраняется на сервере', async () => {
    vi.stubGlobal('webkitSpeechRecognition', class {});
    const qc = setup();
    fireEvent.click(screen.getByRole('radio', { name: /Встроенное в браузер или Android/ }));
    await waitFor(() =>
      expect(put).toHaveBeenCalledWith('/api/v1/voice/prefs', { body: { method: 'device' } }),
    );
    await waitFor(() => expect(qc.getQueryData(VOICE_PREFS)).toEqual({ method: 'device' }));
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
