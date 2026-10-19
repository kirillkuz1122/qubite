import { describe, expect, it } from 'vitest';
import type { SettingItem } from '../platform/owner';
import {
  changes,
  current,
  draftStore,
  edit,
  loadDraft,
  reconcile,
  resolve,
  saveDraft,
  shown,
} from './draft';

const item = (key: string, value: unknown, version = 1): SettingItem =>
  ({ key, value, default: value, version, locked_by_env: false }) as SettingItem;

describe('черновик Owner Console', () => {
  it('копит изменения; вернул как было — изменение пропадает', () => {
    const vk = item('login.methods.vk', true, 3);
    let d = edit({}, vk, false);
    expect(changes(d)).toEqual([{ key: vk.key, base: true, version: 3, value: false }]);
    expect(current(d, vk)).toBe(false);
    d = edit(d, vk, true);
    expect(changes(d)).toEqual([]);
  });

  it('потерялся ответ «сохранено» — пакет не применяется дважды', () => {
    const mode = item('registration.mode', 'invite_only', 1);
    const d = edit({}, mode, 'open');
    // на сервере уже 'open' версии 2 — значит, это мы и сохранили
    const r = reconcile(d, [item('registration.mode', 'open', 2)]);
    expect(changes(r.draft)).toEqual([]);
    expect(r.conflicts).toEqual([]);
  });

  it('другая вкладка поменяла то же — три значения и выбор', () => {
    const mode = item('registration.mode', 'invite_only', 1);
    const d = edit({}, mode, 'open');
    const r = reconcile(d, [item('registration.mode', 'closed', 2)]);
    expect(r.conflicts).toHaveLength(1);
    const c = r.conflicts[0]!;
    expect([c.base, c.current, c.value]).toEqual(['invite_only', 'closed', 'open']);
    const mine = resolve(r.draft, c, true);
    expect(mine['registration.mode']).toMatchObject({ value: 'open', version: 2, base: 'closed' });
    expect(changes(resolve(r.draft, c, false))).toEqual([]);
  });

  it('хранится у каждого owner своё, только известные тумблеры', () => {
    const d = edit({}, item('email.enabled', true), false);
    saveDraft('owner-1', d);
    expect(loadDraft('owner-1')).toEqual(d);
    expect(loadDraft('owner-2')).toEqual({});
    localStorage.setItem(draftStore('owner-3'), JSON.stringify({ password: { value: 'x' } }));
    expect(loadDraft('owner-3')).toEqual({});
    saveDraft('owner-1', {});
    expect(localStorage.getItem(draftStore('owner-1'))).toBeNull();
  });

  it('значения — словами', () => {
    expect(shown(true)).toBe('включён');
    expect(shown('invite_only')).toBe('по приглашениям');
    expect(shown('off')).toBe('выключена');
    expect(shown('Europe/Moscow')).toBe('Europe/Moscow');
  });
});
