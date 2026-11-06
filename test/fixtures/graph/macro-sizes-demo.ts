import type { Arrow, LanternNode, LanternPlatform, LanternRelation } from '../../../src/main/lantern-types';
import type { MacroLoad } from '../../../src/main/lantern-macro-load';
import sizes from '../lantern-macro-sizes.json';
import { mapOf, node } from '../../helpers/lantern-map';

type MacroPayload = Omit<Extract<MacroLoad, { ok: true }>, 'ok'>;
type SizeName = keyof typeof sizes;

function macroSizeDemo(name: SizeName) {
  const world = sizes[name];
  const nodes = world.files.map(([path, role, feature, platform]): LanternNode => node(path as string, role as string, { feature: feature as string | null, platform: platform as string }));
  const relations = world.relations.map(([from, arrow, to, ext]): LanternRelation => ({ from: from as string, arrow: arrow as Arrow, to: to as string | null, ext: ext as string | null, symbol: null, label: '' }));
  const map = mapOf({ project: world.project, nodes, relations, features: world.features, platforms: world.platforms as LanternPlatform[], total: nodes.length });
  return { map, payload: world.payload as unknown as MacroPayload };
}

export { macroSizeDemo };
export type { SizeName };
