/**
 * Состояние оболочки в памяти: дела недели, «Входящие», документы, включённые помощники.
 * «Сегодня» и Planner смотрят на одни и те же дела, поэтому отметка в одном месте видна в другом.
 */
import type { CompanionKind } from '@qubite/ui';
import { createContext, useContext } from 'react';
import { DOCS, INBOX, makeWeek, newId, type Day, type Doc, type InboxItem } from './data';

export interface State {
  week: Day[];
  inbox: InboxItem[];
  docs: Doc[];
  helpers: Record<CompanionKind, boolean>;
}

export type Action =
  | { type: 'task.toggle'; day: number; id: string; done: boolean }
  | { type: 'task.add'; title: string; time: string | null }
  | { type: 'inbox.add'; text: string }
  | { type: 'inbox.remove'; id: string }
  | { type: 'inbox.later'; id: string }
  | { type: 'doc.add'; name: string }
  | { type: 'helper'; kind: CompanionKind; on: boolean };

export function initialState(now = new Date()): State {
  return {
    week: makeWeek(now),
    inbox: INBOX.map((x) => ({ ...x })),
    docs: DOCS.map((x) => ({ ...x })),
    helpers: { elik: true, proto: true, neit: true, foti: true },
  };
}

export const todayIndex = (s: State) =>
  Math.max(
    0,
    s.week.findIndex((d) => d.today),
  );

export function reducer(s: State, a: Action): State {
  switch (a.type) {
    case 'task.toggle':
      return {
        ...s,
        week: s.week.map((d, i) =>
          i !== a.day
            ? d
            : { ...d, tasks: d.tasks.map((t) => (t.id === a.id ? { ...t, done: a.done } : t)) },
        ),
      };
    case 'task.add': {
      const t = todayIndex(s);
      const task = {
        id: newId('t'),
        title: a.title,
        color: 'orange' as const,
        tag: 'Из Command',
        time: a.time ?? 'без срока',
        done: false,
      };
      return {
        ...s,
        week: s.week.map((d, i) => (i === t ? { ...d, tasks: [task, ...d.tasks] } : d)),
      };
    }
    case 'inbox.add':
      return {
        ...s,
        inbox: [
          {
            id: newId('i'),
            text: a.text,
            src: 'написал',
            from: 'text',
            time: 'сейчас',
            hint: 'разберём, когда будет минутка',
            acts: [
              ['В дела', 'planner'],
              ['В Docs', 'docs'],
            ],
          },
          ...s.inbox,
        ],
      };
    case 'inbox.remove':
      return { ...s, inbox: s.inbox.filter((x) => x.id !== a.id) };
    case 'inbox.later': {
      const it = s.inbox.find((x) => x.id === a.id);
      return it ? { ...s, inbox: [...s.inbox.filter((x) => x.id !== a.id), it] } : s;
    }
    case 'doc.add':
      return {
        ...s,
        docs: [
          {
            id: newId('d'),
            name: a.name,
            pre: 'новая страница — допишешь потом',
            tags: [['sky', 'Конспект']],
            when: 'сейчас',
          },
          ...s.docs,
        ],
      };
    case 'helper':
      return { ...s, helpers: { ...s.helpers, [a.kind]: a.on } };
  }
}

export const StoreCtx = createContext<{ state: State; dispatch: (a: Action) => void } | null>(null);

export function useStore() {
  const v = useContext(StoreCtx);
  if (!v) throw new Error('useStore: оберни в <StoreProvider>');
  return v;
}
