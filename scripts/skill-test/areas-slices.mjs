import path from 'node:path';
import { runAgent } from './agent.mjs';
import { areasCheck, hasAreasFile, judgeAreasAdd, judgeAreasRebuilt, judgeAreasSetup, parseTree } from './areas-checks.mjs';
import { createAreasProject } from './areas-fixtures.mjs';
import { installSkills, snapshotSources, validateSettled } from './fixtures.mjs';
import { AREAS_ADD_FAILING_PROMPT, AREAS_ADD_PROMPT, AREAS_MERGED_PROMPT, AREAS_PROMPT } from './prompts.mjs';

const OK = (reason, extra = {}) => ({ ...extra, ok: true, reason });
const FAIL = (reason, extra = {}) => ({ ...extra, ok: false, reason });
const MIN_RECORDS = 121;

function prepare(ctx, key, tree) {
  const root = path.join(ctx.tmp, key);
  createAreasProject(root, { tree });
  installSkills(root);
  ctx.areas = { ...ctx.areas, [key]: { root, before: snapshotSources(root), beforeTree: tree ? parseTree(root) : null } };
  return ctx.areas[key];
}

function areasFixture(ctx) {
  const fixture = prepare(ctx, 'areas-setup', null);
  const count = Object.keys(fixture.before).length;
  if (count < MIN_RECORDS) return FAIL(`${count} mapped files, the loop needs more than 120`);
  if (hasAreasFile(fixture.root)) return FAIL('the setup fixture must start without .lantern/areas');
  if (validateSettled(fixture.root).status !== 0) return FAIL('the fixture map must be settled');
  const missing = areasCheck(fixture.root);
  if (missing.status !== 2) return FAIL(`areas.mjs check should exit 2 without a tree, got ${missing.status}`);
  prepare(ctx, 'areas-add', 'five');
  for (const key of ['areas-eighth', 'areas-fails', 'areas-merged']) {
    prepare(ctx, key, 'seven');
    const sevenFull = areasCheck(ctx.areas[key].root);
    if (sevenFull.status !== 0) return FAIL(`the seven-area tree must pass check before the delegate runs (${key}), exit ${sevenFull.status}`);
  }
  return OK(`${count} files in 12 features, settled, no tree yet; the five- and seven-area trees pass check`);
}

function runAreas(key, name, prompt, judge, extra = () => ({})) {
  return async (ctx) => {
    const fixture = ctx.areas[key];
    const agent = await runAgent(ctx, { name, cwd: fixture.root, prompt });
    if (!agent.ok) return agent;
    return { ...judge(fixture.root, { ...fixture, ...extra() }), costUsd: agent.costUsd };
  };
}

export const AREAS_SLICES = [
  { name: 'areas-fixture', paid: false, doc: '121 mapped files in 12 features with no .lantern/areas (check exits 2); a five-area and a seven-area tree that pass check', run: areasFixture },
  { name: 'areas-setup', paid: true, isolated: true, doc: 'one agent call runs the Areas loop; the tree it leaves passes areas.mjs check and validate --settled, or the flat view stays', run: runAreas('areas-setup', 'areas-setup', AREAS_PROMPT, judgeAreasSetup) },
  { name: 'areas-delegate-places', paid: true, isolated: true, doc: 'a delegate adds a feature to a five-area tree; the feature is a leaf and the tree still passes check', run: runAreas('areas-add', 'areas-add', AREAS_ADD_PROMPT, judgeAreasAdd, () => ({ expectPlaced: true })) },
  { name: 'areas-delegate-eighth', paid: true, isolated: true, doc: 'a delegate adds a feature that fits no area of a full seven-area tree and rebuilds the areas in its PR; the new tree places every feature and passes check with no "To assign"', run: runAreas('areas-eighth', 'areas-eighth', AREAS_ADD_PROMPT, judgeAreasRebuilt) },
  { name: 'areas-delegate-loop-fails', paid: true, isolated: true, doc: 'the same case, but the areas loop fails within its cap; the feature shows under "To assign" and the old tree is intact and passes check --allow-unassigned', run: runAreas('areas-fails', 'areas-fails', AREAS_ADD_FAILING_PROMPT, judgeAreasAdd, () => ({ expectPlaced: false })) },
  { name: 'areas-delegate-merged', paid: true, isolated: true, doc: 'the target branch tree replaced the delegate tree at ship time; the delegate re-places only its own feature in it, the target tree keeps every part and passes check', run: runAreas('areas-merged', 'areas-merged', AREAS_MERGED_PROMPT, judgeAreasAdd, () => ({ expectPlaced: true })) },
];
