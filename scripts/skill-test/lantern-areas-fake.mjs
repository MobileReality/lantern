import fs from 'node:fs';
import path from 'node:path';
import { vocabFixtureOf } from './vocab-fake.mjs';
import { ANSWERS_FILE, mapNewFeature, projectKeyOf, SCRATCH_DIR, writeTree } from './lantern-areas-fixtures.mjs';
import { standInAnswers, writePacketsFor } from './lantern-areas-reader.mjs';
import { SHOP, STUDIO } from './lantern-areas-specs.mjs';

const BROKEN = 'broken';
const SMALL_TREE = { 'product-browsing': ['product-listing'] };
const SMALL_PURPOSES = { 'product-browsing': 'Finding and browsing the product catalogue' };

const keyOf = (cwd) => projectKeyOf(vocabFixtureOf(cwd));

function keepLookup(cwd) {
  const out = path.join(cwd, SCRATCH_DIR);
  const packets = writePacketsFor(cwd, out);
  if (packets.status !== 0) throw new Error(`lookup packets exit ${packets.status}: ${packets.stdout.trim()}`);
  fs.writeFileSync(path.join(cwd, ANSWERS_FILE), `${JSON.stringify(standInAnswers(out), null, 1)}\n`);
}

function writeWithLookup(cwd, tree, purposes) {
  writeTree(cwd, tree, purposes);
  keepLookup(cwd);
}

const PLANS = {
  good: { good: [SHOP.tree, SHOP.purposes], broken: [SHOP.layersTree, SHOP.layersPurposes] },
  trap: { good: [SHOP.tree, SHOP.purposes], broken: [SHOP.decoyTree, SHOP.decoyPurposes] },
  retag: { good: [STUDIO.tree, STUDIO.purposes], broken: [STUDIO.layersTree, STUDIO.layersPurposes] },
};

export function lanternAreasSetup(cwd, scenario) {
  const key = keyOf(cwd);
  if (key === 'small') {
    if (scenario === BROKEN) writeTree(cwd, SMALL_TREE, SMALL_PURPOSES);
    return true;
  }
  const plan = PLANS[key];
  if (!plan || key === 'retag') return false;
  writeWithLookup(cwd, ...plan[scenario === BROKEN ? BROKEN : 'good']);
  return true;
}

export function lanternAreasRetag(cwd, scenario) {
  if (keyOf(cwd) !== 'retag') return false;
  writeWithLookup(cwd, ...PLANS.retag[scenario === BROKEN ? BROKEN : 'good']);
  return true;
}

export function lanternAreasAdd(cwd, scenario) {
  if (keyOf(cwd) !== 'overflow') return false;
  mapNewFeature(cwd);
  if (scenario === BROKEN) writeTree(cwd, SHOP.eightTree, SHOP.eightPurposes);
  else writeWithLookup(cwd, SHOP.rebuiltTree, SHOP.rebuiltPurposes);
  return true;
}
