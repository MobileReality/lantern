import { blockKey } from './lanternmacro';
import { areaOfFeature, cardMembers } from './lanternmacroareas';
import { TEST_ROLE, blockOfNew } from './lanternmacropr';
import type { ImpactNode } from './lanternmacropr';
import type { MacroFrame } from './lanternmacroview';

const OPEN_FILE_LABEL = 'Open in the review pane';

interface OtherArea {
  key: string;
  name: string;
}

interface OpenFileBlock {
  path: string;
  blockKey: string | null;
  elsewhere: boolean;
  area: OtherArea | null;
}

function openFileBlock(frame: MacroFrame, path: string | null, node: ImpactNode | undefined): OpenFileBlock | null {
  if (!path || !frame.shape || !frame.loaded) return null;
  const { view, blockByPath, areas } = frame.loaded;
  const { graph } = frame.shape;
  const known = Object.hasOwn(blockByPath, path) ? blockByPath[path] : undefined;
  const id = known ?? (node && node.role !== TEST_ROLE ? blockOfNew(node, view) : null);
  const members = graph.level === 'areas' ? cardMembers(areas) : null;
  const block = id ? graph.blocks.find((candidate) => candidate.id === id || (members?.get(candidate.id) ?? []).includes(id)) : undefined;
  const owner = !block && id && graph.level === 'area' ? areaOfFeature(areas, id) : null;
  return { path, blockKey: block?.key ?? null, elsewhere: !!owner, area: owner ? { key: blockKey(owner.id), name: owner.name } : null };
}

export { OPEN_FILE_LABEL, openFileBlock };
export type { OpenFileBlock };
