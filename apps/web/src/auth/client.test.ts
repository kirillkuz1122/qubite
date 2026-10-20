import { describe, expect, it } from 'vitest';
import {
  deviceName,
  oauthError,
  providerHref,
  safePath,
  shownProviders,
  untilText,
  type PlatformStatus,
} from './client';

const status = (over: Partial<PlatformStatus> = {}): PlatformStatus => ({
  login_enabled: true,
  login_methods: { password: true, yandex: true, vk: false, google: true, telegram: false },
  maintenance: false,
  registration_mode: 'invite_only',
  timezone: 'Asia/Yekaterinburg',
  ...over,
});

describe('Qubite Auth: помощники', () => {
  it('возврат после входа — только на этот сайт', () => {
    expect(safePath('/inbox')).toBe('/inbox');
    expect(safePath('//evil.example')).toBe('/home');
    expect(safePath('/\\evil.example')).toBe('/home');
    expect(safePath('https://evil.example')).toBe('/home');
    expect(safePath('/a\nb')).toBe('/home');
    expect(safePath(undefined)).toBe('/home');
  });

  it('провайдер виден, только если настроен на сервере и включён owner', () => {
    const list = [
      { id: 'yandex', kind: 'redirect' },
      { id: 'vk', kind: 'redirect' },
    ];
    expect(shownProviders(list, status()).map((p) => p.id)).toEqual(['yandex']);
    expect(shownProviders(list, status({ login_enabled: false }))).toEqual([]);
    expect(shownProviders(undefined, status())).toEqual([]);
  });

  it('ссылка входа через провайдера несёт адрес возврата и приглашение', () => {
    expect(providerHref('vk', '/today', '7KQ2-M9XD-4TPR')).toBe(
      '/api/auth/oauth/vk/login?return_to=%2Ftoday&invite=7KQ2-M9XD-4TPR',
    );
  });

  it('ошибки входа через провайдера — по-человечески', () => {
    expect(oauthError('oauth_not_linked', 'vk')).toContain('VK ID ещё не привязан');
    expect(oauthError('pass_invalid', '')).toContain('одноразовая');
    expect(oauthError('что-то новое', '')).toBe('Не получилось войти. Попробуйте ещё раз.');
  });

  it('устройство в списке сессий — коротко', () => {
    const s = {
      id: '1',
      current: false,
      kind: 'web',
      device_name: '',
      ip: '',
      created_at: '',
      last_seen_at: '',
      expires_at: '',
      user_agent: 'Mozilla/5.0 (Android 14; Mobile; rv:140.0) Gecko/140.0 Firefox/140.0',
    };
    expect(deviceName(s)).toBe('Firefox на Android');
    expect(deviceName({ ...s, kind: 'device', device_name: 'Xiaoxin Pad' })).toBe('Xiaoxin Pad');
    expect(deviceName({ ...s, user_agent: '' })).toBe('Браузер');
  });

  it('«вернёмся к» — по поясу платформы: сегодня, завтра или дата', () => {
    const now = new Date('2026-10-19T03:00:00Z'); // 08:00 в Екатеринбурге
    const tz = 'Asia/Yekaterinburg';
    expect(untilText('2026-10-19T05:00:00Z', tz, now)).toBe('10:00');
    expect(untilText('2026-10-20T05:00:00Z', tz, now)).toBe('завтра, 10:00');
    expect(untilText('2026-10-22T05:00:00Z', tz, now)).toBe('22 октября, 10:00');
    // тот же момент в Москве — на два часа раньше
    expect(untilText('2026-10-19T05:00:00Z', 'Europe/Moscow', now)).toBe('08:00');
  });
});
