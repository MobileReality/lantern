import type { ProjectFile } from '../../../src/main/filecontent';
import type { LanternNode, LanternPrFile } from '../../../src/main/lantern';
import type { PrFileDiff } from '../../../src/main/lantern-prdiff';
import type { PrFile } from '../../../src/main/lantern-prfile';
import areasPayload from '../lantern-macro-areas-payload.json';
import { mapOf, node, pr } from '../../helpers/lantern-map';

const AREAS_PR_ID = '501';
const REVIEWED_BLOCKS = ['code-insight', 'projects-hub', 'pull-requests'];

const blockByPath = areasPayload.blockByPath as Record<string, string>;
const featureOf = (path: string) => (blockByPath[path].startsWith('core:') ? null : blockByPath[path]);
const nodes = Object.keys(blockByPath).map((path): LanternNode => node(path, 'logic', { feature: featureOf(path) }));
const files: LanternPrFile[] = REVIEWED_BLOCKS.map((block) => ({ path: Object.keys(blockByPath).find((path) => blockByPath[path] === block) as string, kind: 'modified', mapped: true }));

const areasPrDemo = mapOf({
  project: 'Areas with a pull request',
  nodes,
  total: nodes.length,
  prs: [pr(AREAS_PR_ID, { title: 'Touch three areas', tip: 'demo-tip-501', ordered: true, files })],
});

async function readAreasFile(path: string): Promise<ProjectFile> {
  return { exists: true, text: `live ${path}\n`, truncated: 0 };
}

async function readAreasPrFile(_pr: string, path: string): Promise<PrFile> {
  return { ok: true, text: `branch ${path}\n`, truncated: false, binary: false, version: 'branch' };
}

async function readAreasPrDiff(_pr: string, path: string): Promise<PrFileDiff> {
  return { ok: true, diff: `@@ -1 +1 @@\n-old ${path}\n+new ${path}`, truncated: false, binary: false };
}

export { AREAS_PR_ID, areasPrDemo, readAreasFile, readAreasPrDiff, readAreasPrFile };
