import type { LanternArea } from '../../src/main/lantern-areas';
import { MIN_STRONG_EDGE, deriveMacroView } from '../../src/main/lantern-macro';
import { deriveMacroAreas } from '../../src/main/lantern-macro-areas';
import type { MacroAreas } from '../../src/main/lantern-macro-areas';
import { macroBlocksByPath } from '../../src/main/lantern-macro-files';
import { macroSystemsByPath } from '../../src/main/lantern-macro-systems';
import { parseMapFile } from '../../src/main/lantern-parse';
import { parsePlatforms } from '../../src/main/lantern-platforms';
import type { AreasPayload } from '../../src/renderer/lib/macroview/types';
import { mapText } from './lantern-macro-areas-fixture';
import type { FixtureFile } from './lantern-macro-areas-fixture';
import type { Loaded } from './macro-foundation-world';

const USES_RULES = ['gate backend gate/**', 'bot-a other bot-a/**', 'bot-b other bot-b/**'].join('\n');

const USES_FILES: FixtureFile[] = [
  { path: 'gate/users/api.ts', feature: 'users' },
  { path: 'gate/roles/api.ts', feature: 'roles' },
  { path: 'gate/orders/api.ts', feature: 'orders', rel: [['gate/users/api.ts']] },
  { path: 'gate/core/entry.ts' },
  { path: 'bot-a/people/users.ts', feature: 'users', rel: [['gate/users/api.ts', 1, '=']] },
  { path: 'bot-a/people/roles.ts', feature: 'roles', rel: [['gate/roles/api.ts', 1, '<']] },
  { path: 'bot-a/gateway.ts', feature: 'hooks', rel: [['gate/orders/api.ts'], ['gate/users/api.ts']] },
  { path: 'bot-a/boot.ts', rel: [['bot-a/gateway.ts'], ['gate/orders/api.ts'], ['gate/core/entry.ts']] },
  {
    path: 'bot-b/gateway.ts',
    feature: 'hooks',
    rel: [['gate/users/api.ts', 2, '='], ['gate/roles/api.ts', 1, '<'], ['gate/orders/api.ts'], ['gate/users/api.ts', 1, '@'], ['ext:identity'], ['gate/core/entry.ts']],
  },
  { path: 'bot-b/gateway.test.ts', role: 'test', feature: 'hooks', rel: [['gate/users/api.ts', 5]] },
  { path: 'bot-b/boot.ts' },
];

const USES_AREAS: LanternArea[] = [
  { id: 'people', description: 'who the customers are', features: ['users', 'roles'] },
  { id: 'selling', description: 'taking orders', features: ['orders'] },
  { id: 'channels', description: 'talking to people in chat', features: ['hooks'] },
];

const USES_FEATURES = ['users', 'roles', 'orders', 'hooks'];

const USES_TEXTS: Record<string, string> = {
  users: 'who a customer is',
  roles: 'what a customer may do',
  orders: 'taking an order',
  hooks: 'talking to people in chat',
};

function usesRecords(files: FixtureFile[] = USES_FILES) {
  return parseMapFile(mapText(files), 'synthetic').records;
}

function usesAreas(rules = USES_RULES, files: FixtureFile[] = USES_FILES): MacroAreas {
  const derived = deriveMacroAreas(usesRecords(files), parsePlatforms(rules, []), USES_AREAS, new Set(USES_FEATURES));
  if (!derived.ok) throw new Error(derived.warning);
  return derived.areas;
}

function usesPayload(rules = USES_RULES, files: FixtureFile[] = USES_FILES): Loaded {
  const records = usesRecords(files);
  const options = { platforms: parsePlatforms(rules, []) };
  return { ok: true, view: deriveMacroView(records, options), texts: USES_TEXTS, blockByPath: macroBlocksByPath(records, options), systemsByPath: macroSystemsByPath(records), minStrongEdge: MIN_STRONG_EDGE, areas: usesAreas(rules, files) };
}

function usesAreasPayload(): AreasPayload {
  const { view, texts, blockByPath, systemsByPath, minStrongEdge, areas } = usesPayload();
  if (!areas) throw new Error('no areas');
  return { view, texts, blockByPath, systemsByPath, minStrongEdge, areas };
}

export { USES_AREAS, USES_FEATURES, USES_FILES, USES_RULES, usesAreas, usesPayload, usesRecords, usesAreasPayload };
