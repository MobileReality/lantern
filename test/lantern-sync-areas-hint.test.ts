import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { writeHintProject } from './helpers/areas-hint-project';
import type { HintProject } from './helpers/areas-hint-project';

const SYNC = path.join(__dirname, '..', 'skills', 'lantern-sync', 'scripts', 'sync.mjs');
const HINT = 'areas: none yet; a retag would build them';
const ABOVE = { records: 121, features: 8 };

const roots: string[] = [];
afterEach(() => roots.splice(0).forEach((root) => { fs.rmSync(root, { recursive: true, force: true }); }));

function status(project: HintProject) {
  const root = writeHintProject(project);
  roots.push(root);
  return execFileSync(process.execPath, [SYNC, 'status'], { cwd: root, encoding: 'utf8' });
}

describe('sync.mjs status: the areas hint', () => {
  it('prints one hint line above both limits', () => {
    const lines = status(ABOVE).split('\n').filter((line) => line.includes(HINT));
    expect(lines).toEqual([HINT]);
  });

  it.each([
    ['120 records', { ...ABOVE, records: 120 }],
    ['7 features', { ...ABOVE, features: 7 }],
    ['an areas file', { ...ABOVE, areas: 'one-area\n  feature-00\n' }],
  ])('prints nothing with %s', (_name, project) => {
    expect(status(project)).not.toContain('areas:');
  });
});
