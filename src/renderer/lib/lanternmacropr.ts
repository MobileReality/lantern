import type { LanternNode, LanternPrFile, LanternRelation } from '../../main/lantern';
import type { MacroView } from '../../main/lantern-macro';
import { isFoundationId } from './lanternmacronames';

const TEST_ROLE = 'test';
const CORE_PREFIX = 'core:';

type ImpactNode = Pick<LanternNode, 'path' | 'role' | 'feature' | 'platform'>;
type ImpactRelation = Pick<LanternRelation, 'from' | 'to' | 'ext'>;

interface PrImpactInput {
  view: MacroView;
  blockByPath: Readonly<Record<string, string>>;
  nodes: readonly ImpactNode[];
  relations: readonly ImpactRelation[];
  files: readonly LanternPrFile[];
}

interface OtherFiles {
  unmapped: LanternPrFile[];
  tests: LanternPrFile[];
  unplaced: LanternPrFile[];
  foundation: LanternPrFile[];
}

interface PrImpact {
  blocks: ReadonlyMap<string, readonly LanternPrFile[]>;
  edges: ReadonlySet<string>;
  systems: ReadonlySet<string>;
  links: ReadonlySet<string>;
  other: OtherFiles;
  changed: number;
}

function edgeId(from: string, to: string) {
  return `${from} -> ${to}`;
}

function linkId(block: string, system: string) {
  return `${block} > ${system}`;
}

function soleFoundation(view: MacroView) {
  const found = view.blocks.filter((block) => block.id.startsWith(CORE_PREFIX));
  return found.length === 1 ? found[0].id : null;
}

function blockOfNew(node: ImpactNode, view: MacroView) {
  const wanted = node.feature ?? (node.platform ? `${CORE_PREFIX}${node.platform}` : soleFoundation(view));
  return wanted !== null && view.blocks.some((block) => block.id === wanted) ? wanted : null;
}

function emptyOther(): OtherFiles {
  return { unmapped: [], tests: [], unplaced: [], foundation: [] };
}

function derivePrImpact(input: PrImpactInput): PrImpact {
  const { view, blockByPath } = input;
  const nodeByPath = new Map(input.nodes.map((node) => [node.path, node]));
  const blockOf = (path: string) => {
    const known = Object.hasOwn(blockByPath, path) ? blockByPath[path] : undefined;
    const node = nodeByPath.get(path);
    return known ?? (node && node.role !== TEST_ROLE ? blockOfNew(node, view) : null);
  };

  const blocks = new Map<string, LanternPrFile[]>();
  const changedBlock = new Map<string, string>();
  const other = emptyOther();
  for (const file of input.files) {
    const block = blockOf(file.path);
    const node = nodeByPath.get(file.path);
    if (block) {
      blocks.set(block, [...(blocks.get(block) ?? []), file]);
      changedBlock.set(file.path, block);
      if (isFoundationId(block)) other.foundation.push(file);
    } else if (!node) other.unmapped.push(file);
    else if (node.role === TEST_ROLE) other.tests.push(file);
    else other.unplaced.push(file);
  }

  const drawn = new Set(view.edges.map((edge) => edgeId(edge.from, edge.to)));
  const drawnLinks = new Set(view.external.flatMap((entry) => entry.blocks.map((link) => linkId(link.block, entry.system))));
  const edges = new Set<string>();
  const systems = new Set<string>();
  const links = new Set<string>();
  for (const relation of input.relations) {
    const touched = changedBlock.has(relation.from) || (relation.to !== null && changedBlock.has(relation.to));
    if (!touched) continue;
    const from = blockOf(relation.from);
    if (!from) continue;
    if (relation.ext !== null) {
      if (changedBlock.has(relation.from) && drawnLinks.has(linkId(from, relation.ext))) {
        systems.add(relation.ext);
        links.add(linkId(from, relation.ext));
      }
      continue;
    }
    const to = relation.to === null ? null : blockOf(relation.to);
    if (to && to !== from && drawn.has(edgeId(from, to))) edges.add(edgeId(from, to));
  }

  return { blocks, edges, systems, links, other, changed: changedBlock.size };
}

function outsideCount(other: OtherFiles) {
  return other.unmapped.length + other.tests.length + other.unplaced.length + other.foundation.length;
}

export { TEST_ROLE, blockOfNew, derivePrImpact, edgeId, linkId, outsideCount };
export type { ImpactNode, ImpactRelation, OtherFiles, PrImpact, PrImpactInput };
