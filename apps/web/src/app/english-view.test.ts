import { describe, expect, it } from 'vitest';
import {
  minutesLabel,
  moodFor,
  phaseLabel,
  pickMime,
  reactionOf,
  scoreLabel,
  toBase64,
  voiceNote,
} from './english-view';

describe('английский: маскот и подписи', () => {
  it('каждой фазе — своё настроение Нейта', () => {
    expect(moodFor('listening')).toBe('listen');
    expect(moodFor('thinking')).toBe('think');
    expect(moodFor('speaking')).toBe('talk');
    expect(moodFor('wrong')).toBe('angry');
    expect(moodFor('right')).toBe('happy');
    expect(moodFor('idle')).toBe('idle');
    expect(phaseLabel('wrong')).toBe('Нейт нашёл ошибку');
  });

  it('реакция: ошибка — сердится, верно или повторил — доволен', () => {
    expect(reactionOf('mistake', false)).toBe('wrong');
    expect(reactionOf('ok', false)).toBe('right');
    expect(reactionOf('none', true)).toBe('right');
    expect(reactionOf('none', false)).toBeNull();
    expect(reactionOf(null, false)).toBeNull();
  });

  it('формат записи — первый, который умеет браузер', () => {
    expect(pickMime((t) => t === 'audio/mp4')).toBe('audio/mp4');
    expect(pickMime(() => true)).toBe('audio/webm;codecs=opus');
    expect(pickMime(() => false)).toBeNull();
  });

  it('base64 совпадает с btoa и не роняет стек на большой записи', () => {
    expect(toBase64(new TextEncoder().encode('OPUS'))).toBe(btoa('OPUS'));
    const big = new Uint8Array(300_000).fill(65);
    expect(toBase64(big).length).toBe(400_000);
  });

  it('итоги и длительность', () => {
    expect(scoreLabel(6, 10)).toBe('верно 6 из 10 (60 %)');
    expect(scoreLabel(0, 0)).toBe('ещё ни одной реплики');
    expect(minutesLabel('2026-10-22T10:00:00Z', '2026-10-22T10:04:10Z')).toBe('5 мин');
    expect(minutesLabel('2026-10-22T10:00:00Z', '2026-10-22T10:00:05Z')).toBe('1 мин');
  });

  it('честно пишет, почему голоса нет', () => {
    expect(voiceNote(false, false, true)).toContain('ElevenLabs');
    expect(voiceNote(true, true, false)).toContain('микрофон');
    expect(voiceNote(true, true, true)).toBeNull();
  });
});
