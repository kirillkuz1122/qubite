import { $getRoot, createEditor } from 'lexical';
import { describe, expect, it } from 'vitest';
import { $appendMarkdown, $exportMarkdown, $importMarkdown, DOC_NODES } from './markdown';
import { $restoreLost } from './restore';

function editor() {
  return createEditor({
    nodes: DOC_NODES,
    onError: (error) => {
      throw error;
    },
  });
}

describe('возврат текста документа', () => {
  it.each([null, 'Перед'])(
    'последовательные блоки с якорем %s сохраняют порядок',
    (after) => {
      const e = editor();
      e.update(
        () => {
          $importMarkdown('Перед\nПосле');
          $restoreLost([
            { text: 'Первый', kind: 'quote', after },
            { text: 'Второй', kind: 'h2', after },
            { text: 'Третий', kind: 'p', after },
          ]);
        },
        { discrete: true },
      );
      expect(
        e.getEditorState().read(() =>
          $getRoot()
            .getChildren()
            .map((node) => node.getTextContent()),
        ),
      ).toEqual(
        after === null
          ? ['Первый', 'Второй', 'Третий', 'Перед', 'После']
          : ['Перед', 'Первый', 'Второй', 'Третий', 'После'],
      );
    },
  );

  it('разные якоря и совпадающий с якорем текст не меняют порядок', () => {
    const e = editor();
    e.update(
      () => {
        $importMarkdown('Перед\nСередина\nПосле');
        $restoreLost([
          { text: 'Середина', kind: 'p', after: 'Перед' },
          { text: 'A', kind: 'p', after: 'Перед' },
          { text: 'Б', kind: 'p', after: 'Середина' },
          { text: 'В', kind: 'p', after: 'Середина' },
        ]);
      },
      { discrete: true },
    );
    expect(
      e.getEditorState().read(() =>
        $getRoot()
          .getChildren()
          .map((node) => node.getTextContent()),
      ),
    ).toEqual(['Перед', 'Середина', 'A', 'Середина', 'Б', 'В', 'После']);
  });

  it('recovered добавляется в конец с сохранением Markdown и существующих блоков', () => {
    const e = editor();
    e.update(
      () => {
        $importMarkdown('# С сервера\nПервый текст');
        const key = $getRoot().getFirstChildOrThrow().getKey();
        $appendMarkdown('## Мой вариант\n**Не потерять**');
        expect($getRoot().getFirstChildOrThrow().getKey()).toBe(key);
      },
      { discrete: true },
    );
    const result = e.getEditorState().read($exportMarkdown);
    expect(result.indexOf('# С сервера')).toBeLessThan(result.indexOf('## Мой вариант'));
    expect(result).toContain('Первый текст');
    expect(result).toContain('**Не потерять**');
  });
});
