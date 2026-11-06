import { describe, expect, it } from 'vitest';
import type { MacroView } from '../src/main/lantern-macro';
import { macroGraph } from '../src/renderer/lib/lanternmacro';
import { layoutMacro } from '../src/renderer/lib/lanternmacrolayout';
import { MAIN_LINK_CAP_FACTOR, MAIN_LINK_COVERAGE, mainLinkPairs, pairKey, restCounts, systemLinksFor } from '../src/renderer/lib/lanternmacrorest';
import ownView from './fixtures/lantern-macro-own-view.json';
import { macroFixtureView } from './helpers/lantern-macro-fixture';

const edge = (fromKey: string, toKey: string, count: number, quiet = false) => ({ fromKey, toKey, count, quiet });
const pairs = (...names: [string, string][]) => new Set(names.map(([a, b]) => pairKey(a, b)));

function tinyView(blocks: string[], edges: [string, string, number][] = [], external: MacroView['external'] = []): MacroView {
  return {
    recordCount: blocks.length,
    testCount: 0,
    blocks: blocks.map((id) => ({ id, files: 3 })),
    edges: edges.map(([from, to, count]) => ({ from, to, count, arrows: { '>': count, '<': 0, '=': 0, '@': 0 }, strong: false })),
    crossBlockRelations: edges.reduce((sum, [, , count]) => sum + count, 0),
    external,
  };
}

describe('the main-link rule', () => {
  it('keeps the tunable guesses in one place', () => {
    expect([MAIN_LINK_COVERAGE, MAIN_LINK_CAP_FACTOR]).toEqual([0.8, 2]);
  });

  it('takes the fewest pairs that carry at least 80% of the relation lines', () => {
    const edges = [edge('a', 'b', 50), edge('a', 'c', 30), edge('a', 'd', 10), edge('a', 'e', 6), edge('a', 'f', 4)];

    expect(mainLinkPairs(edges, 6)).toEqual(pairs(['a', 'b'], ['a', 'c']));
  });

  it('needs one more pair when the heaviest ones fall just short of 80%', () => {
    const edges = [edge('a', 'b', 50), edge('a', 'c', 29), edge('a', 'd', 11), edge('a', 'e', 6), edge('a', 'f', 4)];

    expect(mainLinkPairs(edges, 6)).toEqual(pairs(['a', 'b'], ['a', 'c'], ['a', 'd']));
  });

  it('never draws more than twice as many links as there are feature blocks', () => {
    const edges = [edge('a', 'b', 1), edge('a', 'c', 1), edge('a', 'd', 1), edge('b', 'c', 1), edge('b', 'd', 1), edge('c', 'd', 1)];

    expect(mainLinkPairs(edges, 2).size).toBe(2 * MAIN_LINK_CAP_FACTOR);
    expect(mainLinkPairs(edges, 3).size).toBe(5);
    expect(mainLinkPairs(edges, 1).size).toBe(MAIN_LINK_CAP_FACTOR);
  });

  it('breaks ties by the names of the pair, whatever the order of the edges', () => {
    const edges = [edge('d', 'e', 5), edge('a', 'b', 5), edge('c', 'b', 5), edge('a', 'e', 5)];

    expect(mainLinkPairs(edges, 1)).toEqual(pairs(['a', 'b'], ['a', 'e']));
    expect(mainLinkPairs([...edges].reverse(), 1)).toEqual(pairs(['a', 'b'], ['a', 'e']));
  });

  it('merges the two directions of a pair into one link before ranking', () => {
    const edges = [edge('a', 'b', 5), edge('b', 'a', 5), edge('c', 'd', 8), edge('e', 'f', 7), edge('g', 'h', 1)];

    expect(mainLinkPairs(edges, 1)).toEqual(pairs(['a', 'b'], ['c', 'd']));
  });

  it('counts only the relation lines between features, never the foundation', () => {
    const edges = [edge('a', 'b', 10), edge('a', 'core', 500, true), edge('core', 'b', 500, true)];

    expect(mainLinkPairs(edges, 2)).toEqual(pairs(['a', 'b']));
  });

  it('draws nothing for a map with no relations between features', () => {
    expect(mainLinkPairs([], 5).size).toBe(0);
    expect(mainLinkPairs([edge('a', 'core', 4, true)], 5).size).toBe(0);
  });
});

describe('the main links of the graph', () => {
  it('flags both directions of a main pair and nothing else', () => {
    const graph = macroGraph(tinyView(['a', 'b', 'c', 'd'], [['a', 'b', 20], ['b', 'a', 10], ['c', 'd', 1]]));

    expect(graph.edges.map((entry) => [entry.from, entry.to, entry.main])).toEqual([['a', 'b', true], ['b', 'a', true], ['c', 'd', false]]);
  });

  it('never flags a line to or from the foundation', () => {
    const graph = macroGraph(tinyView(['a', 'b', 'core:desktop'], [['a', 'core:desktop', 90], ['core:desktop', 'b', 90], ['a', 'b', 1]]));

    expect(graph.edges.filter((entry) => entry.main).map((entry) => [entry.from, entry.to])).toEqual([['a', 'b']]);
  });
});

describe('what is drawn at rest on the pinned fixtures', () => {
  it('draws 11 feature cards and 7 of 18 links on the pinned macro fixture', () => {
    const rest = layoutMacro(macroGraph(macroFixtureView()));

    expect(restCounts(rest)).toEqual({ featureCards: 11, linksAtRest: 7, linksTotal: 18 });
  });

  it('draws 12 feature cards and 8 of 21 links on this repo own view', () => {
    const rest = layoutMacro(macroGraph(ownView as unknown as MacroView));

    expect(restCounts(rest)).toEqual({ featureCards: 12, linksAtRest: 8, linksTotal: 21 });
  });

  it('counts the cards the layout really holds, so a foundation card among the features changes the numbers', () => {
    const view = macroFixtureView();
    const graph = macroGraph(view);
    const rest = layoutMacro(graph);
    const cards = [...rest.layout.pos.values()].filter((card) => card.item.block);

    expect(cards.filter((card) => card.item.block?.kind === 'core')).toHaveLength(view.blocks.filter((block) => block.id.startsWith('core:')).length);
    expect(rest.layout.cols.filter((col) => col.items.some((item) => item.block?.kind === 'core')).map((col) => col.layer.name)).toEqual(['Shared foundation']);
    expect(rest.layout.cols.find((col) => col.layer.name === 'Features')?.items.every((item) => item.block?.kind === 'feature')).toBe(true);
  });

  it('draws more once a block is selected: its systems, and no foundation line either way', () => {
    const graph = macroGraph(macroFixtureView());
    const delegateRuns = 'block:delegate-runs';
    const shown = systemLinksFor(graph, delegateRuns);
    const selected = layoutMacro(graph, shown);

    expect(shown.size).toBeGreaterThan(0);
    expect(selected.links).toHaveLength(shown.size);
    expect(new Set(selected.links.map((link) => link.system.key)).size).toBeGreaterThan(0);
    expect(selected.arcs).toHaveLength(layoutMacro(graph).arcs.length);
  });

  it('keeps the width of the canvas, so the zoom does not jump when systems appear', () => {
    const graph = macroGraph(macroFixtureView());
    const rest = layoutMacro(graph);
    const selected = layoutMacro(graph, systemLinksFor(graph, 'block:delegate-runs'));

    expect(selected.layout.width).toBe(rest.layout.width);
    expect([...rest.layout.pos].every(([key, card]) => selected.layout.pos.get(key)?.x === card.x && selected.layout.pos.get(key)?.y === card.y)).toBe(true);
  });
});

describe('the systems a selection shows', () => {
  const graph = macroGraph(macroFixtureView());

  it('is empty at rest', () => {
    expect(systemLinksFor(graph, null).size).toBe(0);
  });

  it('holds only the links of the selected feature block', () => {
    const shown = systemLinksFor(graph, 'block:delegate-runs');

    expect(shown.size).toBeGreaterThan(0);
    expect([...shown].every((key) => key.startsWith('block:delegate-runs>ext:'))).toBe(true);
  });

  it('holds the feature links of a selected system, leaving the foundation to the side panel', () => {
    const system = graph.systems.find((entry) => entry.system === 'bitbucket-api') as (typeof graph.systems)[number];
    const shown = systemLinksFor(graph, system.key);

    expect(shown.size).toBeGreaterThan(0);
    expect([...shown].every((key) => key.endsWith(`>${system.key}`) && !key.startsWith('block:core:'))).toBe(true);
  });

  it('is empty for a foundation entry and for the whole band', () => {
    expect(systemLinksFor(graph, 'block:core:desktop').size).toBe(0);
    expect(systemLinksFor(graph, 'band:foundation').size).toBe(0);
  });
});

describe('maps that give the rest no work', () => {
  it('draws no band and no line for a map with no foundation block and no relation', () => {
    const rest = layoutMacro(macroGraph(tinyView(['a', 'b', 'c'])));

    expect(restCounts(rest)).toEqual({ featureCards: 3, linksAtRest: 0, linksTotal: 0 });
  });

  it('draws only the band for a map made of the foundation alone', () => {
    const rest = layoutMacro(macroGraph(tinyView(['core:desktop', 'core:shared'], [['core:desktop', 'core:shared', 9]])));

    expect(restCounts(rest)).toEqual({ featureCards: 0, linksAtRest: 0, linksTotal: 0 });
    expect(rest.layout.cols.some((col) => col.items.some((item) => item.block?.kind === 'core'))).toBe(true);
  });

  it('draws nothing for an empty map', () => {
    expect(restCounts(layoutMacro(macroGraph(tinyView([]))))).toEqual({ featureCards: 0, linksAtRest: 0, linksTotal: 0 });
  });
});
