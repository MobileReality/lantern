import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { load } from '../src/main/lantern';
import { enumerateWithVerdicts } from '../src/main/lantern-enumerate';
import { hashContent } from '../skills/lantern-setup/scripts/lib.mjs';
import { git, write } from './helpers/git-repo';

const SKILLS = path.join(__dirname, '..', 'skills');
const ENUMERATE = path.join(SKILLS, 'lantern-setup', 'scripts', 'enumerate.mjs');
const VALIDATE = path.join(SKILLS, 'lantern-setup', 'scripts', 'validate.mjs');
const PLAN = path.join(SKILLS, 'lantern-setup', 'scripts', 'plan.mjs');
const SYNC = path.join(SKILLS, 'lantern-sync', 'scripts', 'sync.mjs');
const SOURCES = ['src/a.ts', 'src/b.ts'];

let root: string;

const sourceOf = (rel: string) => `export const name = '${rel}';\n`;
const node = (script: string, ...args: string[]) => {
  const run = spawnSync(process.execPath, [script, ...args], { cwd: root, encoding: 'utf8' });
  return { status: run.status, out: run.stdout, err: run.stderr };
};

function populate(withIgnoreFile: boolean) {
  write(root, '.lantern/.project/review.json', '{"src/a.ts":{"status":"approved","hash":"x","ts":1}}\n');
  write(root, '.lantern/.project/project.json', '{"name":"demo"}\n');
  write(root, '.lantern/.project/explains/change.md', '# a change\n');
  write(root, '.lantern/.project/SKILL.md', '---\nname: stray\n---\n');
  write(root, '.lantern/.project/scratch.ts', 'export const scratch = 1;\n');
  write(root, '.lantern/.project/map/leftover.lantern', 'lantern 1\n# nothing\n');
  if (withIgnoreFile) write(root, '.lantern/.project/.gitignore', '*\n');
}

function snapshot() {
  return {
    enumerate: node(ENUMERATE, '.'),
    validate: node(VALIDATE, '.', '--settled'),
    plan: node(PLAN, '.', 'status', '--json'),
    syncStatus: node(SYNC, 'status', '--base', 'main', '--json'),
    syncVerify: node(SYNC, 'verify', '--base', 'main'),
  };
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'ccm-project-data-'));
  for (const rel of SOURCES) write(root, rel, sourceOf(rel));
  write(root, '.lantern/map/src.lantern', `lantern 1\n# src\n\n${SOURCES.map((rel) => `${rel} . service ${hashContent(Buffer.from(sourceOf(rel)))}`).join('\n')}\n`);
  write(root, '.lantern/lang/en/src.lantern.json', `${JSON.stringify({ text: { 'a.ts': 'A.', 'b.ts': 'B.' } }, null, 1)}\n`);
  git(root, ['init', '-q', '-b', 'main']);
  git(root, ['add', '.']);
  git(root, ['commit', '-q', '-m', 'map']);
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe('a populated .lantern/.project', () => {
  it('has a clean baseline to compare against', () => {
    const before = snapshot();
    expect(before.validate.status, before.validate.out + before.validate.err).toBe(0);
    expect(before.syncVerify.status, before.syncVerify.out + before.syncVerify.err).toBe(0);
    expect(before.enumerate.out.split('\n').filter(Boolean).sort()).toEqual(SOURCES);
  });

  it.each([
    ['with the ignore file the app writes', true],
    ['made by hand, without one', false],
  ])('is invisible to the skill scripts %s', (_name, withIgnoreFile) => {
    const before = snapshot();
    populate(withIgnoreFile);
    const after = snapshot();
    expect(after).toEqual(before);
  });

  it.each([
    ['with the ignore file the app writes', true],
    ['made by hand, without one', false],
  ])('is invisible to the app reading the map %s', async (_name, withIgnoreFile) => {
    const before = { files: (await enumerateWithVerdicts(root)).files, map: await load(root) };
    populate(withIgnoreFile);
    const after = { files: (await enumerateWithVerdicts(root)).files, map: await load(root) };
    expect(after.files).toEqual(before.files);
    expect(after.map.nodes.map((n) => n.path)).toEqual(SOURCES);
    expect(after.map.total).toBe(before.map.total);
    expect(after.map.unmappedCount).toBe(0);
    expect(after.map.errors).toEqual(before.map.errors);
  });

  it('is never offered to tidy as an untracked copy of the base, even when the base once committed it', () => {
    write(root, '.lantern/.project/review.json', '{}\n');
    git(root, ['add', '-f', '.lantern/.project/review.json']);
    git(root, ['commit', '-q', '-m', 'committed by mistake']);
    git(root, ['checkout', '-q', '-b', 'other', 'HEAD~1']);
    write(root, '.lantern/.project/review.json', '{}\n');

    const status = JSON.parse(node(SYNC, 'status', '--base', 'main', '--json').out);
    expect(status.untrackedDuplicates).toEqual([]);

    const tidy = node(SYNC, 'tidy', '--base', 'main');
    expect(tidy.status).toBe(0);
    expect(fs.existsSync(path.join(root, '.lantern/.project/review.json'))).toBe(true);
  });

  it('never reaches git, so git add on the map folder leaves it out', () => {
    populate(true);
    git(root, ['add', '.lantern']);
    expect(git(root, ['status', '--porcelain', '--untracked-files=all'])).toBe('');
  });
});
