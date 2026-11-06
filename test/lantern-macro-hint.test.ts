import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { loadMacro } from '../src/main/lantern';
import { AREAS_MIN_FEATURES, AREAS_MIN_RECORDS_EXCLUSIVE, meetsAreasThresholds } from '../src/main/lantern-macro-hint';
import { readRegisteredMacro } from '../src/main/lantern-macro-load';
import type { ParsedRecord } from '../src/main/lantern-parse';
import { writeHintProject } from './helpers/areas-hint-project';
import type { HintProject } from './helpers/areas-hint-project';

const ABOVE = { records: AREAS_MIN_RECORDS_EXCLUSIVE + 1, features: AREAS_MIN_FEATURES };
const roots: string[] = [];
afterEach(() => roots.splice(0).forEach((root) => { fs.rmSync(root, { recursive: true, force: true }); }));

async function payloadOf(project: HintProject) {
  const root = writeHintProject(project);
  roots.push(root);
  const result = await readRegisteredMacro(() => true, loadMacro, root);
  if (!result.ok) throw new Error(result.error);
  return result;
}

describe('the areas hint in the lantern:macro payload', () => {
  it('is set at both limits: 121 records and 8 features', async () => {
    expect((await payloadOf(ABOVE)).areasHint).toBe(true);
  });

  it.each([
    ['120 records', { ...ABOVE, records: AREAS_MIN_RECORDS_EXCLUSIVE }],
    ['7 features', { ...ABOVE, features: AREAS_MIN_FEATURES - 1 }],
    ['no features', { ...ABOVE, features: 0 }],
  ])('is absent just below a limit: %s', async (_name, project) => {
    expect('areasHint' in (await payloadOf(project))).toBe(false);
  });

  it('is absent when the project has areas', async () => {
    const features = Array.from({ length: AREAS_MIN_FEATURES }, (_, i) => `feature-${String(i).padStart(2, '0')}`);
    const areas = `one-area\n${features.slice(0, 4).map((f) => `  ${f}\n`).join('')}two-area\n${features.slice(4).map((f) => `  ${f}\n`).join('')}`;
    const result = await payloadOf({ ...ABOVE, areas });
    expect(result.areas).toBeDefined();
    expect('areasHint' in result).toBe(false);
  });

  it('is absent when the areas file is ignored with a warning', async () => {
    const result = await payloadOf({ ...ABOVE, areas: '  orphan-leaf\n' });
    expect(result.areasWarning).toBeTruthy();
    expect('areasHint' in result).toBe(false);
  });
});

describe('the app and the skill apply the same thresholds', () => {
  let skill: (records: { feature: string | null }[]) => boolean;
  beforeAll(async () => {
    const mod = await import(pathToFileURL(path.join(__dirname, '..', 'skills', 'lantern-setup', 'scripts', 'lib.mjs')).href);
    skill = mod.meetsAreasThresholds;
  });

  it.each([
    [120, 8],
    [121, 7],
    [121, 8],
    [500, 30],
    [0, 0],
  ])('%i records, %i features', (records, features) => {
    const list = Array.from({ length: records }, (_, i) => ({ feature: i < features ? `f${i}` : null }));
    expect(skill(list)).toBe(meetsAreasThresholds(list as ParsedRecord[]));
  });
});
