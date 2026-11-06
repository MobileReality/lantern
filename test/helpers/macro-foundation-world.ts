import type { LanternArea } from '../../src/main/lantern-areas';
import { MIN_STRONG_EDGE, deriveMacroView } from '../../src/main/lantern-macro';
import { deriveMacroAreas } from '../../src/main/lantern-macro-areas';
import type { MacroAreas } from '../../src/main/lantern-macro-areas';
import { macroBlocksByPath } from '../../src/main/lantern-macro-files';
import { macroSystemsByPath } from '../../src/main/lantern-macro-systems';
import type { MacroLoad } from '../../src/main/lantern-macro-load';
import { parseMapFile } from '../../src/main/lantern-parse';
import { parsePlatforms } from '../../src/main/lantern-platforms';
import type { AreasPayload } from '../../src/renderer/lib/macroview/types';
import { mapText } from './lantern-macro-areas-fixture';
import type { FixtureFile } from './lantern-macro-areas-fixture';

type Loaded = Extract<MacroLoad, { ok: true }>;

const PLATFORM_RULES = ['pane web pane/**', 'gate backend gate/**', 'relay-a other relay-a/**', 'ops infra ops/**'].join('\n');

const FILES: FixtureFile[] = [
  { path: 'gate/orders/api.ts', feature: 'orders', rel: [['gate/core/entry.ts', 2]] },
  { path: 'gate/billing/api.ts', feature: 'billing', rel: [['gate/orders/api.ts', 3], ['gate/core/entry.ts']] },
  { path: 'gate/tickets/api.ts', feature: 'tickets', rel: [['gate/orders/api.ts', 2]] },
  { path: 'gate/loose/api.ts', feature: 'loose' },
  { path: 'pane/orders/view.ts', feature: 'orders', rel: [['gate/orders/api.ts', 4]] },
  { path: 'pane/orders/list.ts', feature: 'orders' },
  { path: 'pane/tickets/view.ts', feature: 'tickets', rel: [['pane/shell.ts']] },
  { path: 'gate/orders/api.test.ts', role: 'test', feature: 'orders', rel: [['gate/orders/api.ts', 9]] },
  { path: 'gate/core/entry.ts', rel: [['gate/tickets/api.ts', 2], ['gate/orders/api.ts']] },
  { path: 'pane/shell.ts' },
  { path: 'relay-a/main.ts', rel: [['gate/orders/api.ts', 3], ['gate/core/entry.ts', 2], ['pane/shell.ts']] },
  { path: 'ops/build.yml', rel: [['gate/core/entry.ts'], ['relay-a/main.ts', 2], ['pane/shell.ts']] },
];

const AREA_LIST: LanternArea[] = [
  { id: 'selling', description: 'taking and billing orders', features: ['orders', 'billing'] },
  { id: 'support', description: 'answering customers', features: ['tickets'] },
];

const FEATURE_IDS = ['orders', 'billing', 'tickets', 'loose'];

const FEATURE_TEXTS: Record<string, string> = {
  orders: 'taking an order from the first click to the receipt',
  billing: 'charging for an order and sending the bill',
  tickets: 'answering what customers ask',
  loose: 'something not placed yet',
};

function foundationRecords(files: FixtureFile[] = FILES) {
  return parseMapFile(mapText(files), 'synthetic').records;
}

function foundationAreas(rules = PLATFORM_RULES, files: FixtureFile[] = FILES): MacroAreas {
  const derived = deriveMacroAreas(foundationRecords(files), parsePlatforms(rules, []), AREA_LIST, new Set(FEATURE_IDS));
  if (!derived.ok) throw new Error(derived.warning);
  return derived.areas;
}

function foundationPayload(rules = PLATFORM_RULES, files: FixtureFile[] = FILES): Loaded {
  const records = foundationRecords(files);
  const options = { platforms: parsePlatforms(rules, []) };
  return { ok: true, view: deriveMacroView(records, options), texts: FEATURE_TEXTS, blockByPath: macroBlocksByPath(records, options), systemsByPath: macroSystemsByPath(records), minStrongEdge: MIN_STRONG_EDGE, areas: foundationAreas(rules, files) };
}

function foundationAreasPayload(): AreasPayload {
  const { view, texts, blockByPath, systemsByPath, minStrongEdge, areas } = foundationPayload();
  if (!areas) throw new Error('no areas');
  return { view, texts, blockByPath, systemsByPath, minStrongEdge, areas };
}

export { AREA_LIST, FEATURE_IDS, FILES, PLATFORM_RULES, foundationAreas, foundationPayload, foundationRecords, foundationAreasPayload };
export type { Loaded };
