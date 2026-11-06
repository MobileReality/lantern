import fs from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { loadMacro } from '../src/main/lantern';
import type { LanternArea } from '../src/main/lantern-areas';
import { MIN_STRONG_EDGE, deriveMacroView } from '../src/main/lantern-macro';
import { deriveMacroAreas } from '../src/main/lantern-macro-areas';
import type { MacroAreas } from '../src/main/lantern-macro-areas';
import { macroBlocksByPath } from '../src/main/lantern-macro-files';
import { readRegisteredMacro } from '../src/main/lantern-macro-load';
import { parseMapFile } from '../src/main/lantern-parse';
import { parsePlatforms } from '../src/main/lantern-platforms';
import { macroSystemsByPath } from '../src/main/lantern-macro-systems';
import { FIXTURE_ROOT, macroFixtureBlocks, macroFixtureRecords, macroFixtureView } from './helpers/lantern-macro-fixture';
import { AREA_TEXTS, FEATURES, PLATFORMS, areasProject, mapText } from './helpers/lantern-macro-areas-fixture';

const records = parseMapFile(mapText(), 'fixture').records;
const platforms = parsePlatforms(PLATFORMS, []);
const AREA_LIST: LanternArea[] = [
  { id: 'order-handling', description: AREA_TEXTS['order-handling'], features: ['catalog', 'orders', 'search'] },
  { id: 'money-matters', description: AREA_TEXTS['money-matters'], features: ['payments', 'invoices'] },
  { id: 'delivery-and-returns', description: AREA_TEXTS['delivery-and-returns'], features: ['shipping', 'returns'] },
  { id: 'people-and-insight', description: AREA_TEXTS['people-and-insight'], features: ['accounts', 'reports'] },
];
const declared = new Set(FEATURES);

function derive(areas: LanternArea[] = AREA_LIST): MacroAreas {
  const derived = deriveMacroAreas(records, platforms, areas, declared);
  if (!derived.ok) throw new Error(derived.warning);
  return derived.areas;
}

const scratch: string[] = [];
const project = (...args: Parameters<typeof areasProject>) => {
  const root = areasProject(...args);
  scratch.push(root);
  return root;
};
afterEach(() => {
  for (const dir of scratch.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

async function loaded(root: string) {
  const result = await readRegisteredMacro(() => true, loadMacro, root);
  if (!result.ok) throw new Error(result.error);
  return result;
}

describe('areas level 0', () => {
  it('has one node per area, in file order, with name, purpose, members and file count', () => {
    const { areas } = derive().level0;

    expect(areas.map((a) => [a.id, a.name, a.files, a.features])).toEqual([
      ['order-handling', 'Order handling', 5, ['catalog', 'orders', 'search']],
      ['money-matters', 'Money matters', 3, ['payments', 'invoices']],
      ['delivery-and-returns', 'Delivery and returns', 2, ['shipping', 'returns']],
      ['people-and-insight', 'People and insight', 3, ['accounts', 'reports']],
    ]);
    expect(areas[0].purpose).toBe('finding products and taking customer orders');
  });

  it('keeps file order as draw order and carries no quiet flag', () => {
    const { areas } = derive().level0;

    expect(areas.map((a) => a.id)).toEqual(AREA_LIST.map((a) => a.id));
    for (const area of areas) expect(area).not.toHaveProperty('quiet');
  });

  it('leaves out an area whose features have no records, so every listed area has a level 1', () => {
    const ghost = [...AREA_LIST, { id: 'idle-corner', description: '', features: [] as string[] }];
    const areas = deriveMacroAreas(records, platforms, ghost, declared);

    expect(areas.ok).toBe(false);
    const recordless = [...AREA_LIST, { id: 'idle-corner', description: '', features: ['unused'] }];
    const derived = deriveMacroAreas(records, platforms, recordless, new Set([...declared, 'unused']));
    if (!derived.ok) throw new Error(derived.warning);
    expect(derived.areas.level0.areas.map((a) => a.id)).not.toContain('idle-corner');
    for (const area of derived.areas.level0.areas) expect(derived.areas.details).toHaveProperty(area.id);
  });

  it('keeps the foundation band as the core blocks, outside every area', () => {
    expect(derive().level0.foundation).toEqual([
      { id: 'core:portal', files: 1 },
      { id: 'core:service', files: 1 },
    ]);
  });

  it('puts a feature with records and no area into To assign, which is absent when nothing is unplaced', () => {
    const withTray = derive().level0.toAssign;
    expect(withTray).toEqual({ id: 'to-assign', name: 'To assign', features: ['loyalty'], files: 1, platforms: [{ platform: 'service', files: 1 }], uses: [] });

    const everyone = [...AREA_LIST, { id: 'loose-ends', description: '', features: ['loyalty'] }];
    expect(derive(everyone).level0.toAssign).toBeNull();
  });

  it('aggregates feature edges into area links, both directions kept', () => {
    const { links } = derive().level0;

    expect(links.map((l) => `${l.from} -> ${l.to}: ${l.count}`)).toEqual([
      'order-handling -> money-matters: 4',
      'delivery-and-returns -> money-matters: 2',
      'delivery-and-returns -> order-handling: 2',
      'people-and-insight -> order-handling: 2',
      'to-assign -> order-handling: 2',
      'money-matters -> order-handling: 1',
      'people-and-insight -> delivery-and-returns: 1',
      'people-and-insight -> money-matters: 1',
      'to-assign -> people-and-insight: 1',
    ]);
  });

  it('picks main links by the calm view coverage rule: the fewest pairs carrying 80% of the lines', () => {
    const { mainLinks } = derive().level0;

    expect(mainLinks.map((l) => `${l.a}|${l.b}: ${l.count}`)).toEqual([
      'money-matters|order-handling: 5',
      'delivery-and-returns|money-matters: 2',
      'delivery-and-returns|order-handling: 2',
      'order-handling|people-and-insight: 2',
      'order-handling|to-assign: 2',
    ]);
  });

  it('counts the outside systems of each area, for show-on-selection, and none for the foundation', () => {
    const { systems } = derive().level0;

    expect(systems).toEqual({
      'order-handling': [{ system: 'mail-relay', count: 1 }, { system: 'search-engine', count: 1 }],
      'money-matters': [{ system: 'payment-gateway', count: 2 }, { system: 'mail-relay', count: 1 }],
      'delivery-and-returns': [{ system: 'carrier-api', count: 1 }, { system: 'mail-relay', count: 1 }],
      'people-and-insight': [{ system: 'object-store', count: 1 }],
      'to-assign': [],
    });
  });

  it('loses no feature edge: area links, edges inside areas and edges to the foundation add up to the flat view', () => {
    const flat = deriveMacroView(records, { platforms });
    const areas = derive();
    const between = areas.level0.links.reduce((sum, link) => sum + link.count, 0);
    const inside = Object.values(areas.details).reduce((sum, detail) => sum + detail.edges.reduce((s, e) => s + e.count, 0), 0);
    const toFoundation = flat.edges.filter((e) => e.from.startsWith('core:') || e.to.startsWith('core:')).reduce((sum, e) => sum + e.count, 0);

    expect(between + inside + toFoundation).toBe(flat.crossBlockRelations);
    expect(between).toBe(16);
    expect(inside).toBe(13);
  });
});

describe('areas level 1', () => {
  it('shows the feature blocks of the biggest area, the edges between them and its main links', () => {
    const detail = derive().details['order-handling'];

    expect(detail.blocks).toEqual([{ id: 'catalog', files: 2 }, { id: 'orders', files: 2 }, { id: 'search', files: 1 }]);
    expect(detail.edges.map((e) => `${e.from} -> ${e.to}: ${e.count}`)).toEqual(['catalog -> orders: 3', 'catalog -> search: 2', 'orders -> catalog: 1', 'search -> catalog: 1']);
    expect(detail.mainLinks).toEqual([{ a: 'catalog', b: 'orders', count: 4 }, { a: 'catalog', b: 'search', count: 3 }]);
  });

  it('draws one stub per other area it relates to, with both directions counted', () => {
    const { stubs } = derive().details['order-handling'];

    expect(stubs.map((s) => [s.id, s.name, s.out, s.in, s.count])).toEqual([
      ['money-matters', 'Money matters', 4, 1, 5],
      ['delivery-and-returns', 'Delivery and returns', 0, 2, 2],
      ['people-and-insight', 'People and insight', 0, 2, 2],
      ['to-assign', 'To assign', 0, 2, 2],
    ]);
  });

  it('lists its own outside systems and leaves the other areas out', () => {
    expect(derive().details['order-handling'].systems).toEqual([{ system: 'mail-relay', count: 1 }, { system: 'search-engine', count: 1 }]);
    expect(derive().details['money-matters'].systems).toEqual([{ system: 'payment-gateway', count: 2 }, { system: 'mail-relay', count: 1 }]);
  });

  it('has no stub for the foundation and a level 1 for To assign too', () => {
    const areas = derive();
    for (const detail of Object.values(areas.details)) expect(detail.stubs.some((s) => s.id.startsWith('core:'))).toBe(false);
    expect(areas.details['to-assign'].blocks).toEqual([{ id: 'loyalty', files: 1 }]);
  });
});

describe('areas derivation is stable', () => {
  it('gives the same result on every run and for any order of the records', () => {
    const first = JSON.stringify(derive());

    expect(JSON.stringify(derive())).toBe(first);
    const shuffled = deriveMacroAreas([...records].reverse(), platforms, AREA_LIST, declared);
    expect(shuffled.ok && JSON.stringify(shuffled.areas)).toBe(first);
  });

  it('rejects a tree it cannot place without throwing', () => {
    const twice = [...AREA_LIST, { id: 'again', description: '', features: ['catalog'] }];
    const unknown = [{ id: 'order-handling', description: '', features: ['catalog', 'nothing-like-it'] }];

    expect(deriveMacroAreas(records, platforms, twice, declared)).toEqual({ ok: false, warning: 'feature "catalog" is listed twice' });
    expect(deriveMacroAreas(records, platforms, unknown, declared)).toEqual({ ok: false, warning: 'feature "nothing-like-it" is not declared in .lantern/features' });
    expect(deriveMacroAreas(records, platforms, [], declared).ok).toBe(false);
    const clash = [{ id: 'orders', description: '', features: ['catalog'] }];
    expect(deriveMacroAreas(records, platforms, clash, declared)).toEqual({ ok: false, warning: 'area "orders" is also a feature id' });
  });
});

describe('the lantern:macro payload with areas', () => {
  it('carries level 0 and every level 1 when the project has an areas file', async () => {
    const result = await loaded(project());

    expect(result.areas?.level0.areas.map((a) => a.id)).toEqual(AREA_LIST.map((a) => a.id));
    expect(Object.keys(result.areas?.details ?? {}).sort()).toEqual([...AREA_LIST.map((a) => a.id), 'to-assign'].sort());
    expect(result.areasWarning).toBeUndefined();
    expect(result.areas).toEqual(derive());
  });

  it('leaves the flat view exactly as it was', async () => {
    const withAreas = await loaded(project());
    const without = await loaded(project({ '.lantern/areas': null }));

    expect(withAreas.view).toEqual(without.view);
    expect(withAreas.blockByPath).toEqual(without.blockByPath);
  });

  it('is byte for byte today\'s payload plus the areas hint when there is no areas file', async () => {
    const result = await readRegisteredMacro(() => true, loadMacro, FIXTURE_ROOT);

    const today = { ok: true, view: macroFixtureView(), texts: {}, blockByPath: macroFixtureBlocks(), systemsByPath: macroSystemsByPath(macroFixtureRecords()), minStrongEdge: MIN_STRONG_EDGE, areasHint: true };
    expect(JSON.stringify(result)).toBe(JSON.stringify(today));
    expect(Object.keys(result)).not.toContain('areas');
    expect(Object.keys(result)).not.toContain('areasWarning');
  });

  it('keeps the field when only warnings apply, such as a feature in To assign', async () => {
    const result = await loaded(project());

    expect(result.areas?.level0.toAssign?.features).toEqual(['loyalty']);
    expect(result.areasWarning).toBeUndefined();
  });

  it('sends no areas and one warning line for an areas file with errors', async () => {
    const broken = project({ '.lantern/areas': 'order-handling\n  catalog\n\tbroken\n' });

    const result = await loaded(broken);

    expect(result).not.toHaveProperty('areas');
    expect(result.areasWarning).toMatch(/^Areas ignored, the flat view is shown: \.lantern\/areas:3: /);
    expect(result.areasWarning).not.toContain('\n');
    expect(result.view).toEqual((await loaded(project({ '.lantern/areas': null }))).view);
  });

  it('sends no areas and a warning for a leaf that is no feature, or listed twice', async () => {
    const unknown = await loaded(project({ '.lantern/areas': 'order-handling\n  catalog\n  ghost\n' }));
    const twice = await loaded(project({ '.lantern/areas': 'order-handling\n  catalog\nmoney-matters\n  catalog\n' }));

    expect(unknown).not.toHaveProperty('areas');
    expect(unknown.areasWarning).toContain('"ghost" is not declared');
    expect(twice).not.toHaveProperty('areas');
    expect(twice.areasWarning).toContain('"catalog" is listed twice');
  });

  it('takes the purpose from the areas text file of the map language', async () => {
    const result = await loaded(project());

    expect(result.areas?.level0.areas[1].purpose).toBe('charging customers and sending invoices');
  });
});

describe('the fixture itself', () => {
  it('has ten features, a foundation block per platform and a portal and a service platform', () => {
    const blocks = macroBlocksByPath(records, { platforms });

    expect(new Set(Object.values(blocks))).toEqual(new Set([...FEATURES, 'core:portal', 'core:service']));
  });
});
