import { describe, expect, it } from 'vitest';
import {
  agentCounts,
  agentMeta,
  ago,
  cacheLabel,
  duration,
  limitTone,
  litDots,
  resetLine,
  tokens,
  usd,
  weekdayShort,
  type PultAgent,
} from './pult';

const agent = (over: Partial<PultAgent>): PultAgent => ({
  key: 'gh-1',
  title: 'DS-013 — панель',
  status: 'running',
  place: 'cloud',
  source: 'облако',
  updated_at: '2026-11-17T10:00:00Z',
  ...over,
});

describe('подписи Пульта', () => {
  it('цвет лимита и LOW по D-953', () => {
    expect(limitTone(62)).toBe('green');
    expect(limitTone(40)).toBe('green');
    expect(limitTone(39.9)).toBe('yellow');
    expect(limitTone(15)).toBe('yellow');
    expect(limitTone(12)).toBe('red');
  });

  it('шкала: хоть немного осталось — хоть одна точка', () => {
    expect(litDots(62, 24)).toBe(15);
    expect(litDots(1, 24)).toBe(1);
    expect(litDots(0, 24)).toBe(0);
    expect(litDots(140, 10)).toBe(10);
  });

  it('токены и доллары по-русски', () => {
    expect(tokens(41_300_000)).toBe('41,3 млн');
    expect(tokens(18_400)).toBe('18 тыс.');
    expect(tokens(950)).toBe('950');
    expect(usd(4.1)).toBe('$4,10');
    expect(usd(123.4)).toBe('$123');
    expect(usd(null)).toBe('—');
  });

  it('время: назад и длительность', () => {
    const now = new Date('2026-11-17T12:00:00Z');
    expect(ago('2026-11-17T11:55:00Z', now)).toBe('5 мин назад');
    expect(ago('2026-11-17T09:00:00Z', now)).toBe('3 ч назад');
    expect(ago('2026-11-16T09:00:00Z', now)).toBe('вчера');
    expect(duration(38)).toBe('38 мин');
    expect(duration(128)).toBe('2 ч 08 мин');
  });

  it('подпись лимита: сброс сегодня — «через», неделя — день и «хватит до»', () => {
    const now = new Date(2026, 10, 17, 12, 0);
    const five = resetLine(
      {
        left: 62,
        low: false,
        resets_at: new Date(2026, 10, 17, 14, 8).toISOString(),
        runs_out_at: null,
      },
      now,
    );
    expect(five).toBe('сброс в 14:08 · через 2 ч 08 мин');
    const week = resetLine(
      {
        left: 12,
        low: true,
        // пятница 03:00, кончится в четверг
        resets_at: new Date(2026, 10, 20, 3, 0).toISOString(),
        runs_out_at: new Date(2026, 10, 19, 9, 0).toISOString(),
      },
      now,
    );
    expect(week).toBe('сброс в пятницу 03:00 · хватит примерно до четверга');
  });

  it('день недели для столбика расхода', () => {
    expect(weekdayShort('2026-11-17')).toBe('Вт');
    expect(weekdayShort('2026-11-11')).toBe('Ср');
  });

  it('строка агента и кэш', () => {
    const a = agent({
      model: 'Opus 5.5',
      effort: 'xhigh',
      minutes: 38,
      pr: { number: 247, url: 'u' },
    });
    expect(agentMeta(a, false)).toBe('Opus 5.5 · xhigh · 38 мин · PR #247');
    expect(agentMeta(agent({ status: 'waiting' }), true)).toBe('ждёт тебя · облако');
    expect(cacheLabel({ warm: true, minutes_left: 3 }, false)).toBe('тёплый кэш');
    expect(cacheLabel({ warm: true, minutes_left: 3 }, true)).toBe('тёплый · остынет через 3 мин');
    expect(cacheLabel({ warm: false, minutes_left: 0 }, false)).toBe('холодный кэш');
    expect(cacheLabel(null, false)).toBeNull();
  });

  it('счётчики фильтра', () => {
    const list = [
      agent({ status: 'waiting' }),
      agent({ status: 'running' }),
      agent({ status: 'running' }),
      agent({ status: 'idle' }),
    ];
    expect(agentCounts(list)).toEqual({ all: 4, waiting: 1, running: 2, done: 0 });
  });
});
