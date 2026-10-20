/**
 * Папка агента (AGT-001): как показать файлы человеку — дерево по папкам, имена без `.md`,
 * сколько места занято. Только преобразования, без запросов (их делает `agent-records.ts`).
 */
import type { components } from '@qubite/api-client';

type S = components['schemas'];
export type AgentFileInfo = S['AgentFileInfo'];
export type AgentFileList = S['AgentFileList'];
export type AgentFile = S['AgentFile'];
export type AgentMessage = S['AgentMessage'];
export type AgentChat = S['AgentChat'];
export type AgentQuestion = S['AgentQuestion'];
export type AgentQuestions = S['AgentQuestions'];

/** «Проекты/Алгебра.md» → «Алгебра». */
export function fileName(path: string): string {
  const name = path.split('/').pop() ?? path;
  return name.replace(/\.md$/i, '');
}

export interface Folder {
  /** `''` — верхний уровень. */
  name: string;
  files: AgentFileInfo[];
}

const FOLDER_ORDER = ['', 'Проекты', 'Навыки'];

/**
 * Дерево: сверху «Кто я», «О тебе», «Память» и свои файлы агента, потом «Проекты», «Навыки» и
 * другие папки. Внутри папки — по имени.
 */
export function tree(files: AgentFileInfo[]): Folder[] {
  const folders = new Map<string, AgentFileInfo[]>();
  for (const f of files) {
    const slash = f.path.indexOf('/');
    const folder = slash < 0 ? '' : f.path.slice(0, slash);
    folders.set(folder, [...(folders.get(folder) ?? []), f]);
  }
  const rank = (kind: string) => ['core', 'user', 'memory'].indexOf(kind);
  const order = (name: string) => {
    const i = FOLDER_ORDER.findIndex((n) => n.toLowerCase() === name.toLowerCase());
    return i < 0 ? FOLDER_ORDER.length : i;
  };
  return [...folders.entries()]
    .map(([name, list]) => ({
      name,
      files: [...list].sort((a, b) => {
        const ra = rank(a.kind);
        const rb = rank(b.kind);
        if (ra !== rb) return (ra < 0 ? 9 : ra) - (rb < 0 ? 9 : rb);
        return fileName(a.path).localeCompare(fileName(b.path), 'ru');
      }),
    }))
    .sort((a, b) => order(a.name) - order(b.name) || a.name.localeCompare(b.name, 'ru'));
}

/** «1 200 из 2 200 знаков» и «почти полон» (от 80 %). */
export function usage(f: Pick<AgentFileInfo, 'chars' | 'limit'>): { label: string; full: boolean } {
  const n = (x: number) => x.toLocaleString('ru-RU');
  return {
    label: `${n(f.chars)} из ${n(f.limit)} знаков`,
    full: f.limit > 0 && f.chars / f.limit >= 0.8,
  };
}

/** Подпись вида файла в шапке. */
export function kindLabel(kind: string): string {
  switch (kind) {
    case 'core':
      return 'ядро агента';
    case 'user':
      return 'о тебе';
    case 'memory':
      return 'память: факты и оглавление';
    case 'project':
      return 'память проекта';
    case 'skill':
      return 'навык (SKILL.md)';
    default:
      return 'файл агента';
  }
}

/** Где агент ответил: подпись у сообщения. */
export function channelLabel(channel: string): string | null {
  switch (channel) {
    case 'telegram':
      return 'Telegram';
    case 'fix':
      return '«Поправить»';
    case 'question':
      return 'ответ на вопрос';
    default:
      return null;
  }
}
