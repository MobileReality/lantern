import type { LanternMap, LanternPr } from '../../main/lantern';
import { VIEW, say } from '../../shared/lantern-plan-messages';
import { derivePrImpact, edgeId, linkId } from './lanternmacropr';
import type { PrImpact } from './lanternmacropr';
import type { MacroGraph } from './lanternmacro';
import { cardMembers } from './lanternmacroareas';
import type { MacroLayout } from './lanternmacrolayout';
import { reviewSequence } from './lanternprpanel';
import type { MacroFrame } from './lanternmacroview';
import type { PlanFocus } from './lanternplanfocus';

const UNMARKED_ALPHA = 0.55;
const FAR_ALPHA = 0.22;
const CALM_ALPHA = 0.6;
const WEAK_NEAR_ALPHA = 0.55;

interface BlockMark {
  changed: number;
  total: number;
}

interface MacroMarks {
  blocks: ReadonlyMap<string, BlockMark>;
  systems: ReadonlySet<string>;
  edges: ReadonlySet<string>;
  links: ReadonlySet<string>;
  plan?: string;
}

type CardMembers = ReadonlyMap<string, readonly string[]>;

function membersOf(members: CardMembers, id: string): readonly string[] {
  return members.get(id) ?? [id];
}

function macroMarks(graph: MacroGraph, impact: PrImpact, members: CardMembers = new Map()): MacroMarks {
  const blocks = new Map<string, BlockMark>();
  for (const block of graph.blocks) {
    const changed = membersOf(members, block.id).reduce((sum, feature) => sum + (impact.blocks.get(feature)?.length ?? 0), 0);
    if (changed) blocks.set(block.key, { changed, total: block.files });
  }
  const touches = (from: string, to: string) => membersOf(members, from).some((a) => membersOf(members, to).some((b) => impact.edges.has(edgeId(a, b))));
  const reaches = (block: string, system: string) => membersOf(members, block).some((feature) => impact.links.has(linkId(feature, system)));
  const systems = new Set(graph.systems.filter((system) => impact.systems.has(system.system)).map((system) => system.key));
  const edges = new Set(graph.edges.filter((edge) => touches(edge.from, edge.to)).map((edge) => edge.key));
  const links = new Set(graph.systems.flatMap((system) => system.links.filter((link) => reaches(link.block, system.system)).map((link) => `${link.blockKey}>${system.key}`)));
  return { blocks, systems, edges, links };
}

function planMacroMarks(graph: MacroGraph, focus: PlanFocus, blockByPath: Readonly<Record<string, string>>): MacroMarks {
  const named = new Map<string, number>();
  for (const path of focus.paths) if (Object.hasOwn(blockByPath, path)) named.set(blockByPath[path], (named.get(blockByPath[path]) ?? 0) + 1);
  const blocks = new Map<string, BlockMark>();
  for (const block of graph.blocks) {
    const changed = focus.ids.has(block.id) ? block.files : (named.get(block.id) ?? 0);
    if (changed) blocks.set(block.key, { changed, total: block.files });
  }
  return { blocks, systems: new Set(), edges: new Set(), links: new Set(), plan: focus.label };
}

interface MacroPrView {
  pr: LanternPr;
  impact: PrImpact;
  marks: MacroMarks;
  members: CardMembers;
}

function macroPrView(frame: MacroFrame, pr: LanternPr, base: LanternMap, merged: LanternMap): MacroPrView | null {
  if (!frame.shape || !frame.loaded) return null;
  const relations = merged === base ? base.relations : [...base.relations, ...merged.relations];
  const impact = derivePrImpact({ view: frame.loaded.view, blockByPath: frame.loaded.blockByPath, nodes: merged.nodes, relations, files: reviewSequence(pr) });
  const members = frame.shape.graph.level === 'areas' ? cardMembers(frame.loaded.areas) : new Map<string, readonly string[]>();
  return { pr, impact, marks: macroMarks(frame.shape.graph, impact, members), members };
}

function isMarked(marks: MacroMarks | undefined, key: string) {
  return !!marks && (marks.blocks.has(key) || marks.systems.has(key));
}

function markCaption(mark: BlockMark) {
  return `${mark.changed} of ${mark.total} files`;
}

function markNote(marks: MacroMarks | undefined, key: string) {
  const block = marks?.blocks.get(key);
  if (block && marks?.plan) return say(VIEW.NOTE_PLAN_BLOCK, { label: marks.plan, changed: block.changed, total: block.total });
  if (block) return `changed in the pull request: ${markCaption(block)}`;
  return marks?.systems.has(key) ? 'an outside system the pull request touches' : '';
}

function markedAlpha(marks: MacroMarks | undefined, key: string, farFromSelection: boolean) {
  const base = !marks || isMarked(marks, key) ? 1 : UNMARKED_ALPHA;
  return farFromSelection ? Math.min(base, FAR_ALPHA) : base;
}

function calmedAlpha(key: string, current: ReadonlySet<string>, touching: ReadonlySet<string>, farFromSelection: boolean) {
  const base = current.has(key) || touching.has(key) ? 1 : CALM_ALPHA;
  return farFromSelection ? Math.min(base, FAR_ALPHA) : base;
}

function weakNearAlpha(alpha: number, weak: boolean) {
  return weak ? Math.min(alpha, WEAK_NEAR_ALPHA) : alpha;
}

function systemsOfBlocks(shape: MacroLayout | undefined, blockKeys: ReadonlySet<string>): ReadonlySet<string> {
  if (!shape || blockKeys.size === 0) return new Set();
  return new Set(shape.links.filter((link) => blockKeys.has(link.link.blockKey)).map((link) => link.system.key));
}

export { FAR_ALPHA, WEAK_NEAR_ALPHA, calmedAlpha, isMarked, macroMarks, macroPrView, markCaption, markNote, markedAlpha, planMacroMarks, systemsOfBlocks, weakNearAlpha };
export type { BlockMark, CardMembers, MacroMarks, MacroPrView };
