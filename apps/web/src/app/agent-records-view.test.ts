import { describe, expect, it } from 'vitest';
import {
  channelLabel,
  fileName,
  skillUse,
  tree,
  usage,
  type AgentFileInfo,
} from './agent-records-view';
import { diffLines, lineDiff, type AgentChange } from './agent-view';

function file(
  path: string,
  kind: string,
  chars = 10,
  limit = 2200,
  archived = false,
): AgentFileInfo {
  return {
    id: path,
    path,
    kind,
    chars,
    limit,
    revision: 1,
    updated_at: '2026-10-20T08:00:00Z',
    pinned: false,
    archived,
  } as AgentFileInfo;
}

describe('папка агента', () => {
  it('дерево: ядро, о тебе, память и свои файлы сверху, потом проекты и навыки', () => {
    const folders = tree([
      file('Навыки/ДЗ по русскому.md', 'skill'),
      file('Проекты/Алгебра.md', 'project'),
      file('Расписание.md', 'file'),
      file('Память.md', 'memory'),
      file('Олимпиады/Темы.md', 'file'),
      file('Кто я.md', 'core'),
      file('Проекты/Английский.md', 'project'),
      file('О тебе.md', 'user'),
    ]);
    expect(folders.map((f) => f.name)).toEqual(['', 'Проекты', 'Навыки', 'Олимпиады']);
    expect(folders[0]!.files.map((f) => fileName(f.path))).toEqual([
      'Кто я',
      'О тебе',
      'Память',
      'Расписание',
    ]);
    expect(folders[1]!.files.map((f) => fileName(f.path))).toEqual(['Алгебра', 'Английский']);
  });

  it('навыки в архиве — отдельной папкой под «Навыками»', () => {
    const folders = tree([
      file('Навыки/Сходить куда-то.md', 'skill', 10, 6000, true),
      file('Навыки/ДЗ к уроку.md', 'skill'),
      file('Память.md', 'memory'),
    ]);
    expect(folders.map((f) => f.name)).toEqual(['', 'Навыки', 'Архив навыков']);
    expect(folders[2]!.files.map((f) => fileName(f.path))).toEqual(['Сходить куда-то']);
  });

  it('как навыком пользуются и что сделает куратор', () => {
    const base = {
      uses: 3,
      last_used: '2026-10-12T10:00:00Z',
      archive_after: '2026-11-11T10:00:00Z',
      pinned: false,
      archived: false,
    };
    expect(skillUse(base)).toBe(
      'пользовался 3 раза, последний — 12.10 · в архив после 11.11, если не понадобится',
    );
    expect(skillUse({ ...base, uses: 0, pinned: true, archive_after: null })).toBe(
      'ещё не пользовался · закреплён: куратор не трогает',
    );
    expect(skillUse({ ...base, uses: 5, archived: true, archive_after: null })).toBe(
      'пользовался 5 раз, последний — 12.10 · в архиве: агент его не видит',
    );
  });

  it('сколько места и «почти полон»', () => {
    expect(usage({ chars: 1200, limit: 2200 })).toEqual({
      label: '1 200 из 2 200 знаков',
      full: false,
    });
    expect(usage({ chars: 1800, limit: 2200 }).full).toBe(true);
  });

  it('подписи канала разговора', () => {
    expect(channelLabel('telegram')).toBe('Telegram');
    expect(channelLabel('fix')).toBe('«Поправить»');
    expect(channelLabel('web')).toBeNull();
  });
});

describe('лента: правка файла агента построчно', () => {
  it('убранные и добавленные строки, без одинаковых', () => {
    expect(lineDiff('# Память\n- А\n- Б\n', '# Память\n- А\n- В\n')).toEqual({
      removed: ['- Б'],
      added: ['- В'],
    });
    const change = {
      object_id: 'f1',
      object_type: 'agent.file',
      title: 'Память.md',
      created: false,
      diff: [{ field: 'body', before: '- русский по ср\n', after: '- русский по вт и чт\n' }],
    } as unknown as AgentChange;
    expect(diffLines(change, () => undefined)).toEqual([
      { label: '−', before: '- русский по ср', after: '', line: 'removed' },
      { label: '+', before: '', after: '- русский по вт и чт', line: 'added' },
    ]);
  });
});
