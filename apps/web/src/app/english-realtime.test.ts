import { describe, expect, it } from 'vitest';
import {
  activityOf,
  EMPTY,
  markSent,
  minutesLeft,
  openAiFailure,
  ready,
  reduce,
  serverFailure,
  type RtEvent,
  type Transcript,
} from './english-realtime';

const run = (events: RtEvent[], from: Transcript = EMPTY) => events.reduce(reduce, from);

describe('живой голос: расшифровка', () => {
  it('обе стороны по порядку и по мере речи', () => {
    const t = run([
      {
        type: 'response.output_item.added',
        item: { id: 'a1', type: 'message', role: 'assistant' },
      },
      { type: 'response.output_audio_transcript.delta', item_id: 'a1', delta: 'Hi! What did ' },
      { type: 'response.output_audio_transcript.delta', item_id: 'a1', delta: 'you do?' },
      { type: 'input_audio_buffer.speech_started', item_id: 'u1' },
      { type: 'conversation.item.input_audio_transcription.delta', item_id: 'u1', delta: 'I goed' },
    ]);
    expect(t.items.map((i) => [i.role, i.text, i.done])).toEqual([
      ['tutor', 'Hi! What did you do?', false],
      ['learner', 'I goed', false],
    ]);
    expect(ready(t)).toEqual([]); // недоговорённое не уходит

    const done = run(
      [
        {
          type: 'response.output_audio_transcript.done',
          item_id: 'a1',
          transcript: 'Hi! What did you do?',
        },
        {
          type: 'conversation.item.input_audio_transcription.completed',
          item_id: 'u1',
          transcript: ' I goed to school ',
        },
      ],
      t,
    );
    expect(ready(done).map((i) => i.text)).toEqual(['Hi! What did you do?', 'I goed to school']);
    expect(ready(markSent(done, ['a1', 'u1']))).toEqual([]);
  });

  it('реплика ученика держит очередь, пока не расшифрована; перебитый ответ — тоже готов', () => {
    const t = run([
      { type: 'input_audio_buffer.speech_started', item_id: 'u1' },
      { type: 'response.output_item.added', item: { id: 'a1', role: 'assistant' } },
      { type: 'response.audio_transcript.delta', item_id: 'a1', delta: 'Wait, you' },
      { type: 'response.done', response: { status: 'cancelled' } },
    ]);
    expect(ready(t)).toEqual([]); // ученик ещё не расшифрован
    const later = reduce(t, {
      type: 'conversation.item.input_audio_transcription.failed',
      item_id: 'u1',
    });
    expect(ready(later).map((i) => [i.role, i.text])).toEqual([
      ['learner', ''],
      ['tutor', 'Wait, you'],
    ]);
  });

  it('чужие события ничего не меняют', () => {
    expect(reduce(EMPTY, { type: 'session.created' })).toBe(EMPTY);
    expect(
      reduce(EMPTY, { type: 'response.output_item.added', item: { id: 'f', role: 'tool' } }),
    ).toBe(EMPTY);
  });

  it('что делает Нейт', () => {
    expect(activityOf({ type: 'input_audio_buffer.speech_started' })).toBe('listening');
    expect(activityOf({ type: 'input_audio_buffer.speech_stopped' })).toBe('thinking');
    expect(activityOf({ type: 'output_audio_buffer.started' })).toBe('speaking');
    expect(activityOf({ type: 'output_audio_buffer.stopped' })).toBeNull();
    expect(activityOf({ type: 'rate_limits.updated' })).toBeUndefined();
  });
});

describe('живой голос: понятные ошибки', () => {
  it('нет подписки, лимит, свои лимиты — предлагают ElevenLabs', () => {
    expect(serverFailure('chatgpt_not_connected', '').text).toMatch(/Войди через ChatGPT/);
    const limit = serverFailure('subscription_limit', 'лимит подписки исчерпан');
    expect(limit.text).toMatch(/Лимит подписки ChatGPT/);
    expect(limit.fallback).toBe(true);
    expect(serverFailure('realtime_limit', 'на сегодня 20 из 20').text).toBe('на сегодня 20 из 20');
    expect(serverFailure('provider_refused', 'unsupported_country_region_territory').code).toBe(
      'region',
    );
  });

  it('OpenAI недоступен из страны — совет про VPN', () => {
    const f = openAiFailure(403, '{"error":{"code":"unsupported_country_region_territory"}}');
    expect(f.code).toBe('region');
    expect(f.text).toMatch(/VPN/);
    expect(openAiFailure(401, '').code).toBe('key');
    expect(openAiFailure(500, '').text).toMatch(/HTTP 500/);
  });

  it('сколько осталось', () => {
    expect(minutesLeft(900)).toBe('15 мин');
    expect(minutesLeft(42.4)).toBe('42 с');
    expect(minutesLeft(-3)).toBe('0 с');
  });
});
