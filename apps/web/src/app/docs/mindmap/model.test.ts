import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { restoreDocVersion } from '@qubite/sync-client';
import {
  addChild,
  addSibling,
  appendOutline,
  findNode,
  MAX_LINKS,
  MAX_MARKDOWN_CHARS,
  MAX_NODE_TEXT,
  initMindmap,
  isMindmap,
  mindmapLinks,
  setLink,
  addLinkChild,
  mindmapUpdate,
  moveNode,
  parentNode,
  readTree,
  removeNode,
  ROOT,
  setColor,
  setFolded,
  setText,
  restoreLostNodes,
  type MindNode,
} from './model';
import { layoutTree, neighbour } from './layout';
import {
  collocationsTemplate,
  mindmapMarkdown,
  outlineRoot,
  parseOutline,
  treeMarkdown,
} from './text';
import { renderDocText, extractDocLinks } from '../render';
import { blocksFromDoc } from '../versions-diff';

const labels = (node: MindNode): unknown => ({
  t: node.text,
  ...(node.children.length ? { k: node.children.map(labels) } : {}),
});

function fresh(root = 'information') {
  const doc = new Y.Doc();
  initMindmap(doc, root);
  return doc;
}

function sync(a: Y.Doc, b: Y.Doc) {
  Y.applyUpdate(b, Y.encodeStateAsUpdate(a, Y.encodeStateVector(b)));
  Y.applyUpdate(a, Y.encodeStateAsUpdate(b, Y.encodeStateVector(a)));
}

describe('mind map: модель в Yjs', () => {
  it('документ становится картой с центром; Tab — дочерний, Enter — соседний сразу после', () => {
    const doc = fresh();
    expect(isMindmap(doc)).toBe(true);
    const noun = addChild(doc, ROOT, 'noun + information');
    const verb = addSibling(doc, noun, 'verb + information');
    const adjective = addSibling(doc, noun, 'adjective + information');
    addChild(doc, noun, 'a piece of ~');
    expect(labels(readTree(doc))).toEqual({
      t: 'information',
      k: [
        { t: 'noun + information', k: [{ t: 'a piece of ~' }] },
        { t: 'adjective + information' },
        { t: 'verb + information' },
      ],
    });
    // Enter у центра: соседей нет — получается ветка.
    addSibling(doc, ROOT, 'examples');
    expect(readTree(doc).children.map((n) => n.text)).toContain('examples');
    expect(findNode(readTree(doc), verb)?.depth).toBe(1);
    expect(findNode(readTree(doc), adjective)?.parent).toBe(ROOT);
  });

  it('цвет: у веток первого уровня авто по порядку, подветки наследуют, свой цвет побеждает', () => {
    const doc = fresh();
    const a = addChild(doc, ROOT, 'a');
    const b = addChild(doc, ROOT, 'b');
    const leaf = addChild(doc, a, 'leaf');
    let tree = readTree(doc);
    expect(findNode(tree, a)?.tone).toBe('sky');
    expect(findNode(tree, b)?.tone).toBe('green');
    expect(findNode(tree, leaf)?.tone).toBe('sky');
    setColor(doc, a, 'peach');
    tree = readTree(doc);
    expect(findNode(tree, leaf)?.tone).toBe('peach');
    expect(tree.tone).toBe('orange');
  });

  it('перенос: нельзя в своё поддерево; ветка переезжает на другую сторону', () => {
    const doc = fresh();
    const a = addChild(doc, ROOT, 'a');
    const b = addChild(doc, a, 'b');
    expect(moveNode(doc, a, b)).toBe(false);
    expect(moveNode(doc, b, ROOT, 0, 'l')).toBe(true);
    const tree = readTree(doc);
    expect(tree.children[0]?.id).toBe(b);
    expect(tree.children[0]?.side).toBe('l');
    expect(moveNode(doc, ROOT, a)).toBe(false);
  });

  it('удаление убирает ветку целиком; центр не удаляется', () => {
    const doc = fresh();
    const a = addChild(doc, ROOT, 'a');
    addChild(doc, a, 'b');
    removeNode(doc, a);
    removeNode(doc, ROOT);
    expect(labels(readTree(doc))).toEqual({ t: 'information' });
    expect(doc.getMap('mindmap').size).toBe(1);
  });

  it('свёрнутая ветка разворачивается, когда в неё добавляют узел', () => {
    const doc = fresh();
    const a = addChild(doc, ROOT, 'a');
    setFolded(doc, a, true);
    expect(findNode(readTree(doc), a)?.folded).toBe(true);
    addChild(doc, a, 'b');
    expect(findNode(readTree(doc), a)?.folded).toBe(false);
  });

  it('офлайн-правки двух устройств сливаются: подписи по буквам, новые узлы с обеих сторон', () => {
    const left = fresh();
    const right = new Y.Doc();
    sync(left, right);
    const node = addChild(left, ROOT, 'useful');
    sync(left, right);
    setText(left, node, 'useful information');
    setText(right, node, 'very useful');
    addChild(right, ROOT, 'справа');
    addChild(left, ROOT, 'слева');
    sync(left, right);
    expect(mindmapMarkdown(left)).toBe(mindmapMarkdown(right));
    expect(findNode(readTree(left), node)?.text).toBe('very useful information');
    expect(readTree(left).children).toHaveLength(3);
  });

  it('родителя удалили, а в него дописали; перенос A в B и B в A — узлы у центра, ничего не потерялось', () => {
    const left = fresh();
    const right = new Y.Doc();
    const a = addChild(left, ROOT, 'a');
    const b = addChild(left, ROOT, 'b');
    sync(left, right);
    removeNode(left, a);
    addChild(right, a, 'дописали');
    moveNode(left, b, ROOT);
    sync(left, right);
    const tree = readTree(left);
    expect(tree.children.map((n) => n.text)).toContain('дописали');

    const x = addChild(left, ROOT, 'x');
    const y = addChild(left, ROOT, 'y');
    sync(left, right);
    moveNode(left, x, y);
    moveNode(right, y, x);
    sync(left, right);
    const after = readTree(right);
    expect(after.children.map((n) => n.text)).toEqual(expect.arrayContaining(['x', 'y']));
    expect(mindmapMarkdown(left)).toBe(mindmapMarkdown(right));
  });

  it('осиротевшая ветка уходит к центру целиком: ребёнок и внук сохраняют связь', () => {
    const left = fresh();
    const right = new Y.Doc();
    const a = addChild(left, ROOT, 'a');
    sync(left, right);
    removeNode(left, a);
    const child = addChild(right, a, 'ребёнок');
    const grandchild = addChild(right, child, 'внук');
    sync(left, right);
    const tree = readTree(left);
    expect(findNode(tree, child)?.depth).toBe(1);
    expect(findNode(tree, grandchild)?.parent).toBe(child);
    expect(findNode(tree, grandchild)?.depth).toBe(2);
  });

  it('равный порядок после офлайн-вставок: соседний узел встаёт ровно после выбранного', () => {
    const left = fresh();
    const right = new Y.Doc();
    sync(left, right);
    const a = addChild(left, ROOT, 'a');
    const b = addChild(right, ROOT, 'b');
    sync(left, right);
    const order = readTree(left).children.map((n) => n.id);
    expect(order).toHaveLength(2);
    const first = order[0]!;
    const c = addSibling(left, first, 'c');
    expect(readTree(left).children.map((n) => n.id)).toEqual([first, c, order[1]]);
    expect([a, b]).toContain(first);
    moveNode(left, c, ROOT, 0);
    expect(readTree(left).children[0]!.id).toBe(c);
  });

  it('массовое добавление больше лимита сервера отклоняется до записи', () => {
    const doc = fresh();
    const items = Array.from({ length: 1800 }, (_, i) => ({
      text: `${i}`.padEnd(300, 'x'),
      children: [],
    }));
    expect(() => appendOutline(doc, ROOT, items)).toThrow(/частями/);
    expect(readTree(doc).children).toHaveLength(0);
  });

  it('замена эмодзи не режет суррогатную пару', () => {
    const doc = fresh();
    const id = addChild(doc, ROOT, 'a 😀 b');
    setText(doc, id, 'a 😁 b');
    expect(findNode(readTree(doc), id)?.text).toBe('a 😁 b');
    setText(doc, id, '😁😀');
    setText(doc, id, '😀😀');
    expect(findNode(readTree(doc), id)?.text).toBe('😀😀');
  });

  it('подпись — одна строка до 300 знаков', () => {
    const doc = fresh();
    const id = addChild(doc, ROOT, 'a\nb');
    expect(findNode(readTree(doc), id)?.text).toBe('a b');
    setText(doc, id, 'x'.repeat(400));
    expect(findNode(readTree(doc), id)?.text).toHaveLength(300);
  });
});

describe('mind map ↔ Markdown', () => {
  it('шаблон collocations → вложенный список, текст документа — тот же список', () => {
    const { root, branches } = collocationsTemplate();
    const doc = new Y.Doc();
    Y.applyUpdate(doc, mindmapUpdate(root, branches));
    const text = mindmapMarkdown(doc);
    expect(text.split('\n').slice(0, 3)).toEqual([
      '- information',
      '  - noun + information',
      '    - a piece of ~',
    ]);
    expect(renderDocText(doc)).toBe(text);
    expect(readTree(doc).children.map((n) => n.side)).toEqual(['r', 'r', 'l']);
  });

  it('импорт: отступ 2 или 4 пробела и табы, нумерация, ссылка @; несколько корней — центр из заголовка', () => {
    const md = [
      '# Information',
      '',
      '1. noun',
      '    * a piece of ~',
      '\t* a source of ~',
      '2. verb',
      '  - [@Урок](qubite://0199a1b2-c3d4-7e5f-8a9b-0123456789ab)',
      'просто абзац',
    ].join('\n');
    const { heading, items } = parseOutline(md);
    expect(heading).toBe('Information');
    expect(items.map((i) => i.text)).toEqual(['noun', 'verb']);
    expect(items[0]!.children.map((i) => i.text)).toEqual(['a piece of ~', 'a source of ~']);
    expect(items[1]!.children[0]!.link?.target).toBe('0199a1b2-c3d4-7e5f-8a9b-0123456789ab');
    expect(outlineRoot(md, 'Документ').root).toBe('Information');
    expect(outlineRoot('- центр\n  - ветка', 'Документ')).toEqual({
      root: 'центр',
      branches: [{ text: 'ветка', children: [] }],
    });
  });

  it('туда и обратно: Markdown карты даёт ту же карту; ссылки идут в links документа', () => {
    const doc = fresh('центр');
    const a = addChild(doc, ROOT, 'ветка');
    appendOutline(doc, a, [
      {
        text: '',
        link: { target: '0199a1b2-c3d4-7e5f-8a9b-0123456789ab', kind: 'calendar.event' },
        children: [],
      },
    ]);
    const links = [
      {
        id: '0199a1b2-c3d4-7e5f-8a9b-0123456789ab',
        type: 'calendar.event' as const,
        title: 'Урок [18.11]',
        deleted: false,
      },
    ];
    const md = mindmapMarkdown(doc, links);
    expect(md).toContain('[@Урок \\[18.11\\]](qubite://0199a1b2-c3d4-7e5f-8a9b-0123456789ab)');
    expect(mindmapLinks(doc)).toEqual(['0199a1b2-c3d4-7e5f-8a9b-0123456789ab']);
    expect(extractDocLinks(doc)).toEqual(['0199a1b2-c3d4-7e5f-8a9b-0123456789ab']);
    const { root, branches } = outlineRoot(md, 'x');
    const copy = new Y.Doc();
    Y.applyUpdate(copy, mindmapUpdate(root, branches));
    expect(treeMarkdown(readTree(copy), links)).toBe(md);
  });
});

describe('mind map: пустые узлы и ссылки', () => {
  it('пустой узел переживает экспорт и импорт: центр → пустой → лист', () => {
    const doc = fresh('центр');
    const empty = addChild(doc, ROOT);
    addChild(doc, empty, 'лист');
    const md = mindmapMarkdown(doc);
    const { root, branches } = outlineRoot(md, 'x');
    expect(branches).toEqual([{ text: '', children: [{ text: 'лист', children: [] }] }]);
    const copy = new Y.Doc();
    Y.applyUpdate(copy, mindmapUpdate(root, branches));
    expect(mindmapMarkdown(copy)).toBe(md);
    expect(parseOutline('- a\n  -\n    - b').items[0]!.children[0]!.text).toBe('');
  });

  it('подписи «[x] done», «[ ]», «\\[x]» и похожая на ссылку переживают экспорт и импорт', () => {
    const doc = fresh('центр');
    const labels = [
      '[x] done',
      '[X]',
      '[ ] todo',
      '[@Урок](qubite://0199a1b2-c3d4-7e5f-8a9b-0123456789ab)',
      '\\[x] done',
      '\\',
      '\\\\path',
      '\\*не список',
    ];
    for (const text of labels) addChild(doc, ROOT, text);
    const { root, branches } = outlineRoot(mindmapMarkdown(doc), 'x');
    const copy = new Y.Doc();
    Y.applyUpdate(copy, mindmapUpdate(root, branches));
    expect(readTree(copy).children.map((n) => [n.text, !!n.link])).toEqual(
      labels.map((text) => [text, false]),
    );
  });

  it('сравнение версий видит замену цели у ссылки с той же подписью', () => {
    const one = fresh();
    const two = fresh();
    appendOutline(one, ROOT, [
      { text: '', link: { target: 'aaaa', kind: 'docs.page' }, children: [] },
    ]);
    appendOutline(two, ROOT, [
      { text: '', link: { target: 'bbbb', kind: 'docs.page' }, children: [] },
    ]);
    expect(blocksFromDoc(one)).not.toEqual(blocksFromDoc(two));
  });
});

describe('mind map: раскладка', () => {
  const size = (node: MindNode) => ({
    w: node.text.length * 8 + 24,
    h: node.depth === 0 ? 46 : 32,
  });

  it('центр в нуле, ветки по сторонам по балансу, закреплённая сторона соблюдается', () => {
    const doc = fresh();
    const a = addChild(doc, ROOT, 'a');
    ['1', '2', '3', '4'].forEach((t) => addChild(doc, a, t));
    const b = addChild(doc, ROOT, 'b');
    const c = addChild(doc, ROOT, 'c');
    const layout = layoutTree(readTree(doc), size);
    const root = layout.boxes.get(ROOT)!;
    expect(root.x + root.w / 2).toBeCloseTo(0, 0);
    expect(layout.boxes.get(a)!.side).toBe('r');
    expect(layout.boxes.get(b)!.side).toBe('l');
    // c уходит туда, где меньше: слева b (32) < справа a (4 листа).
    expect(layout.boxes.get(c)!.side).toBe('l');
    expect(layout.boxes.get(b)!.x + layout.boxes.get(b)!.w).toBe(root.x - 40);
    moveNode(doc, c, ROOT, undefined, 'r');
    expect(layoutTree(readTree(doc), size).boxes.get(c)!.side).toBe('r');
  });

  it('свёрнутая ветка не раскладывает детей; узлы одной стороны не пересекаются', () => {
    const { root, branches } = collocationsTemplate();
    const doc = new Y.Doc();
    Y.applyUpdate(doc, mindmapUpdate(root, branches));
    const tree = readTree(doc);
    const adjective = tree.children[1]!;
    setFolded(doc, adjective.id, true);
    const layout = layoutTree(readTree(doc), size, { gap: 24 });
    expect(layout.boxes.has(adjective.children[0]!.id)).toBe(false);
    const boxes = [...layout.boxes.values()];
    for (const p of boxes)
      for (const q of boxes) {
        if (p === q) continue;
        const overlap = p.x < q.x + q.w && q.x < p.x + p.w && p.y < q.y + q.h && q.y < p.y + p.h;
        expect(overlap, `${p.id} × ${q.id}`).toBe(false);
      }
    expect(layout.edges).toHaveLength(layout.boxes.size - 1);
  });

  it('стрелки: вправо — к ребёнку, вниз — к соседу', () => {
    const doc = fresh();
    const a = addChild(doc, ROOT, 'a');
    const a1 = addChild(doc, a, 'a1');
    const a2 = addChild(doc, a, 'a2');
    const layout = layoutTree(readTree(doc), size);
    expect(neighbour(layout, ROOT, 'right')).toBe(a);
    expect(neighbour(layout, a, 'right')).toBe(a1);
    expect(neighbour(layout, a1, 'down')).toBe(a2);
    expect(neighbour(layout, a, 'left')).toBe(ROOT);
  });
});

describe('mind map: история версий (DOC-004)', () => {
  it('восстановление версии возвращает узлы и вид, подписи — новые Y.Text', () => {
    const doc = fresh();
    const a = addChild(doc, ROOT, 'было');
    const version = Y.encodeStateAsUpdate(doc);
    setText(doc, a, 'стало');
    addChild(doc, ROOT, 'лишнее');
    restoreDocVersion(doc, { ystate: version }, null);
    expect(labels(readTree(doc))).toEqual({ t: 'information', k: [{ t: 'было' }] });
    expect(isMindmap(doc)).toBe(true);
    // После восстановления правка продолжает работать.
    setText(doc, readTree(doc).children[0]!.id, 'снова');
    expect(readTree(doc).children[0]!.text).toBe('снова');
  });
  it('обрезка по лимиту не режет эмодзи пополам', () => {
    const doc = fresh();
    const id = addChild(doc, ROOT, 'x'.repeat(MAX_NODE_TEXT - 1) + '😀');
    const text = findNode(readTree(doc), id)!.text;
    expect(text).toBe('x'.repeat(MAX_NODE_TEXT - 1));
    expect(text.length).toBeLessThanOrEqual(MAX_NODE_TEXT);
  });

  it('импорт Markdown берёт тип ссылки из кэша целей', () => {
    const target = '0199a1b2-c3d4-7e5f-8a9b-0123456789ab';
    const links = [{ id: target, type: 'calendar.event' as const, title: 'Урок', deleted: false }];
    const md = `- центр\n  - [@Урок](qubite://${target})\n  - [@Док](qubite://0199a1b2-c3d4-7e5f-8a9b-0123456789ac)`;
    const { branches } = outlineRoot(md, 'x', links);
    expect(branches.map((b) => b.link?.kind)).toEqual(['calendar.event', 'docs.page']);
  });
  it('массовое добавление не превышает лимит знаков текста сервера', () => {
    const doc = fresh();
    const many = Array.from({ length: 700 }, (_, i) => ({
      text: `${i}`.padEnd(MAX_NODE_TEXT, 'x'),
      children: [],
    }));
    expect(() => appendOutline(doc, ROOT, many)).toThrow(/частями/);
    expect(readTree(doc).children).toHaveLength(0);
    // Половина проходит, и текст карты действительно укладывается в лимит.
    appendOutline(doc, ROOT, many.slice(0, 350));
    expect([...mindmapMarkdown(doc)].length).toBeLessThan(MAX_MARKDOWN_CHARS);
  });
  it('не больше 200 разных ссылок: и при добавлении списка, и по одной', () => {
    const doc = fresh();
    const target = (i: number) => `0199a1b2-c3d4-7e5f-8a9b-${String(i).padStart(12, '0')}`;
    const item = (i: number) => ({
      text: '',
      link: { target: target(i), kind: 'docs.page' as const },
      children: [],
    });
    const many = Array.from({ length: MAX_LINKS + 1 }, (_, i) => item(i));
    expect(() => appendOutline(doc, ROOT, many)).toThrow(/200 разных ссылок/);
    expect(readTree(doc).children).toHaveLength(0);
    appendOutline(doc, ROOT, many.slice(0, MAX_LINKS));
    expect(mindmapLinks(doc)).toHaveLength(MAX_LINKS);
    // Уже существующие цели считаются: ещё одна новая — нельзя, повтор старой — можно.
    expect(() => appendOutline(doc, ROOT, [item(MAX_LINKS)])).toThrow(/200 разных ссылок/);
    expect(() => addLinkChild(doc, ROOT, item(MAX_LINKS).link)).toThrow(/200 разных ссылок/);
    const plain = addChild(doc, ROOT, 'текст');
    expect(() => setLink(doc, plain, item(MAX_LINKS).link)).toThrow(/200 разных ссылок/);
    addLinkChild(doc, ROOT, item(0).link);
    setLink(doc, plain, item(1).link);
    expect(mindmapLinks(doc)).toHaveLength(MAX_LINKS);
    // Замена единственной ссылки на цель — не новая цель сверх лимита: прежняя исчезает.
    const only = readTree(doc).children.find((n) => n.link?.target === target(5))!.id;
    setLink(doc, only, item(MAX_LINKS).link);
    expect(mindmapLinks(doc)).toHaveLength(MAX_LINKS);
    expect(mindmapLinks(doc)).not.toContain(target(5));
    // А цель, на которую ссылаются ещё и другие узлы, остаётся — замена её узла отклоняется.
    expect(() => setLink(doc, plain, item(MAX_LINKS + 1).link)).toThrow(/200 разных ссылок/);
  });
  it('обычная правка и новые узлы тоже не перерастают лимит текста карты', () => {
    const doc = fresh();
    const many = Array.from({ length: 640 }, () => ({ text: '', children: [] }));
    const ids = appendOutline(doc, ROOT, many);
    const long = 'x'.repeat(MAX_NODE_TEXT);
    for (const id of ids) setText(doc, id, long);
    const chars = [...mindmapMarkdown(doc)].length;
    expect(chars).toBeLessThanOrEqual(MAX_MARKDOWN_CHARS);
    // Часть подписей обрезана, а не потеряна целиком; укоротить можно всегда.
    expect(readTree(doc).children.at(-1)!.text.length).toBeLessThan(MAX_NODE_TEXT);
    setText(doc, ids[0]!, 'коротко');
    expect(findNode(readTree(doc), ids[0]!)!.text).toBe('коротко');
    // На пределе новый узел не создаётся — объясняем почему.
    for (const id of ids) setText(doc, id, long);
    expect(() => addChild(doc, ROOT, 'ещё')).toThrow(/на пределе/);
    expect(() => addSibling(doc, ids[0]!, 'ещё')).toThrow(/на пределе/);
  });
  it('потерянные подписи возвращаются под уцелевшего предка, иначе под центр', () => {
    const doc = fresh();
    const branch = addChild(doc, ROOT, 'ветка');
    const made = restoreLostNodes(doc, [
      { text: 'лист — дописка', kind: 'mindmap', after: 'ветка', parent: branch },
      { text: 'сирота', kind: 'mindmap', after: null, parent: 'нет-такого' },
      { text: 'обычный текст', kind: 'text', after: null },
    ]);
    expect(made).toHaveLength(2);
    const tree = readTree(doc);
    expect(findNode(tree, branch)!.children.map((n) => n.text)).toEqual(['лист — дописка']);
    expect(tree.children.map((n) => n.text)).toEqual(['ветка', 'сирота']);
  });
  it('перенос ветки глубже не перерастает лимит текста из-за отступов', () => {
    const doc = fresh();
    const branch = addChild(doc, ROOT, 'ветка');
    appendOutline(
      doc,
      branch,
      Array.from({ length: 650 }, (_, i) => ({ text: `${i}`.padEnd(270, 'x'), children: [] })),
    );
    let end = ROOT;
    for (let i = 0; i < 20; i++) end = addChild(doc, end, '');
    const before = [...mindmapMarkdown(doc)].length;
    expect(() => moveNode(doc, branch, end)).toThrow(/на пределе/);
    expect([...mindmapMarkdown(doc)].length).toBe(before);
    expect(parentNode(readTree(doc), branch)!.id).toBe(ROOT);
    // Неглубокий перенос укладывается; перенос выше — всегда можно.
    const near = addChild(doc, ROOT, 'рядом');
    expect(moveNode(doc, branch, near)).toBe(true);
    expect(moveNode(doc, branch, ROOT)).toBe(true);
  });
});
