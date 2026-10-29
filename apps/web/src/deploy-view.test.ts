import { describe, expect, it } from 'vitest';
import { builtLine, deployWhen, rollbackLine, updatedLine, versionLine } from './deploy-view';

// Местное время: ожидания не зависят от часового пояса машины с тестами.
const builtAt = new Date(2026, 9, 29, 10, 0).toISOString();
const deployedAt = new Date(2026, 9, 29, 11, 0).toISOString();
const rollback = { from: 'fedcba987654', to: '0123456789ab', at: deployedAt };

describe('подписи выкладки', () => {
  it('добавляет коммит к версии, если он известен', () => {
    expect(versionLine('0.1.0', '0123456789ab')).toBe('0.1.0 · 0123456789ab');
  });

  it('оставляет только версию без коммита', () => {
    expect(versionLine('0.1.0', null)).toBe('0.1.0');
    expect(versionLine('0.1.0')).toBe('0.1.0');
  });

  it('показывает сборку и выкладку в местном времени браузера', () => {
    expect(builtLine(builtAt)).toBe('собрано 29.10 в 10:00');
    expect(updatedLine(deployedAt)).toBe('обновлено 29.10 в 11:00');
  });

  it('не придумывает время, если сервер его не знает', () => {
    expect(deployWhen(null)).toBeNull();
    expect(updatedLine(null)).toBeNull();
    expect(builtLine(null)).toBeNull();
    expect(updatedLine(undefined)).toBeNull();
    expect(builtLine('invalid')).toBeNull();
  });

  it('показывает откат с причиной', () => {
    expect(rollbackLine({ ...rollback, reason: 'миграции упали' })).toBe(
      'Откат с fedcba987654 на 0123456789ab · 29.10 в 11:00 · миграции упали',
    );
  });

  it('не добавляет пустой хвост без причины отката', () => {
    const line = 'Откат с fedcba987654 на 0123456789ab · 29.10 в 11:00';
    expect(rollbackLine(rollback)).toBe(line);
    expect(rollbackLine({ ...rollback, reason: '' })).toBe(line);
    expect(rollbackLine({ ...rollback, reason: null })).toBe(line);
  });

  it('не показывает пометку, если отката нет', () => {
    expect(rollbackLine(null)).toBeNull();
    expect(rollbackLine(undefined)).toBeNull();
  });
});
