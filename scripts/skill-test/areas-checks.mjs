import fs from 'node:fs';
import path from 'node:path';
import { changedSources, runScript, SETUP_SCRIPTS, validateSettled } from './fixtures.mjs';
import { NEW_FEATURE } from './areas-fixtures.mjs';

const OK = (reason) => ({ ok: true, reason });
const FAIL = (reason, offenders = []) => ({ ok: false, reason: offenders.length ? `${reason}: ${offenders.join('; ')}` : reason });
const MAX_REASONS = 4;

export const areasCheck = (root, args = []) => runScript(path.join(SETUP_SCRIPTS, 'areas.mjs'), [root, 'check', ...args], root);
export const hasAreasFile = (root) => fs.existsSync(path.join(root, '.lantern', 'areas'));

export function parseTree(root) {
  const tree = {};
  let area = null;
  for (const line of fs.readFileSync(path.join(root, '.lantern', 'areas'), 'utf8').split('\n')) {
    if (!line.trim() || line.startsWith('#')) continue;
    if (line.startsWith('  ')) tree[area].push(line.trim());
    else {
      area = line.trim();
      tree[area] = [];
    }
  }
  return tree;
}

const failedReasons = (check) => check.stdout.split('\n').filter((l) => l.startsWith('        - ')).map((l) => l.trim().slice(2)).slice(0, MAX_REASONS);

function settledProblem(root) {
  const settled = validateSettled(root);
  if (settled.status === 0 && /^OK$/m.test(settled.stdout)) return null;
  return FAIL(`validate --settled exit ${settled.status}`, settled.stdout.split('\n').filter((l) => l.startsWith('  ')).map((l) => l.trim().slice(0, 120)).slice(0, MAX_REASONS));
}

export function judgeAreasSetup(root, { before }) {
  const stray = changedSources(root, before);
  if (stray.length) return FAIL('source files changed', stray);
  const bad = settledProblem(root);
  if (bad) return bad;
  if (!hasAreasFile(root)) return OK('no areas file: the flat view stays');
  const check = areasCheck(root);
  if (check.status !== 0) return FAIL(`areas.mjs check exit ${check.status}, the tree is written but does not pass`, failedReasons(check));
  const tree = parseTree(root);
  return OK(`a tree of ${Object.keys(tree).length} areas passes areas.mjs check and validate --settled`);
}

function treeLostParts(beforeTree, afterTree) {
  return Object.entries(beforeTree).flatMap(([area, leaves]) => {
    if (!afterTree[area]) return [`area ${area} is gone`];
    return leaves.filter((leaf) => !afterTree[area].includes(leaf)).map((leaf) => `${leaf} left ${area}`);
  });
}

export function judgeAreasRebuilt(root, { beforeTree }) {
  const bad = settledProblem(root);
  if (bad) return bad;
  if (!hasAreasFile(root)) return FAIL('the areas file was deleted');
  const check = areasCheck(root);
  if (check.status !== 0) return FAIL(`areas.mjs check exit ${check.status}, the feature is still unplaced or the rebuilt tree fails`, [...failedReasons(check), ...check.stdout.split('\n').filter((l) => l.startsWith('To assign')).map((l) => l.trim())]);
  const tree = parseTree(root);
  if (!Object.values(tree).flat().includes(NEW_FEATURE)) return FAIL(`${NEW_FEATURE} was not placed in an area`);
  const lost = treeLostParts(beforeTree, tree);
  const how = lost.length ? 'a rebuilt' : 'an existing';
  return OK(`${NEW_FEATURE} sits in ${how} tree of ${Object.keys(tree).length} areas that passes areas.mjs check, no "To assign"`);
}

export function judgeAreasAdd(root, { beforeTree, expectPlaced }) {
  const bad = settledProblem(root);
  if (bad) return bad;
  if (!hasAreasFile(root)) return FAIL('the areas file was deleted');
  const check = areasCheck(root, ['--allow-unassigned']);
  if (check.status !== 0) return FAIL(`areas.mjs check --allow-unassigned exit ${check.status}`, failedReasons(check));
  const tree = parseTree(root);
  const lost = treeLostParts(beforeTree, tree);
  if (lost.length) return FAIL('the tree lost parts it had', lost);
  const placed = Object.values(tree).flat().includes(NEW_FEATURE);
  if (expectPlaced && !placed) return FAIL(`${NEW_FEATURE} was not placed in an area`);
  if (!expectPlaced && placed) return FAIL(`${NEW_FEATURE} was placed although no area could take it`);
  if (!expectPlaced && !check.stdout.includes(`To assign: ${NEW_FEATURE}`)) return FAIL(`${NEW_FEATURE} does not show under "To assign"`);
  return OK(expectPlaced ? `${NEW_FEATURE} sits in an area, the tree passes areas.mjs check` : `${NEW_FEATURE} shows under "To assign", the tree is intact and passes areas.mjs check --allow-unassigned`);
}
