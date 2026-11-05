import type { DocLink } from '@qubite/sync-client';
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { extractDocLinks, markdownToYUpdate, renderDocText } from './render';

const target = '11111111-1111-4111-8111-111111111111';
const links: DocLink[] = [{ id: target, type: 'planner.task', title: 'Завтра', deleted: false }];

describe('Markdown → Yjs → Markdown без экрана', () => {
  it.each([
    '',
    '# Заголовок\n## Подзаголовок',
    '- первый\n  - вложенный\n1. номер',
    '- [x] готово\n- [ ] сделать',
    '> цитата',
    '```\nconst x = 1;\n\n// строка\n```',
    '**важно** и *курсив* и ~~нет~~ и `код`',
    `Смотри [@Завтра](qubite://${target})`,
  ])('сохраняет %j', (markdown) => {
    const doc = new Y.Doc();
    try {
      const update = markdownToYUpdate(markdown, links);
      Y.applyUpdate(doc, update);
      expect(renderDocText(doc, links)).toBe(markdown);
      Y.applyUpdate(doc, update);
      expect(renderDocText(doc, links)).toBe(markdown);
    } finally {
      doc.destroy();
    }
  });

  it('без кэша сохраняет UUID упоминания', () => {
    const doc = new Y.Doc();
    try {
      Y.applyUpdate(doc, markdownToYUpdate(`[@Название](qubite://${target})`));
      expect(extractDocLinks(doc)).toEqual([target]);
      expect(renderDocText(doc)).toBe(`[@](qubite://${target})`);
    } finally {
      doc.destroy();
    }
  });
});
