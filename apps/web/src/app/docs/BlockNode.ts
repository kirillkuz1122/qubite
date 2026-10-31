import {
  $applyNodeReplacement,
  ParagraphNode,
  setDOMUnmanaged,
  type ElementDOMSlot,
  type LexicalNode,
  type NodeKey,
  type RangeSelection,
  type SerializedParagraphNode,
} from 'lexical';

export const BLOCK_KINDS = ['p', 'h1', 'h2', 'ul', 'ol', 'todo', 'quote', 'code'] as const;
export type BlockKind = (typeof BLOCK_KINDS)[number];
export type SerializedBlockNode = SerializedParagraphNode & { kind: BlockKind; checked: boolean };

/** Плоский блок: Yjs меняет свойства, сохраняя общий текст и ключ узла. */
export class BlockNode extends ParagraphNode {
  __kind: BlockKind;
  __checked: boolean;

  static override getType(): string {
    return 'qubite-block';
  }

  static override clone(node: BlockNode): BlockNode {
    return new BlockNode(node.__kind, node.__checked, node.__key);
  }

  constructor(kind: BlockKind = 'p', checked = false, key?: NodeKey) {
    super(key);
    this.__kind = kind;
    this.__checked = checked;
  }

  getKind(): BlockKind {
    return this.getLatest().__kind;
  }

  setKind(kind: BlockKind): this {
    this.getWritable().__kind = kind;
    return this;
  }

  getChecked(): boolean {
    return this.getLatest().__checked;
  }

  setChecked(checked: boolean): this {
    this.getWritable().__checked = checked;
    return this;
  }

  override setIndent(indent: number): this {
    return super.setIndent(Math.max(0, Math.min(4, Math.trunc(indent))));
  }

  override createDOM(): HTMLElement {
    const dom = document.createElement('div');
    const accessory = document.createElement('div');
    accessory.className = 'docs-block-accessory';
    accessory.contentEditable = 'false';
    // Галочку туда кладёт React: Lexical не должен её вычищать.
    setDOMUnmanaged(accessory);
    const content = document.createElement('div');
    content.className = 'docs-block-content';
    dom.append(accessory, content);
    this.updateBlockDOM(dom);
    return dom;
  }

  override getDOMSlot(element: HTMLElement): ElementDOMSlot<HTMLElement> {
    return super.getDOMSlot(element).withElement(element.lastElementChild as HTMLElement);
  }

  override updateDOM(_previous: ParagraphNode, dom: HTMLElement): boolean {
    this.updateBlockDOM(dom);
    return false;
  }

  private updateBlockDOM(dom: HTMLElement) {
    const kind = this.getKind();
    dom.className = 'docs-block';
    dom.dataset.kind = kind;
    dom.dataset.checked = String(this.getChecked());
    dom.dataset.indent = String(this.getIndent());
    if (kind === 'h1' || kind === 'h2') {
      dom.setAttribute('role', 'heading');
      dom.setAttribute('aria-level', kind === 'h1' ? '1' : '2');
    } else {
      dom.removeAttribute('role');
      dom.removeAttribute('aria-level');
    }
  }

  override exportJSON(): SerializedBlockNode {
    return { ...super.exportJSON(), kind: this.getKind(), checked: this.getChecked() };
  }

  static override importJSON(value: SerializedBlockNode): BlockNode {
    const kind = BLOCK_KINDS.includes(value.kind) ? value.kind : 'p';
    return $createBlockNode(kind).updateFromJSON(value).setChecked(!!value.checked);
  }

  override insertNewAfter(_selection: RangeSelection, restoreSelection = true): BlockNode {
    const kind = this.getKind();
    const next = $createBlockNode(
      kind === 'ul' || kind === 'ol' || kind === 'todo' || kind === 'code' ? kind : 'p',
    ).setIndent(this.getIndent());
    this.insertAfter(next, restoreSelection);
    return next;
  }

  override collapseAtStart(): boolean {
    if (this.getKind() === 'p' && this.getIndent() === 0) return false;
    this.setKind('p').setIndent(0);
    return true;
  }
}

export function $createBlockNode(kind: BlockKind = 'p'): BlockNode {
  return $applyNodeReplacement(new BlockNode(kind));
}

export function $isBlockNode(node: LexicalNode | null | undefined): node is BlockNode {
  return node instanceof BlockNode;
}

/** Счётчик — производное значение, не отдельная совместно изменяемая запись. */
export function $orderedNumber(block: BlockNode): number {
  let number = 1;
  let previous = block.getPreviousSibling();
  while ($isBlockNode(previous)) {
    if (previous.getIndent() < block.getIndent()) break;
    if (previous.getIndent() === block.getIndent()) {
      if (previous.getKind() !== 'ol') break;
      number++;
    }
    previous = previous.getPreviousSibling();
  }
  return number;
}
