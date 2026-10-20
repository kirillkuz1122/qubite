import { describe, expect, it } from 'vitest';
import { messages, todayLine, windowsLine } from './pace-view';

describe('вкладка «Когда писать»', () => {
  it('склоняет «сообщение»', () => {
    expect([1, 2, 5, 11, 21, 22].map(messages)).toEqual([
      '1 сообщение',
      '2 сообщения',
      '5 сообщений',
      '11 сообщений',
      '21 сообщение',
      '22 сообщения',
    ]);
  });

  it('пишет, сколько осталось и почему молчит', () => {
    expect(todayLine({ mode: 'auto', limit: 3, sent: 1, quiet: null })).toBe(
      'Сегодня написал 1 из 3 — столько он сейчас считает уместным.',
    );
    expect(todayLine({ mode: 'count', limit: 2, sent: 2, quiet: 'ночь' })).toBe(
      'Сегодня написал 2 из 2. Сейчас молчит: ночь.',
    );
    expect(todayLine({ mode: 'off', limit: 0, sent: 0, quiet: null })).toContain('первым не пишет');
  });

  it('показывает свободные окна', () => {
    expect(windowsLine([])).toBe('Свободных окон до конца дня не видно.');
    expect(
      windowsLine([
        { from: '15:00', to: '17:00', minutes: 120 },
        { from: '18:30', to: '23:00', minutes: 270 },
      ]),
    ).toBe('Свободно сегодня: 15:00–17:00, 18:30–23:00.');
  });
});
