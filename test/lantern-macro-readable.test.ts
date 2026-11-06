import { describe, expect, it } from 'vitest';
import type { MacroView } from '../src/main/lantern-macro';
import { FOUNDATION_HEADING, macroGraph } from '../src/renderer/lib/lanternmacro';
import { cardWidth, purposeLines } from '../src/renderer/lib/lanternmacrocards';
import { layoutMacro } from '../src/renderer/lib/lanternmacrolayout';
import { blockName, systemName, wrapPurpose } from '../src/renderer/lib/lanternmacronames';
import { systemLinksFor } from '../src/renderer/lib/lanternmacrorest';
import { macroFixtureView, repoFeatureTexts } from './helpers/lantern-macro-fixture';

const view = macroFixtureView();
const texts = repoFeatureTexts();
const features = view.blocks.filter((block) => !block.id.startsWith('core:'));
const foundation = view.blocks.filter((block) => block.id.startsWith('core:'));

function tinyView(blocks: string[], edges: [string, string][] = []): MacroView {
  return {
    recordCount: blocks.length,
    testCount: 0,
    blocks: blocks.map((id) => ({ id, files: 3 })),
    edges: edges.map(([from, to]) => ({ from, to, count: 2, arrows: { '>': 2, '<': 0, '=': 0, '@': 0 }, strong: false })),
    crossBlockRelations: edges.length * 2,
    external: [{ system: 'claude-code-cli', blocks: [{ block: blocks[0], count: 1 }] }],
  };
}

describe('readable names', () => {
  it('turns a feature id into a sentence', () => {
    expect(blockName('session-monitoring')).toBe('Session monitoring');
    expect(blockName('pull-requests')).toBe('Pull requests');
    expect(blockName('lantern-map')).toBe('Lantern map');
  });

  it('keeps well-known words as they are written', () => {
    expect(blockName('pr-records')).toBe('PR records');
    expect(blockName('rbac')).toBe('RBAC');
  });

  it('names the shared foundation by what it is', () => {
    expect(blockName('core:desktop')).toBe('Desktop shell');
    expect(blockName('core:skills')).toBe('Skills');
    expect(blockName('core:shared')).toBe('Shared code');
  });

  it('writes outside systems by their names', () => {
    expect(systemName('claude-code-cli')).toBe('Claude Code CLI');
    expect(systemName('github-api')).toBe('GitHub API');
    expect(systemName('git')).toBe('Git');
    expect(systemName('vscode-serve-web')).toBe('VS Code Serve Web');
  });
});

describe('the purpose written on a card', () => {
  const graph = macroGraph(view, texts);

  it('is the one-line text this repo stores for the feature', () => {
    expect(features.length).toBeGreaterThan(0);
    for (const feature of features) {
      expect(graph.blocks.find((block) => block.id === feature.id)?.purpose, feature.id).toBe(texts[feature.id]);
      expect(texts[feature.id], `${feature.id} has no text in this repo`).toBeTruthy();
    }
  });

  it('reaches every feature card in the layout', () => {
    const shape = layoutMacro(graph);

    for (const feature of features) {
      const card = shape.layout.pos.get(`block:${feature.id}`);
      expect(card?.item.block?.purpose, feature.id).toBe(texts[feature.id]);
      expect(card?.item.block?.lines.length, feature.id).toBeGreaterThan(0);
      expect(texts[feature.id].startsWith(card?.item.block?.lines[0].replace(/…$/, '') ?? '?'), feature.id).toBe(true);
    }
  });

  it('is never invented: a feature without a text shows only its name', () => {
    const half = macroGraph(view, { 'lantern-map': texts['lantern-map'] });
    const shape = layoutMacro(half);

    expect(half.blocks.filter((block) => block.purpose).map((block) => block.id)).toEqual(['lantern-map']);
    expect(shape.layout.pos.get('block:notifications')?.item.block).toMatchObject({ purpose: '', lines: [] });
    expect(macroGraph(view).blocks.every((block) => block.purpose === '')).toBe(true);
  });

  it('is never given to the shared foundation, even when a text carries its id', () => {
    const graphWithOdd = macroGraph(view, { ...texts, 'core:desktop': 'should not appear' });

    expect(foundation.length).toBeGreaterThan(0);
    expect(graphWithOdd.blocks.filter((block) => block.kind === 'core').every((block) => block.purpose === '')).toBe(true);
  });

  it('is trimmed and ignores a blank text', () => {
    const odd = macroGraph(tinyView(['alpha', 'beta']), { alpha: '  does alpha things  ', beta: '   ' });

    expect(odd.blocks.map((block) => block.purpose)).toEqual(['does alpha things', '']);
  });

  it('wraps to two lines at most and ends a cut text with an ellipsis', () => {
    const long = 'overlay cards for finished or waiting sessions, the notifications setting and old hook cleanup on every launch of the app';

    const lines = wrapPurpose(long, 40);

    expect(lines).toHaveLength(2);
    expect(lines.every((line) => line.length <= 40)).toBe(true);
    expect(lines[1].endsWith('…')).toBe(true);
    expect(wrapPurpose('short text', 40)).toEqual(['short text']);
    expect(wrapPurpose('', 40)).toEqual([]);
  });

  it('makes the card taller only for the lines it carries', () => {
    const plain = layoutMacro(macroGraph(tinyView(['alpha'])));
    const described = layoutMacro(macroGraph(tinyView(['alpha']), { alpha: 'a purpose long enough to need two full lines on the card, and then some more words after it' }));

    expect(described.layout.pos.get('block:alpha')?.h).toBeGreaterThan(plain.layout.pos.get('block:alpha')?.h ?? 0);
    expect(cardWidth(macroGraph(tinyView(['alpha']), { alpha: 'x' }))).toBeGreaterThan(cardWidth(macroGraph(tinyView(['alpha']))));
    expect(purposeLines(macroGraph(tinyView(['alpha']), { alpha: 'x' }).blocks[0], 300)).toEqual(['x']);
  });
});

describe('the shared foundation is not drawn as a feature', () => {
  const graph = macroGraph(view, texts);
  const shape = layoutMacro(graph);
  const cardOf = (id: string) => shape.layout.pos.get(`block:${id}`);

  it('marks exactly the core: blocks as foundation', () => {
    expect(graph.blocks.filter((block) => block.kind === 'core').map((block) => block.id).sort()).toEqual(foundation.map((block) => block.id).sort());
    expect(foundation.every((block) => block.id.startsWith('core:'))).toBe(true);
  });

  it('draws every core: card as foundation and every other card as a feature', () => {
    for (const block of view.blocks) expect(cardOf(block.id)?.item.block?.kind, block.id).toBe(block.id.startsWith('core:') ? 'core' : 'feature');
  });

  it('places the foundation in its own quiet band beside the features, under its own heading', () => {
    const bandCol = shape.layout.cols[0];
    const featureCol = shape.layout.cols[1];

    expect(bandCol.layer.name).toBe(FOUNDATION_HEADING);
    expect(featureCol.layer.name).toBe('Features');
    expect(bandCol.items.map((item) => item.key).sort()).toEqual(foundation.map((block) => `block:${block.id}`).sort());
    expect(featureCol.items.some((item) => item.block?.kind === 'core')).toBe(false);
    expect(Math.max(...foundation.map((block) => (cardOf(block.id)?.x ?? 0) + (cardOf(block.id)?.w ?? 0)))).toBeLessThan(Math.min(...features.map((block) => cardOf(block.id)?.x ?? 0)));
  });

  it('draws no band when there is no foundation', () => {
    const only = layoutMacro(macroGraph(tinyView(['alpha', 'beta'], [['alpha', 'beta']])));

    expect(only.layout.cols.map((col) => col.layer.name)).toEqual(['Features']);
  });

  it('draws only the band when there are only foundation blocks', () => {
    const only = layoutMacro(macroGraph(tinyView(['core:desktop', 'core:skills'])));

    expect(only.layout.cols.map((col) => col.layer.name)).toEqual([FOUNDATION_HEADING]);
    expect([...only.layout.pos.keys()].sort()).toEqual(['block:core:desktop', 'block:core:skills']);
  });

  it('draws nothing at all for a map with no blocks and no relations', () => {
    const empty = layoutMacro(macroGraph({ recordCount: 0, testCount: 0, blocks: [], edges: [], crossBlockRelations: 0, external: [] }));

    expect(empty.layout.pos.size).toBe(0);
    expect(empty.arcs).toEqual([]);
  });

  it('keeps the edges of the foundation in the graph, but never draws them as arrows', () => {
    const quiet = graph.edges.filter((edge) => edge.quiet);

    expect(quiet.length).toBeGreaterThan(0);
    expect(quiet.every((edge) => edge.from.startsWith('core:') || edge.to.startsWith('core:'))).toBe(true);
    expect(graph.edges.filter((edge) => !edge.quiet).every((edge) => !edge.from.startsWith('core:') && !edge.to.startsWith('core:'))).toBe(true);
    expect(shape.arcs).toHaveLength(graph.edges.length - quiet.length);
    expect(shape.arcs.some((arc) => arc.edge.quiet)).toBe(false);
  });

  it('never marks a foundation edge as a main link', () => {
    expect(graph.edges.filter((edge) => edge.quiet).some((edge) => edge.main)).toBe(false);
  });
});

describe('outside systems', () => {
  it('carry a readable name and keep their id as the key', () => {
    const graph = macroGraph(view, texts);
    const cli = graph.systems.find((system) => system.system === 'claude-code-cli');

    expect(cli?.name).toBe('Claude Code CLI');
    expect(cli?.key).toBe('ext:claude-code-cli');
    expect(layoutMacro(graph, systemLinksFor(graph, 'ext:claude-code-cli')).layout.pos.get('ext:claude-code-cli')?.item.label).toBe('Claude Code CLI');
  });

  it('name the block of each link in words', () => {
    const graph = macroGraph(view, texts);

    for (const system of graph.systems) for (const link of system.links) expect(link.blockName).toBe(blockName(link.block));
  });
});
