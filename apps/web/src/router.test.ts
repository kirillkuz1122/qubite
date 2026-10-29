import { describe, expect, it } from 'vitest';
import { router } from './router';

describe('адрес аккаунта', () => {
  it('открывается внутри защищённого приложения, как Настройки', () => {
    const account = router.routesByPath['/account'];
    const settings = router.routesByPath['/settings'];
    expect(account.parentRoute).toBe(settings.parentRoute);
    expect(account.parentRoute.id).toBe('/app');
  });

  it('сохраняет параметр успешной привязки входа', () => {
    const validate = router.routesByPath['/account'].options.validateSearch;
    expect(typeof validate).toBe('function');
    if (typeof validate === 'function') {
      expect(validate({ linked: 'yandex' })).toEqual({ linked: 'yandex' });
      expect(validate({})).toEqual({});
    }
  });
});
