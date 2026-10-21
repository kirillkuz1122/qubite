import { Editor } from '@tiptap/core';
import Collaboration from '@tiptap/extension-collaboration';
import { TaskItem, TaskList } from '@tiptap/extension-list';
import StarterKit from '@tiptap/starter-kit';
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { seedHtml, slashItems, slashQuery } from './blocks';
import { Pair } from './pair';

describe('Pair: две копии документа', () => {
  it('в сети правка сразу приходит во вторую копию', () => {
    const pair = new Pair();
    pair.docs[0].getText('t').insert(0, 'привет');
    expect(pair.docs[1].getText('t').toString()).toBe('привет');
    expect(pair.same()).toBe(true);
  });

  it('без сети копии расходятся, слияние сохраняет обе правки', () => {
    const pair = new Pair();
    const [a, b] = pair.docs;
    a.getText('t').insert(0, 'граф');
    pair.setOnline(false);
    a.getText('t').insert(0, 'ноут ');
    b.getText('t').insert(4, ' телефон');
    expect(pair.same()).toBe(false);
    pair.merge();
    expect(pair.same()).toBe(true);
    expect(a.getText('t').toString()).toBe('ноут граф телефон');
    expect(b.getText('t').toString()).toBe(a.getText('t').toString());
  });

  it('повторное слияние ничего не меняет, сеть вернулась — копии сливаются сами', () => {
    const pair = new Pair();
    pair.setOnline(false);
    pair.docs[1].getText('t').insert(0, 'офлайн');
    pair.merge();
    const size = pair.size(0);
    pair.merge();
    expect(pair.size(0)).toBe(size);
    pair.docs[0].getText('t').insert(0, '1 ');
    expect(pair.same()).toBe(false);
    pair.setOnline(true);
    expect(pair.docs[1].getText('t').toString()).toBe('1 офлайн');
  });

  it('удаление на одной копии и правка рядом на другой — без потерь', () => {
    const pair = new Pair();
    const [a, b] = pair.docs;
    a.getText('t').insert(0, 'раз два три');
    pair.setOnline(false);
    a.getText('t').delete(4, 4); // «два » ушло
    b.getText('t').insert(11, ' четыре');
    pair.merge();
    expect(a.getText('t').toString()).toBe('раз три четыре');
    expect(b.getText('t').toString()).toBe('раз три четыре');
  });
});

/** Прототип А целиком, без экрана: Tiptap + Yjs в jsdom. */
function tiptap(doc: Y.Doc) {
  return new Editor({
    extensions: [
      StarterKit.configure({ undoRedo: false, link: false }),
      TaskList,
      TaskItem,
      Collaboration.configure({ document: doc }),
    ],
  });
}

describe('прототип А: слияние блоков', () => {
  it('разные блоки с двух копий без сети — оба в документе, порядок одинаковый', () => {
    const pair = new Pair();
    const [a, b] = [tiptap(pair.docs[0]), tiptap(pair.docs[1])];
    a.commands.setContent(seedHtml());
    expect(b.getText()).toContain('Конспект: графы');
    pair.setOnline(false);
    a.commands.insertContentAt(a.state.doc.content.size, '<h2>с ноутбука</h2>');
    b.commands.insertContentAt(
      0,
      '<ul data-type="taskList"><li data-type="taskItem"><p>с телефона</p></li></ul>',
    );
    pair.merge();
    expect(a.getJSON()).toEqual(b.getJSON());
    const json = JSON.stringify(a.getJSON());
    expect(json).toContain('с ноутбука');
    expect(json).toContain('с телефона');
    expect(json).toContain('"type":"taskItem"');
    a.destroy();
    b.destroy();
  });
});

describe('/-меню', () => {
  it('открывается только на «/слово» в пустом блоке', () => {
    expect(slashQuery('/')).toBe('');
    expect(slashQuery('/цит')).toBe('цит');
    expect(slashQuery('текст /цит')).toBeNull();
    expect(slashQuery('/два слова')).toBeNull();
  });
  it('ищет по началу слова на русском и английском', () => {
    expect(slashItems('цит').map((b) => b.kind)).toEqual(['quote']);
    expect(slashItems('code').map((b) => b.kind)).toEqual(['code']);
    expect(slashItems('').length).toBe(8);
  });
});
