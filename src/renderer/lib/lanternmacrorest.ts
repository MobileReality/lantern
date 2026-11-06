import type { GraphBlock, GraphEdge, MacroGraph } from './lanternmacro';
import type { MacroLayout } from './lanternmacrolayout';

import { MAIN_LINK_CAP_FACTOR, MAIN_LINK_COVERAGE, pairKey, selectMainLinks } from '../../shared/lantern-main-links';

interface RestCounts {
  featureCards: number;
  linksAtRest: number;
  linksTotal: number;
}

type PairEdge = Pick<GraphEdge, 'fromKey' | 'toKey' | 'count' | 'quiet'>;

function pairWeights(edges: readonly PairEdge[]) {
  const weights = new Map<string, number>();
  for (const edge of edges) {
    if (edge.quiet) continue;
    const key = pairKey(edge.fromKey, edge.toKey);
    weights.set(key, (weights.get(key) ?? 0) + edge.count);
  }
  return weights;
}

function mainLinkPairs(edges: readonly PairEdge[], featureBlocks: number): Set<string> {
  return selectMainLinks(pairWeights(edges), featureBlocks);
}

function linkKeyOf(blockKey: string, systemKey: string) {
  return `${blockKey}>${systemKey}`;
}

function systemLinksFor(graph: MacroGraph, selected: string | null): Set<string> {
  const shown = new Set<string>();
  if (selected === null) return shown;
  const features = new Set(graph.blocks.filter((block) => block.kind === 'feature').map((block) => block.key));
  for (const system of graph.systems) {
    for (const link of system.links) if (features.has(link.blockKey) && (link.blockKey === selected || system.key === selected)) shown.add(linkKeyOf(link.blockKey, system.key));
  }
  return shown;
}

function hasFoundation(graph: MacroGraph) {
  return graph.blocks.some((block) => block.kind === 'core');
}

function withoutFoundation(graph: MacroGraph): MacroGraph {
  const core = new Set(graph.blocks.filter((block) => block.kind === 'core').map((block) => block.key));
  if (!core.size) return graph;
  const systems = graph.systems.map((system) => ({ ...system, links: system.links.filter((link) => !core.has(link.blockKey)) })).filter((system) => system.links.length);
  return {
    ...graph,
    blocks: graph.blocks.filter((block) => !core.has(block.key)),
    edges: graph.edges.filter((edge) => !core.has(edge.fromKey) && !core.has(edge.toKey)),
    systems,
  };
}

function realCards<T extends Pick<GraphBlock, 'kind' | 'unplaced'>>(blocks: readonly T[]) {
  return blocks.filter((block) => block.kind === 'feature' && !block.unplaced);
}

function restCounts(rest: MacroLayout): RestCounts {
  const cards = [...rest.layout.pos.values()];
  const pairs = new Set(rest.arcs.map((arc) => pairKey(arc.edge.fromKey, arc.edge.toKey)));
  const mainArcs = rest.arcs.filter((arc) => arc.edge.main);
  const mainPairs = new Set(mainArcs.map((arc) => pairKey(arc.edge.fromKey, arc.edge.toKey)));
  return {
    featureCards: realCards(cards.flatMap((card) => (card.item.block ? [card.item.block] : []))).length,
    linksAtRest: mainPairs.size,
    linksTotal: pairs.size,
  };
}

export { MAIN_LINK_CAP_FACTOR, MAIN_LINK_COVERAGE, hasFoundation, linkKeyOf, mainLinkPairs, pairKey, realCards, restCounts, systemLinksFor, withoutFoundation };
export type { RestCounts };
