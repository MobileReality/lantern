import fs from 'node:fs';
import path from 'node:path';
import { parseTree as readTree } from './areas-checks.mjs';
import { AREAS_FEATURES, AREAS_PROJECT_NAME, NEW_FEATURE, NEW_FEATURE_FILE, TREES, writeAreas, writeAreasMap } from './areas-fixtures.mjs';
import { vocabFixtureOf } from './vocab-fake.mjs';

const BROKEN = 'broken';
const FULL_TREE_AREAS = 7;
const HOME_AREA = 'order-handling';
export const LOOP_FAILS_MARKER = 'areas loop fails';
export const TREE_MERGED_MARKER = 'target branch was merged in';

export const isAreasProject = (cwd) => vocabFixtureOf(cwd) === AREAS_PROJECT_NAME;

export function areasSetup(cwd, scenario) {
  if (!isAreasProject(cwd)) return false;
  writeAreas(cwd, scenario === BROKEN ? TREES.layers : TREES.five);
  return true;
}

function addFeatureFiles(cwd) {
  const file = path.join(cwd, NEW_FEATURE_FILE);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `export function wrap(item) {\n  return { item, wrapped: true };\n}\n`);
  writeAreasMap(cwd, [...AREAS_FEATURES, NEW_FEATURE]);
}

const rebuiltTree = () => ({ ...TREES.five, [HOME_AREA]: [...TREES.five[HOME_AREA], NEW_FEATURE] });

export function areasAdd(cwd, scenario, prompt = '') {
  addFeatureFiles(cwd);
  const tree = readTree(cwd);
  if (scenario === BROKEN) {
    Object.values(tree).slice(0, 2).forEach((leaves) => { leaves.push(NEW_FEATURE); });
    return writeAreas(cwd, tree);
  }
  const fits = Object.keys(tree).length < FULL_TREE_AREAS || prompt.includes(TREE_MERGED_MARKER);
  if (fits) tree[HOME_AREA].push(NEW_FEATURE);
  else if (!prompt.includes(LOOP_FAILS_MARKER)) return writeAreas(cwd, rebuiltTree());
  writeAreas(cwd, tree);
}
