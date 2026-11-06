import { describe, expect, it } from 'vitest';
import { resolvePlatform } from '../src/main/lantern-platforms';
import type { LanternPrFile } from '../src/main/lantern';
import type { MacroView } from '../src/main/lantern-macro';
import { derivePrImpact, edgeId, linkId, outsideCount } from '../src/renderer/lib/lanternmacropr';
import type { ImpactNode, ImpactRelation, PrImpactInput } from '../src/renderer/lib/lanternmacropr';
import { macroFixtureBlocks, macroFixtureOptions, macroFixtureRecords, macroFixtureView, repoPrRecord } from './helpers/lantern-macro-fixture';

const arrows = { '>': 0, '<': 0, '=': 0, '@': 0 };
const file = (path: string, kind: LanternPrFile['kind'] = 'modified'): LanternPrFile => ({ path, kind, mapped: true });
const node = (path: string, feature: string | null, role = 'util', platform: string | null = null): ImpactNode => ({ path, role, feature, platform });
const rel = (from: string, to: string | null, ext: string | null = null): ImpactRelation => ({ from, to, ext });

const TINY: MacroView = {
  recordCount: 7,
  testCount: 1,
  blocks: [
    { id: 'billing', files: 3 },
    { id: 'orders', files: 2 },
    { id: 'core:shared', files: 1 },
  ],
  edges: [
    { from: 'orders', to: 'billing', count: 2, arrows, strong: false },
    { from: 'billing', to: 'core:shared', count: 1, arrows, strong: false },
  ],
  crossBlockRelations: 3,
  external: [{ system: 'stripe', blocks: [{ block: 'billing', count: 1 }] }],
};
const BLOCKS = { 'src/billing/a.ts': 'billing', 'src/billing/b.ts': 'billing', 'src/billing/c.ts': 'billing', 'src/orders/a.ts': 'orders', 'src/orders/b.ts': 'orders', 'src/util.ts': 'core:shared' };
const NODES = [...Object.entries(BLOCKS).map(([path, block]) => node(path, block.startsWith('core:') ? null : block)), node('test/a.test.ts', null, 'test')];
const RELATIONS = [rel('src/orders/a.ts', 'src/billing/a.ts'), rel('src/billing/b.ts', 'src/util.ts'), rel('src/billing/c.ts', null, 'stripe'), rel('src/orders/b.ts', 'src/billing/b.ts')];

function impactOf(files: LanternPrFile[], extra: Partial<PrImpactInput> = {}) {
  return derivePrImpact({ view: TINY, blockByPath: BLOCKS, nodes: NODES, relations: RELATIONS, files, ...extra });
}

describe('which blocks a pull request touches', () => {
  it('counts the changed files per block, in the order the record lists them', () => {
    const impact = impactOf([file('src/billing/c.ts'), file('src/orders/a.ts'), file('src/billing/a.ts', 'added')]);

    expect([...impact.blocks.keys()].sort()).toEqual(['billing', 'orders']);
    expect(impact.blocks.get('billing')?.map((f) => f.path)).toEqual(['src/billing/c.ts', 'src/billing/a.ts']);
    expect(impact.blocks.get('orders')?.map((f) => f.path)).toEqual(['src/orders/a.ts']);
    expect(impact.changed).toBe(3);
  });

  it('marks nothing for a pull request that changes no mapped file', () => {
    const impact = impactOf([file('docs/readme.md')]);

    expect(impact.blocks.size).toBe(0);
    expect(impact.edges.size + impact.systems.size + impact.links.size).toBe(0);
    expect(impact.other.unmapped.map((f) => f.path)).toEqual(['docs/readme.md']);
  });

  it('marks a block for a removed file and for an added file with a feature tag', () => {
    const added = node('src/orders/new.ts', 'orders');

    const impact = impactOf([file('src/billing/b.ts', 'removed'), file('src/orders/new.ts', 'added')], { nodes: [...NODES, added] });

    expect(impact.blocks.get('billing')?.map((f) => f.kind)).toEqual(['removed']);
    expect(impact.blocks.get('orders')?.map((f) => f.kind)).toEqual(['added']);
  });
});

describe('which links and outside systems a pull request touches', () => {
  it('marks a link that carries a relation line from a changed file', () => {
    const impact = impactOf([file('src/orders/a.ts')]);

    expect([...impact.edges]).toEqual([edgeId('orders', 'billing')]);
  });

  it('marks a link that carries a relation line to a changed file', () => {
    const impact = impactOf([file('src/billing/a.ts')]);

    expect([...impact.edges]).toEqual([edgeId('orders', 'billing')]);
  });

  it('leaves a link alone when only unchanged files stand on its two ends', () => {
    const impact = impactOf([file('src/billing/c.ts')]);

    expect(impact.edges.size).toBe(0);
  });

  it('does not mark a relation that stays inside one block', () => {
    const impact = impactOf([file('src/billing/a.ts')], { relations: [rel('src/billing/a.ts', 'src/billing/b.ts')] });

    expect(impact.edges.size).toBe(0);
  });

  it('does not invent a link the macro view does not draw', () => {
    const impact = impactOf([file('src/orders/a.ts')], { relations: [rel('src/orders/a.ts', 'src/util.ts')] });

    expect(impact.edges.size).toBe(0);
  });

  it('marks the outside system a changed file talks to, and the line from its block', () => {
    const impact = impactOf([file('src/billing/c.ts')]);

    expect([...impact.systems]).toEqual(['stripe']);
    expect([...impact.links]).toEqual([linkId('billing', 'stripe')]);
  });

  it('leaves an outside system alone when only an unchanged file talks to it', () => {
    const impact = impactOf([file('src/billing/a.ts')]);

    expect(impact.systems.size).toBe(0);
    expect(impact.links.size).toBe(0);
  });
});

describe('files that are not in a feature block', () => {
  it('counts a file the map does not know, a test file and a file whose feature has no block', () => {
    const stray = node('src/orders/stray.ts', 'orphaned-feature');

    const impact = impactOf([file('src/lost.ts', 'added'), file('test/a.test.ts'), file('src/orders/stray.ts', 'added')], { nodes: [...NODES, stray] });

    expect(impact.other.unmapped.map((f) => f.path)).toEqual(['src/lost.ts']);
    expect(impact.other.tests.map((f) => f.path)).toEqual(['test/a.test.ts']);
    expect(impact.other.unplaced.map((f) => f.path)).toEqual(['src/orders/stray.ts']);
    expect(impact.blocks.size).toBe(0);
    expect(outsideCount(impact.other)).toBe(3);
  });

  it('marks the shared foundation for a file without a feature, and still counts it in the note', () => {
    const impact = impactOf([file('src/util.ts')]);

    expect(impact.blocks.get('core:shared')?.map((f) => f.path)).toEqual(['src/util.ts']);
    expect(impact.other.foundation.map((f) => f.path)).toEqual(['src/util.ts']);
    expect(outsideCount(impact.other)).toBe(1);
  });

  it('places a new file with no feature in its platform foundation, or in the only one there is', () => {
    const tabbed = { ...TINY, blocks: [...TINY.blocks, { id: 'core:web', files: 1 }] };
    const fresh = [file('src/web/x.ts', 'added'), file('src/y.ts', 'added')];
    const nodes = [...NODES, node('src/web/x.ts', null, 'util', 'web'), node('src/y.ts', null)];

    expect(derivePrImpact({ view: tabbed, blockByPath: BLOCKS, nodes, relations: [], files: fresh }).blocks.get('core:web')?.map((f) => f.path)).toEqual(['src/web/x.ts']);
    expect(derivePrImpact({ view: TINY, blockByPath: BLOCKS, nodes, relations: [], files: [fresh[1]] }).blocks.get('core:shared')?.map((f) => f.path)).toEqual(['src/y.ts']);
  });
});

const GOAL_PR = '108';
const KNOWN_BLOCKS = 14;
const EXPECTED_COUNTS: Record<string, number> = { 'code-insight': 1, 'core:desktop': 13, 'core:shared': 2, 'projects-hub': 4, 'serve-web': 1 };

describe(`pull request #${GOAL_PR} on the pinned macro fixture`, () => {
  const view = macroFixtureView();
  const records = macroFixtureRecords();
  const options = macroFixtureOptions();
  const pr = repoPrRecord(GOAL_PR);
  const files = pr.files.map((f): LanternPrFile => ({ ...f, mapped: true }));
  const nodes = records.map((r) => node(r.path, r.feature, r.role));
  const relations = records.flatMap((r) => r.relations.map((x) => rel(r.path, x.to, x.ext)));
  const impact = derivePrImpact({ view, blockByPath: macroFixtureBlocks(), nodes, relations, files });

  const expectedBlock = (path: string) => {
    const record = records.find((r) => r.path === path);
    if (!record || record.role === 'test') return null;
    return record.feature ?? `core:${resolvePlatform(options.platforms, path)}`;
  };

  it('puts every changed file that is in the map into exactly the block deriveMacroView counts it in', () => {
    const expected = new Map<string, string[]>();
    for (const f of files) {
      const block = expectedBlock(f.path);
      if (block) expected.set(block, [...(expected.get(block) ?? []), f.path]);
    }

    expect(expected.size).toBeGreaterThan(3);
    expect(new Map([...impact.blocks].map(([block, list]) => [block, list.map((f) => f.path)]))).toEqual(expected);
  });

  it('marks every block that holds a changed file, with its count, and no block that holds none', () => {
    const counts = Object.fromEntries([...impact.blocks].map(([block, list]) => [block, list.length]).sort());

    expect(counts).toEqual(EXPECTED_COUNTS);
    for (const block of view.blocks) expect(impact.blocks.has(block.id)).toBe(block.id in EXPECTED_COUNTS);
    for (const [block, list] of impact.blocks) expect(list.length).toBeLessThanOrEqual(view.blocks.find((b) => b.id === block)?.files ?? -1);
    expect(KNOWN_BLOCKS).toBe(view.blocks.length);
  });

  it('leaves out of the blocks only the files the macro view cannot place, and counts them', () => {
    const placed = [...impact.blocks.values()].reduce((sum, list) => sum + list.length, 0);

    expect(placed + impact.other.unmapped.length + impact.other.tests.length + impact.other.unplaced.length).toBe(files.length);
    expect(impact.changed).toBe(placed);
  });

  it('names the files outside any block: not in the map, test files, shared foundation', () => {
    expect(impact.other.unmapped.map((f) => f.path)).toEqual(['src/cli/lantern', 'README.md', 'CONTRIBUTING.md']);
    expect(impact.other.tests).toHaveLength(11);
    expect(impact.other.foundation).toHaveLength(15);
    expect(outsideCount(impact.other)).toBe(29);
  });

  it('marks only links the view draws, each with a changed file on one end', () => {
    const drawn = new Set(view.edges.map((edge) => edgeId(edge.from, edge.to)));

    expect(impact.edges.size).toBe(26);
    for (const id of impact.edges) expect(drawn.has(id)).toBe(true);
    expect(impact.edges.has(edgeId('lantern-map', 'delegate-runs'))).toBe(false);
    expect(impact.edges.has(edgeId('projects-hub', 'agent-runs'))).toBe(true);
  });

  it('marks the outside systems the changed files talk to', () => {
    expect([...impact.systems].sort()).toEqual(['osascript', 'vscode-serve-web']);
    expect([...impact.links].sort()).toEqual([linkId('core:desktop', 'vscode-serve-web'), linkId('projects-hub', 'osascript')]);
  });
});
