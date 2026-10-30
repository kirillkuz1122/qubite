import type { components } from '@qubite/api-client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  ahead,
  kindLabel,
  kindLine,
  opportunityWhen,
  siteUrl,
  tasksLine,
  whoLine,
} from './opportunities-view';

type Item = components['schemas']['OpportunityItem'];

const NB = '\u00a0';
const now = new Date('2026-10-20T07:00:00Z');

/** Сервер отдаёт время в UTC (timestamptz), даже если источник писал по Москве. */
function item(over: Partial<Item>): Item {
  return {
    id: 'id',
    account_id: 'acc',
    source: 'codolymp',
    external_id: 'x',
    kind: 'olympiad',
    title: 'Олимпиада',
    subject: '',
    stage: '',
    grades: '',
    registration_until: null,
    starts_at: '2026-11-30T21:00:00Z',
    ends_at: '2026-12-20T20:59:59Z',
    place: '',
    url: 'https://example.org',
    tags: [],
    status: 'suggested',
    why: '',
    created_at: '2026-10-01T00:00:00Z',
    updated_at: '2026-10-01T00:00:00Z',
    ...over,
  };
}

let zone: string | undefined;
beforeAll(() => {
  // время Codeforces показываем в поясе устройства — в тесте это Челябинск
  zone = process.env.TZ;
  process.env.TZ = 'Asia/Yekaterinburg';
});
afterAll(() => {
  if (zone === undefined) delete process.env.TZ;
  else process.env.TZ = zone;
});

describe('даты возможности', () => {
  it('этап «Регистрация» Кодолимпа: только срок регистрации, по Москве', () => {
    // 1–27 октября по Москве: в Челябинске конец — уже 28-е, но писать надо 27-е
    const reg = item({
      stage: 'Регистрация',
      starts_at: '2026-09-30T21:00:00Z',
      ends_at: '2026-10-27T20:59:59Z',
      registration_until: '2026-10-27T20:59:59Z',
    });
    expect(opportunityWhen(reg, now)).toEqual({
      registration: `Регистрация до 27${NB}октября`,
      dates: null,
    });
  });

  it('дни одного месяца, разных месяцев и разных лет', () => {
    expect(opportunityWhen(item({}), now).dates).toBe(`1–20${NB}декабря`);
    const foxford = item({ starts_at: '2026-09-30T21:00:00Z', ends_at: '2026-12-14T20:59:59Z' });
    expect(opportunityWhen(foxford, now).dates).toBe(`1${NB}октября – 14${NB}декабря`);
    const sammat = item({ starts_at: '2026-12-02T21:00:00Z', ends_at: '2027-01-15T20:59:59Z' });
    expect(opportunityWhen(sammat, now).dates).toBe(`3${NB}декабря 2026 – 15${NB}января 2027`);
    const dano = item({ starts_at: '2026-10-31T21:00:00Z', ends_at: '2026-11-01T20:59:59Z' });
    expect(opportunityWhen(dano, now).dates).toBe(`1${NB}ноября`);
  });

  it('следующий год пишется, текущий — нет', () => {
    const united = item({
      source: 'devpost',
      kind: 'hackathon',
      starts_at: '2027-01-08T00:00:00Z',
      ends_at: '2027-01-10T23:59:59Z',
    });
    expect(opportunityWhen(united, now).dates).toBe(`8–10${NB}января 2027`);
  });

  it('Devpost — дни UTC: конец 4 декабря не становится 5-м', () => {
    const kiroween = item({
      source: 'devpost',
      kind: 'hackathon',
      starts_at: '2026-10-30T00:00:00Z',
      ends_at: '2026-12-04T23:59:59Z',
    });
    expect(opportunityWhen(kiroween, now)).toEqual({
      registration: null,
      dates: `30${NB}октября – 4${NB}декабря`,
    });
  });

  it('Codeforces — со временем начала и конца в поясе устройства', () => {
    const round = item({
      source: 'codeforces',
      kind: 'contest',
      starts_at: '2026-11-05T14:35:00Z',
      ends_at: '2026-11-05T16:35:00Z',
    });
    expect(opportunityWhen(round, now).dates).toBe(`5${NB}ноября, 19:35–21:35`);
  });

  it('регистрация отдельно от дат; прошедшая — так и написано', () => {
    const open = item({ registration_until: '2026-10-27T20:59:59Z' });
    expect(opportunityWhen(open, now)).toEqual({
      registration: `Регистрация до 27${NB}октября`,
      dates: `1–20${NB}декабря`,
    });
    const late = new Date('2026-11-02T07:00:00Z');
    expect(opportunityWhen(open, late).registration).toBe(`Регистрация закончилась 27${NB}октября`);
  });

  it('прошедшие не показываем', () => {
    const past = item({ id: 'past', ends_at: '2026-10-19T20:59:59Z' });
    const today = item({ id: 'today', ends_at: '2026-10-20T20:59:59Z' });
    expect(ahead([past, today, item({ id: 'later' })], now).map((i) => i.id)).toEqual([
      'today',
      'later',
    ]);
  });
});

describe('подписи карточки', () => {
  it('вид и этап; этап «Регистрация» не повторяется', () => {
    expect(kindLabel('olympiad')).toBe('олимпиада');
    expect(kindLabel('hackathon')).toBe('хакатон');
    expect(kindLabel('contest')).toBe('соревнование');
    expect(kindLabel('meetup')).toBe('мероприятие');
    expect(kindLine(item({ stage: 'Отборочный этап' }))).toBe('олимпиада · Отборочный этап');
    expect(
      kindLine(item({ stage: 'Регистрация', registration_until: '2026-10-27T20:59:59Z' })),
    ).toBe('олимпиада');
    expect(kindLine(item({ kind: 'hackathon' }))).toBe('хакатон');
  });

  it('класс и предмет; у хакатона — темы', () => {
    expect(whoLine(item({ grades: '8–11 класс', subject: 'математика' }))).toBe(
      '8–11 класс · математика',
    );
    expect(whoLine(item({ tags: ['Machine Learning/AI', 'Open Ended', 'Education'] }))).toBe(
      'Machine Learning/AI, Open Ended',
    );
    expect(whoLine(item({}))).toBe('');
  });

  it('ссылка — только http(s)', () => {
    expect(siteUrl('https://school.hse.ru/olymp?utm_medium=referral')).toBe(
      'https://school.hse.ru/olymp?utm_medium=referral',
    );
    expect(siteUrl('javascript:alert(1)')).toBeNull();
    expect(siteUrl('не адрес')).toBeNull();
  });

  it('итог «Интересно»', () => {
    expect(tasksLine(3)).toBe('Дела поставлены: 3');
    expect(tasksLine(0)).toBe('Дела уже поставлены');
  });
});
