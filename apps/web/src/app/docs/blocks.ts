import { BLOCKS as LAB_BLOCKS, slashItems as labSlashItems, slashQuery } from '../../lab/blocks';
import type { BlockKind as LabKind } from '../../lab/blocks';
import type { BlockKind } from './BlockNode';

const kinds: Record<LabKind, BlockKind> = {
  text: 'p',
  h1: 'h1',
  h2: 'h2',
  bullet: 'ul',
  ordered: 'ol',
  check: 'todo',
  quote: 'quote',
  code: 'code',
};

export const BLOCKS = LAB_BLOCKS.map((block) => ({ ...block, kind: kinds[block.kind] }));
export const slashItems = (query: string) =>
  labSlashItems(query).map((block) => ({ ...block, kind: kinds[block.kind] }));
export { slashQuery };
