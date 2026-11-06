import type { LanternPrFile } from '../../../src/main/lantern-types';
import { MACRO_MIN_FILES } from '../../../src/renderer/lib/lanternmacro';
import { macroViewWorld } from '../../helpers/macroview-world';
import { mapOf, node, pr } from '../../helpers/lantern-map';

const MACRO_SIZED_PR_ID = '31';
const CHANGED_EVERY = 4;

function macroSized(areas: number, features: number) {
  const world = macroViewWorld({ areas, features });
  const owned = world.paths.map((path) => node(path, 'component', { feature: world.blockByPath[path], platform: path.startsWith('api/') ? 'service' : 'storefront' }));
  const shared = Array.from({ length: Math.max(0, MACRO_MIN_FILES + 1 - owned.length) }, (_, index) => node(`api/shared/util-${index}.ts`, 'util', { platform: 'service' }));
  const nodes = [...owned, ...shared];
  const files: LanternPrFile[] = world.paths.filter((_, index) => index % CHANGED_EVERY === 0).map((path) => ({ path, kind: 'modified', mapped: true, reason: 'Changes the behaviour this feature owns.' }));
  const map = mapOf({ project: 'Orchard Market', nodes, total: nodes.length, prs: [pr(MACRO_SIZED_PR_ID, { title: 'Sized evaluation change', tip: 'sized-tip', ordered: true, files })] });
  const { paths: _paths, ...payload } = world;
  return { map, payload, changed: files.map((file) => file.path) };
}

export { MACRO_SIZED_PR_ID, macroSized };
