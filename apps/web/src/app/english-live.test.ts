import { describe, expect, it } from 'vitest';
import { downsample, nextStart, pcmToFloat, rms, SILENCE_MS, Vad } from './english-live';

describe('английский потоком: звук', () => {
  it('48 кГц → 16 кГц: втрое меньше отсчётов, громкость в Int16', () => {
    const input = new Float32Array(480).fill(0.5);
    const out = downsample(input, 48_000, 16_000);
    expect(out.length).toBe(160);
    expect(out[0]).toBe(Math.floor(0.5 * 0x7fff));
    expect(downsample(new Float32Array(3).fill(-1), 48_000, 16_000)[0]).toBe(-0x8000);
  });

  it('PCM 16 бит → Float32 и громкость', () => {
    const bytes = new ArrayBuffer(4);
    new DataView(bytes).setInt16(0, 0x4000, true);
    new DataView(bytes).setInt16(2, -0x8000, true);
    expect(Array.from(pcmToFloat(bytes))).toEqual([0.5, -1]);
    expect(rms(new Float32Array([0.5, -0.5]))).toBeCloseTo(0.5);
  });

  it('пауза полсекунды — конец фразы; короткий шум — не речь', () => {
    const vad = new Vad(0.02, 150, SILENCE_MS);
    expect(vad.push(0.5, 40, false)).toBeNull(); // 40 мс — ещё не речь
    expect(vad.push(0.0, 200, false)).toBeNull(); // шум забыт
    let started = null;
    for (let i = 0; i < 5; i++) started ??= vad.push(0.3, 40, false);
    expect(started).toBe('start');
    expect(vad.push(0.0, 400, false)).toBeNull(); // пауза короче полсекунды
    expect(vad.push(0.0, 120, false)).toBe('end');
  });

  it('пока говорит репетитор, порог выше: его голос из колонок — не твоя речь', () => {
    const vad = new Vad(0.02, 150);
    for (let i = 0; i < 10; i++) expect(vad.push(0.04, 40, true)).toBeNull();
    let started = null;
    for (let i = 0; i < 5; i++) started ??= vad.push(0.2, 40, true);
    expect(started).toBe('start');
  });

  it('куски голоса встают в очередь без дыр', () => {
    expect(nextStart(1.0, 0)).toBeCloseTo(1.04);
    expect(nextStart(1.0, 1.5)).toBe(1.5);
  });
});
