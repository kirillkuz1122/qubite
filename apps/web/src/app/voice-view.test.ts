import { describe, expect, it } from 'vitest';
import {
  MAX_VOICE_BYTES,
  VOICE_IDLE,
  acceptedMime,
  isBareVoice,
  micError,
  pickVoiceMime,
  recClock,
  takeProblem,
  voiceAudioUrl,
  voiceOptions,
  voiceReason,
  voiceStep,
  type VoiceEvent,
  type VoiceState,
} from './voice-view';

describe('формат записи', () => {
  it('opus в webm, если браузер умеет; иначе mp4 (Safari)', () => {
    expect(pickVoiceMime(() => true)).toBe('audio/webm;codecs=opus');
    expect(pickVoiceMime((t) => t === 'audio/mp4')).toBe('audio/mp4');
    expect(pickVoiceMime((t) => t === 'audio/ogg;codecs=opus')).toBe('audio/ogg;codecs=opus');
    expect(pickVoiceMime(() => false)).toBeNull();
  });

  it('сервер принимает форматы MediaRecorder и не принимает чужие', () => {
    expect(acceptedMime('audio/webm;codecs=opus')).toBe(true);
    expect(acceptedMime('audio/mp4; codecs=mp4a.40.2')).toBe(true);
    expect(acceptedMime('audio/ogg')).toBe(true);
    expect(acceptedMime('video/webm')).toBe(false);
    expect(acceptedMime('')).toBe(false);
  });
});

describe('ошибки микрофона — простыми словами', () => {
  it('запрет, нет микрофона, занят, браузер не умеет', () => {
    expect(micError(new DOMException('x', 'NotAllowedError'))).toMatch(/^Нет доступа к микрофону/);
    expect(micError(new DOMException('x', 'NotFoundError'))).toMatch(/не найден/);
    expect(micError(new DOMException('x', 'NotReadableError'))).toMatch(/занят/);
    expect(micError('unsupported')).toMatch(/не умеет записывать звук/);
    expect(micError('insecure')).toMatch(/https/);
    expect(micError(new Error('что-то'))).toBe(
      'Не получилось включить микрофон. Попробуйте ещё раз.',
    );
  });
});

describe('состояния кнопки записи', () => {
  const run = (...events: VoiceEvent[]) =>
    events.reduce<VoiceState>((s, e) => voiceStep(s, e), VOICE_IDLE);

  it('готов → разрешение → запись → отправка → готов', () => {
    expect(run({ type: 'start' }).phase).toBe('asking');
    const rec = run({ type: 'start' }, { type: 'live', at: 42 });
    expect(rec).toMatchObject({ phase: 'recording', started: 42 });
    expect(voiceStep(rec, { type: 'heard', text: 'купить хлеб' }).heard).toBe('купить хлеб');
    expect(voiceStep(rec, { type: 'stop' }).phase).toBe('sending');
    expect(
      run({ type: 'start' }, { type: 'live', at: 1 }, { type: 'stop' }, { type: 'sent' }),
    ).toEqual(VOICE_IDLE);
  });

  it('отмена — без записи; ошибка — обратно в «готов» с текстом', () => {
    expect(run({ type: 'start' }, { type: 'cancel' })).toEqual(VOICE_IDLE);
    expect(run({ type: 'start' }, { type: 'live', at: 1 }, { type: 'cancel' })).toEqual(VOICE_IDLE);
    const failed = run({ type: 'start' }, { type: 'fail', error: 'нет доступа' });
    expect(failed).toEqual({ ...VOICE_IDLE, error: 'нет доступа' });
    // новая попытка стирает старую ошибку
    expect(voiceStep(failed, { type: 'start' })).toMatchObject({ phase: 'asking', error: null });
    expect(voiceStep(failed, { type: 'dismiss' }).error).toBeNull();
  });

  it('лишние события ничего не ломают', () => {
    expect(run({ type: 'stop' })).toEqual(VOICE_IDLE);
    expect(run({ type: 'live', at: 5 })).toEqual(VOICE_IDLE);
    const sending = run({ type: 'start' }, { type: 'live', at: 1 }, { type: 'stop' });
    expect(voiceStep(sending, { type: 'cancel' })).toBe(sending);
    expect(voiceStep(sending, { type: 'start' })).toBe(sending);
  });
});

describe('готовая запись', () => {
  it('случайное нажатие, тишина, слишком большая, чужой формат', () => {
    const ok = { ms: 3000, size: 40_000, mime: 'audio/webm;codecs=opus' };
    expect(takeProblem(ok)).toBeNull();
    expect(takeProblem({ ...ok, ms: 200 })).toMatch(/Слишком коротко/);
    expect(takeProblem({ ...ok, size: 0 })).toMatch(/ничего не записал/);
    expect(takeProblem({ ...ok, size: MAX_VOICE_BYTES + 1 })).toMatch(/слишком большой/);
    expect(takeProblem({ ...ok, mime: 'audio/x-unknown' })).toMatch(/формате/);
  });

  it('таймер «сколько из двух минут»', () => {
    expect(recClock(0)).toBe('0:00 / 2:00');
    expect(recClock(7_400)).toBe('0:07 / 2:00');
    expect(recClock(125_000)).toBe('2:00 / 2:00');
  });
});

describe('запись во «Входящих»', () => {
  it('без текста — только «Голосовая запись» от сервера', () => {
    expect(isBareVoice('voice', 'Голосовая запись')).toBe(true);
    expect(isBareVoice('voice', 'Купить хлеб')).toBe(false);
    expect(isBareVoice('text', 'Голосовая запись')).toBe(false);
    expect(voiceAudioUrl('a b')).toBe('/api/v1/inbox/a%20b/audio');
  });

  it('причина без текста — простыми словами', () => {
    expect(voiceReason(null)).toBe('текста нет — послушай запись');
    expect(voiceReason('Нет разрешения на AI-распознавание')).toMatch(/не подключено/);
    expect(voiceReason('Не удалось распознать речь. Аудиозапись сохранена')).toMatch(/не разобрал/);
    expect(voiceReason('Устройство не передало распознанный текст')).toMatch(/браузер/);
    expect(voiceReason('Распознавание со своим ключом пока не поддерживается')).toMatch(
      /свой ключ/,
    );
    expect(voiceReason('Новая причина')).toBe('новая причина');
  });
});

describe('способы распознавания', () => {
  it('облако и встроенное работают, свой ключ и локально — в следующем обновлении', () => {
    const all = voiceOptions(true);
    expect(all.map((o) => o.value)).toEqual(['cloud', 'device', 'own_key', 'local']);
    expect(all[0]!.label).toBe('Облако (ElevenLabs) — по умолчанию');
    expect(all.filter((o) => o.disabled).map((o) => o.value)).toEqual(['own_key', 'local']);
    expect(all.find((o) => o.value === 'local')!.note).toBe('Появится в следующем обновлении');
  });

  it('браузер не умеет распознавать — встроенное недоступно и сказано почему', () => {
    const device = voiceOptions(false).find((o) => o.value === 'device')!;
    expect(device.disabled).toBe(true);
    expect(device.note).toMatch(/не умеет/);
  });
});
