import type { Arrow, LanternFlowStory, LanternNode, LanternPlatform, LanternPrFile, LanternRelation } from '../../../src/main/lantern-types';
import type { MacroLoad } from '../../../src/main/lantern-macro-load';
import lab from '../lantern-macro-lab.json';
import { mapOf, node, pr } from '../../helpers/lantern-map';

type MacroLabPayload = Omit<Extract<MacroLoad, { ok: true }>, 'ok'>;

const MACRO_LAB_PR_ID = '77';

const nodes = lab.files.map(([path, role, feature, platform]): LanternNode => node(path as string, role as string, { feature: feature as string | null, platform: platform as string }));
const relations = lab.relations.map(([from, arrow, to, ext]): LanternRelation => ({ from: from as string, arrow: arrow as Arrow, to: to as string | null, ext: ext as string | null, symbol: null, label: '' }));
const files: LanternPrFile[] = lab.pr.files.map((file) => ({ path: file.path, kind: file.kind as LanternPrFile['kind'], mapped: true, reason: file.reason }));

const macroLabDemo = mapOf({
  project: 'Orchard Market',
  nodes,
  relations,
  features: lab.features,
  platforms: lab.platforms as LanternPlatform[],
  total: nodes.length,
  prs: [pr(MACRO_LAB_PR_ID, { title: lab.pr.title, tip: 'demo-tip-77', ordered: true, files, flow: lab.pr.flow as LanternFlowStory[] })],
});

const macroLabPayload = lab.payload as unknown as MacroLabPayload;

export { MACRO_LAB_PR_ID, macroLabDemo, macroLabPayload };
