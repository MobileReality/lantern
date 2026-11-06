import type { MacroView } from '../../main/lantern-macro';
import type { FoundationLink, PlatformFiles, PlatformUses } from '../../main/lantern-macro-foundation';
import type { Arrow, LanternMap } from '../../main/lantern';
import { SMALL_MAP_FILES } from './lanterncollapse';
import { ARROWS, GLYPH, KIND_TEXT } from './lanternctx';
import { blockName, isFoundationId, systemName } from './lanternmacronames';
import { mainLinkPairs, pairKey } from './lanternmacrorest';

const MACRO_MIN_FILES = SMALL_MAP_FILES;
const BLOCK_KEY = 'block:';
const SYSTEM_KEY = 'ext:';
const FOUNDATION_KEY = 'band:foundation';
const FOUNDATION_HEADING = 'Shared foundation';

type BlockKind = 'feature' | 'core' | 'stub';
type MacroTexts = Readonly<Record<string, string>>;
type GraphLevel = 'flat' | 'areas' | 'area';

interface StubTraffic {
  out: number;
  in: number;
}

interface GraphBlock {
  key: string;
  id: string;
  name: string;
  purpose: string;
  files: number;
  kind: BlockKind;
  caption?: string;
  unplaced?: boolean;
  members?: string[];
  opens?: string;
  traffic?: StubTraffic;
  platforms?: PlatformFiles[];
  uses?: PlatformUses[];
}

interface GraphArea {
  id: string;
  name: string;
  purpose: string;
  files: number;
  features: string[];
}

interface GraphEdge {
  key: string;
  fromKey: string;
  toKey: string;
  from: string;
  to: string;
  fromName: string;
  toName: string;
  count: number;
  strong: boolean;
  quiet: boolean;
  main: boolean;
  arrows: Record<Arrow, number>;
}

interface GraphLink {
  blockKey: string;
  block: string;
  blockName: string;
  count: number;
}

interface GraphSystem {
  key: string;
  system: string;
  name: string;
  links: GraphLink[];
}

interface MacroGraph {
  level: GraphLevel;
  area?: GraphArea;
  files: number;
  tests: number;
  relations: number;
  blocks: GraphBlock[];
  edges: GraphEdge[];
  systems: GraphSystem[];
  foundationLinks?: FoundationLink[];
}

function blockKey(id: string) {
  return `${BLOCK_KEY}${id}`;
}

function purposeOf(id: string, texts: MacroTexts) {
  return !isFoundationId(id) && Object.hasOwn(texts, id) ? texts[id].trim() : '';
}

function macroGraph(view: MacroView, texts: MacroTexts = {}): MacroGraph {
  const blocks = view.blocks.map((block) => ({ key: blockKey(block.id), id: block.id, name: blockName(block.id), purpose: purposeOf(block.id, texts), files: block.files, kind: isFoundationId(block.id) ? ('core' as const) : ('feature' as const) }));
  const listed = view.edges.map((edge) => ({
    key: `${blockKey(edge.from)}>${blockKey(edge.to)}`,
    fromKey: blockKey(edge.from),
    toKey: blockKey(edge.to),
    from: edge.from,
    to: edge.to,
    fromName: blockName(edge.from),
    toName: blockName(edge.to),
    count: edge.count,
    strong: edge.strong,
    quiet: isFoundationId(edge.from) || isFoundationId(edge.to),
    arrows: edge.arrows,
  }));
  const mainPairs = mainLinkPairs(listed, blocks.filter((block) => block.kind === 'feature').length);
  const edges = listed.map((edge) => ({ ...edge, main: !edge.quiet && mainPairs.has(pairKey(edge.fromKey, edge.toKey)) }));
  const systems = view.external.map((entry) => ({
    key: `${SYSTEM_KEY}${entry.system}`,
    system: entry.system,
    name: systemName(entry.system),
    links: entry.blocks.map((link) => ({ blockKey: blockKey(link.block), block: link.block, blockName: blockName(link.block), count: link.count })),
  }));
  return {
    level: 'flat',
    files: blocks.reduce((sum, block) => sum + block.files, 0),
    tests: view.testCount,
    relations: view.crossBlockRelations,
    blocks,
    edges,
    systems,
  };
}

function macroAvailable(data: LanternMap) {
  return data.exists && data.nodes.length > MACRO_MIN_FILES;
}

function plural(count: number, noun: string) {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

function blockCaption(files: number) {
  return plural(files, 'file');
}

function captionOf(block: Pick<GraphBlock, 'caption' | 'files'>) {
  return block.caption ?? blockCaption(block.files);
}

function blockKindText(block: Pick<GraphBlock, 'kind'> & { unplaced?: boolean; opens?: boolean }) {
  if (block.kind === 'core') return 'shared foundation block';
  if (block.kind === 'stub') return 'another area, press Enter to open it';
  if (block.opens) return block.unplaced ? 'features not in an area yet, press Enter to open them' : 'area, press Enter to open it';
  return 'feature block';
}

function edgeTitle(edge: GraphEdge) {
  const kinds = ARROWS.filter((arrow) => edge.arrows[arrow] > 0).map((arrow) => `${GLYPH[arrow]} ${KIND_TEXT[arrow]}: ${edge.arrows[arrow]}`);
  return [`${edge.fromName} → ${edge.toName}: ${plural(edge.count, 'relation')}${edge.strong ? ', strong' : ''}`, ...kinds].join('\n');
}

function linkTitle(link: GraphLink, system: GraphSystem) {
  return `${link.blockName} → ${system.name}: ${plural(link.count, 'relation')}, outside the repo`;
}

export { FOUNDATION_HEADING, FOUNDATION_KEY, MACRO_MIN_FILES, SYSTEM_KEY, blockCaption, blockKey, blockKindText, captionOf, edgeTitle, linkTitle, macroAvailable, macroGraph, plural, purposeOf };
export type { BlockKind, GraphArea, GraphBlock, GraphEdge, GraphLevel, GraphLink, GraphSystem, MacroGraph, MacroTexts, StubTraffic };
