import { describe, expect, it } from 'vitest';
import type { MacroView } from '../src/main/lantern-macro';
import { MACRO_MIN_FILES, blockCaption, edgeTitle, macroAvailable, macroGraph } from '../src/renderer/lib/lanternmacro';
import { SMALL_MAP_FILES } from '../src/renderer/lib/lanterncollapse';
import { layoutMacro } from '../src/renderer/lib/lanternmacrolayout';
import { macroFixtureView } from './helpers/lantern-macro-fixture';
import { mapOf, node } from './helpers/lantern-map';

const view = macroFixtureView();
const mapWith = (files: number) => mapOf({ nodes: Array.from({ length: files }, (_, i) => node(`src/f${i}.ts`, 'util')) });

describe('the macro graph shows exactly what deriveMacroView derived', () => {
  it('has the pinned 14 blocks, 58 edges (14 strong) and 13 outside systems', () => {
    const graph = macroGraph(view);

    expect([graph.blocks.length, graph.edges.length, graph.edges.filter((edge) => edge.strong).length, graph.systems.length]).toEqual([14, 58, 14, 13]);
  });

  it('keeps every block with its file count, in the order of the view', () => {
    const graph = macroGraph(view);

    expect(graph.blocks.map((block) => [block.id, block.files])).toEqual(view.blocks.map((block) => [block.id, block.files]));
  });

  it('keeps every edge with its count, direction, arrows and strong flag', () => {
    const graph = macroGraph(view);

    expect(graph.edges.map((edge) => [edge.from, edge.to, edge.count, edge.strong, edge.arrows])).toEqual(view.edges.map((edge) => [edge.from, edge.to, edge.count, edge.strong, edge.arrows]));
  });

  it('takes strong from the view, so the threshold of deriveMacroView decides', () => {
    const edges = [{ from: 'a', to: 'b', count: 7, strong: false }, { from: 'b', to: 'a', count: 8, strong: true }].map((edge) => ({ ...edge, arrows: { '>': edge.count, '<': 0, '=': 0, '@': 0 } }));
    const small: MacroView = { recordCount: 2, testCount: 0, blocks: [{ id: 'a', files: 1 }, { id: 'b', files: 1 }], edges, crossBlockRelations: 15, external: [] };

    expect(macroGraph(small).edges.map((edge) => edge.strong)).toEqual([false, true]);
  });

  it('keeps every outside system with the blocks that use it', () => {
    const graph = macroGraph(view);

    expect(graph.systems.map((system) => [system.system, system.links.map((link) => [link.block, link.count])])).toEqual(view.external.map((entry) => [entry.system, entry.blocks.map((link) => [link.block, link.count])]));
  });

  it('reports the files in blocks, the test files left out and the relations between blocks', () => {
    const graph = macroGraph(view);

    expect([graph.files, graph.tests, graph.relations]).toEqual([view.blocks.reduce((sum, block) => sum + block.files, 0), view.testCount, view.crossBlockRelations]);
  });
});

const FEATURE_EDGES = view.edges.filter((edge) => !edge.from.startsWith('core:') && !edge.to.startsWith('core:'));

describe('the macro layout draws every block, the feature links, and the outside systems on request', () => {
  const shape = layoutMacro(macroGraph(view));

  it('draws one card per block, named for people and captioned with its file count', () => {
    const cards = [...shape.layout.pos.values()].filter((position) => position.item.block);

    expect(cards).toHaveLength(view.blocks.length);
    expect(cards.map((card) => [card.item.label, card.item.block?.files]).sort()).toEqual(macroGraph(view).blocks.map((block) => [block.name, block.files]).sort());
  });

  it('keeps one arrow per feature-to-feature edge with its count written on it, and none for the foundation', () => {
    expect(shape.arcs).toHaveLength(FEATURE_EDGES.length);
    expect(shape.arcs.map((arc) => [arc.edge.from, arc.edge.to, arc.label.text])).toEqual(FEATURE_EDGES.map((edge) => [edge.from, edge.to, String(edge.count)]));
  });

  it('adds up to the relations between features', () => {
    expect(shape.arcs.reduce((sum, arc) => sum + Number(arc.label.text), 0)).toBe(FEATURE_EDGES.reduce((sum, edge) => sum + edge.count, 0));
  });

  it('marks as strong exactly the feature edges the view marks', () => {
    expect(shape.arcs.filter((arc) => arc.edge.strong).map((arc) => arc.edge.key)).toEqual(FEATURE_EDGES.filter((edge) => edge.strong).map((edge) => `block:${edge.from}>block:${edge.to}`));
  });

  it('draws no outside system and no link to one until something is selected', () => {
    expect([...shape.layout.pos.values()].filter((position) => !position.item.block)).toEqual([]);
    expect(shape.links).toEqual([]);
  });

  it('draws the systems of the links it is asked to show, with one link per use', () => {
    const graph = macroGraph(view);
    const bitbucket = graph.systems.find((system) => system.system === 'bitbucket-api') as (typeof graph.systems)[number];
    const shown = new Set(bitbucket.links.map((link) => `${link.blockKey}>${bitbucket.key}`));
    const withSystem = layoutMacro(graph, shown);

    expect([...withSystem.layout.pos.values()].filter((position) => !position.item.block).map((card) => card.item.label)).toEqual([bitbucket.name]);
    expect(withSystem.links).toHaveLength(bitbucket.links.length);
  });

  it('puts the foundation band, the features and then the outside systems in their own columns', () => {
    const graph = macroGraph(view);
    const some = new Set(graph.systems[0].links.map((link) => `${link.blockKey}>${graph.systems[0].key}`));

    expect(shape.layout.cols.map((col) => col.layer.name)).toEqual(['Shared foundation', 'Features']);
    expect(layoutMacro(graph, some).layout.cols.map((col) => col.layer.name)).toEqual(['Shared foundation', 'Features', 'Outside']);
  });
});

describe('the Macro control is offered only to maps that need it', () => {
  it('is tied to the size at which the file graph starts folding directories', () => {
    expect(MACRO_MIN_FILES).toBe(SMALL_MAP_FILES);
    expect(MACRO_MIN_FILES).toBe(120);
  });

  it('is hidden at the cut and below it', () => {
    expect(macroAvailable(mapWith(MACRO_MIN_FILES))).toBe(false);
    expect(macroAvailable(mapWith(3))).toBe(false);
  });

  it('is offered one file above the cut', () => {
    expect(macroAvailable(mapWith(MACRO_MIN_FILES + 1))).toBe(true);
  });

  it('is hidden when there is no map', () => {
    expect(macroAvailable({ ...mapWith(MACRO_MIN_FILES + 50), exists: false })).toBe(false);
  });
});

describe('texts', () => {
  it('words the caption of a block with the right plural', () => {
    expect(blockCaption(1)).toBe('1 file');
    expect(blockCaption(81)).toBe('81 files');
  });

  it('lists the arrows of an edge by their kind', () => {
    const edge = macroGraph(view).edges[0];

    expect(edgeTitle(edge)).toBe(['Lantern map → Desktop shell: 32 relations, strong', '→ sends data into: 1', '← takes data from: 8', '⇄ both ways: 23'].join('\n'));
  });
});
