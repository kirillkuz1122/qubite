import type { DocLinkKind } from '@qubite/sync-client';
import {
  $applyNodeReplacement,
  DecoratorNode,
  type LexicalNode,
  type NodeKey,
  type SerializedLexicalNode,
} from 'lexical';

export type SerializedMentionNode = SerializedLexicalNode & {
  target: string;
  kind: DocLinkKind;
};

/** Название живёт в кэше объектов, никогда в совместном дереве Yjs. */
export class MentionNode extends DecoratorNode<null> {
  __target: string;
  __kind: DocLinkKind;

  static override getType(): string {
    return 'qubite-mention';
  }

  static override clone(node: MentionNode): MentionNode {
    return new MentionNode(node.__target, node.__kind, node.__key);
  }

  constructor(target = '', kind: DocLinkKind = 'docs.page', key?: NodeKey) {
    super(key);
    this.__target = target;
    this.__kind = kind;
  }

  getTarget(): string {
    return this.getLatest().__target;
  }

  getKind(): DocLinkKind {
    return this.getLatest().__kind;
  }

  override isInline(): boolean {
    return true;
  }

  override getTextContent(): string {
    return '@';
  }

  override createDOM(): HTMLElement {
    const dom = document.createElement('span');
    dom.className = 'docs-mention';
    dom.contentEditable = 'false';
    dom.dataset.mention = this.getKey();
    dom.textContent = '…';
    return dom;
  }

  override updateDOM(): boolean {
    return false;
  }

  override decorate(): null {
    return null;
  }

  override exportJSON(): SerializedMentionNode {
    return { ...super.exportJSON(), target: this.getTarget(), kind: this.getKind() };
  }

  static override importJSON(value: SerializedMentionNode): MentionNode {
    return $createMentionNode(value.target, value.kind);
  }
}

export function $createMentionNode(target: string, kind: DocLinkKind): MentionNode {
  return $applyNodeReplacement(new MentionNode(target, kind));
}

export function $isMentionNode(node: LexicalNode | null | undefined): node is MentionNode {
  return node instanceof MentionNode;
}
