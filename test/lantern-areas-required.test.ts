import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { AREAS_FEATURES, TREES, createAreasProject, writeAreas } from '../scripts/skill-test/areas-fixtures.mjs';
import { areasRequirement, requirementMessage } from '../skills/lantern-setup/scripts/areas-required.mjs';
import { AREAS_MIN_FEATURES, AREAS_MIN_RECORDS_EXCLUSIVE } from '../skills/lantern-setup/scripts/lib.mjs';

const SCRIPTS = path.join(__dirname, '..', 'skills', 'lantern-setup', 'scripts');
const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function tmp() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lantern-required-'));
  dirs.push(dir);
  return dir;
}

function mapOf(records: number, features: number) {
  const root = tmp();
  const lines = ['lantern 1', '# src', ''];
  for (let i = 0; i < records; i += 1) lines.push(`src/f${i}.ts . service 0123456789ab`, `#feature feature-${i % features}`);
  fs.mkdirSync(path.join(root, '.lantern', 'map'), { recursive: true });
  fs.writeFileSync(path.join(root, '.lantern', 'map', 'src.lantern'), `${lines.join('\n')}\n`);
  return root;
}

const run = (script: string, root: string, ...args: string[]) => {
  const res = spawnSync(process.execPath, [path.join(SCRIPTS, script), root, ...args], { encoding: 'utf8' });
  return { status: res.status, out: `${res.stdout}${res.stderr}` };
};

describe('when a map needs areas', () => {
  it('keeps the thresholds: more than 120 records and 8 or more features', () => {
    expect([AREAS_MIN_RECORDS_EXCLUSIVE, AREAS_MIN_FEATURES]).toEqual([120, 8]);
    expect(areasRequirement(mapOf(120, 9))).toMatchObject({ required: false, records: 120, features: 9 });
    expect(areasRequirement(mapOf(121, 7))).toMatchObject({ required: false, records: 121, features: 7 });
    expect(areasRequirement(mapOf(121, 8))).toMatchObject({ required: true, satisfied: false, reasons: ['.lantern/areas does not exist'] });
  });

  it('is satisfied by a tree that passes areas.mjs check and by nothing weaker', () => {
    const root = tmp();
    createAreasProject(root);
    expect(areasRequirement(root)).toMatchObject({ required: true, satisfied: false });
    writeAreas(root, TREES.layers);
    const layers = areasRequirement(root);
    expect(layers.satisfied).toBe(false);
    expect(layers.reasons.join('\n')).toMatch(/areas\.mjs check, name-words/);
    writeAreas(root, TREES.five);
    expect(areasRequirement(root)).toMatchObject({ required: true, satisfied: true, reasons: [], features: AREAS_FEATURES.length });
  });

  it('names the step in the message', () => {
    const text = requirementMessage(areasRequirement(mapOf(130, 9)));
    expect(text).toContain('130 records and 9 features');
    expect(text).toContain('step 4a ("Areas loop")');
    expect(text).toContain('.lantern/areas does not exist');
  });
});

describe('the two commands that refuse a map without them', () => {
  it('areas.mjs required exits 1 and names the step, 0 once the tree is there, 0 under the thresholds', () => {
    const root = tmp();
    createAreasProject(root);
    const missing = run('areas.mjs', root, 'required');
    expect(missing.status).toBe(1);
    expect(missing.out).toContain('step 4a');
    expect(JSON.parse(run('areas.mjs', root, 'required', '--json').out)).toMatchObject({ required: true, satisfied: false });
    writeAreas(root, TREES.five);
    expect(run('areas.mjs', root, 'required')).toMatchObject({ status: 0 });
    expect(run('areas.mjs', mapOf(30, 4), 'required').out).toContain('not required (30 records, 4 features)');
  });

  it('validate.mjs --settled alone is unchanged, --require-areas fails a flat map over the thresholds', () => {
    const root = tmp();
    createAreasProject(root);
    expect(run('validate.mjs', root, '--settled').status).toBe(0);
    const gated = run('validate.mjs', root, '--settled', '--require-areas');
    expect(gated.status).toBe(1);
    expect(gated.out).toContain('FAIL');
    expect(gated.out).toContain('step 4a');
    writeAreas(root, TREES.five);
    expect(run('validate.mjs', root, '--settled', '--require-areas').status).toBe(0);
  });
});
