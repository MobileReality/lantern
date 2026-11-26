import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { git, makeTmp, write } from './helpers/git-repo';
import { REPO, removeDir, runSync } from './helpers/lantern-plan-world';

let lib: { hashFile: (root: string, rel: string) => string };
let root: string;

const BRANCH = 'feat/guided';
const RECORD = '.lantern/local/feat__guided.branch';
const LINES = Array.from({ length: 12 }, (_, index) => `export const v${index + 1} = ${index + 1};\n`);
const withEdits = LINES.map((line, index) => (index === 0 ? 'export const v1 = 100;\n' : index === 11 ? 'export const v12 = 120;\n' : line)).join('');
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 1, 2, 3]);

const REASONS = {
  'src/a.ts': 'Makes the entry executable so the launcher can run it.',
  'src/b.ts': 'Changes the first and last constants for the new defaults.',
  'src/moved.ts': 'Moves the helper next to its only caller.',
  'src/old.ts': 'Moves the helper next to its only caller.',
  'assets/logo.png': 'New logo for the about screen.',
};
const ORDER = ['src/b.ts', 'src/moved.ts', 'src/a.ts', 'src/old.ts', 'assets/logo.png'];
const FLOW = [{ title: 'A caller gets new defaults', steps: [{ kind: 'actor', text: 'The caller' }, { kind: 'action', text: 'asks for b', files: ['src/b.ts'] }] }];
const DESCRIBE = { what: ['b changes.'] };

const guideOf = (steps: unknown[]) => ({ summary: 'Defaults change, the helper moves.', risk: { level: 'low', why: 'Constants and a move.' }, steps });
const stepOf = (title: string, hunks: unknown[]) => ({ title, why: 'One part of the change.', careful: false, hunks });

const FULL = guideOf([
  stepOf('The new defaults', [
    { path: 'src/b.ts', side: 'new', start: 1, end: 1 },
    { path: 'src/b.ts', side: 'new', start: 12, end: 12 },
  ]),
  stepOf('The helper moves', ['src/moved.ts']),
  stepOf('Files without lines', ['src/a.ts', 'assets/logo.png']),
]);

function writeMap() {
  const records = ['src/a.ts', 'src/b.ts', 'src/moved.ts'].map((file) => `${file} . util ${lib.hashFile(root, file)}\n#feature core\n`).join('');
  write(root, '.lantern/map/src.lantern', `lantern 1\n# src\n\n${records}`);
  write(root, '.lantern/lang/en/src.lantern.json', '{"text":{"a.ts":"entry","b.ts":"defaults","moved.ts":"helper"}}\n');
}

function commitAll(message: string, ...paths: string[]) {
  git(root, ['add', ...paths]);
  git(root, ['commit', '-q', '-m', message]);
}

function buildProject() {
  root = makeTmp('lantern-guide-');
  write(root, 'src/a.ts', 'export const a = 1;\n');
  write(root, 'src/b.ts', LINES.join(''));
  write(root, 'src/old.ts', 'export const old = 1;\n');
  write(root, '.lantern/features', 'core\n');
  write(root, '.lantern/lang/en/features.json', '{"text":{"core":"the core"}}\n');
  git(root, ['init', '-q', '-b', 'main']);
  write(root, '.git/info/exclude', '.ai/tmp/\n');
  write(root, '.lantern/map/src.lantern', 'lantern 1\n# src\n');
  commitAll('base', '.');
  git(root, ['checkout', '-q', '-b', BRANCH]);
  write(root, 'src/b.ts', withEdits);
  fs.chmodSync(path.join(root, 'src/a.ts'), 0o755);
  git(root, ['mv', 'src/old.ts', 'src/moved.ts']);
  fs.mkdirSync(path.join(root, 'assets'));
  fs.writeFileSync(path.join(root, 'assets/logo.png'), PNG);
  commitAll('change', 'src', 'assets');
  writeMap();
  commitAll('chore: update the Lantern map', '.lantern');
}

const guideFile = (value: unknown, name = 'guide.json') => {
  write(root, `.ai/tmp/${name}`, JSON.stringify(value));
  return `.ai/tmp/${name}`;
};
const record = () => fs.readFileSync(path.join(root, RECORD), 'utf8');
const writeRecord = (...extra: string[]) => {
  write(root, '.ai/tmp/reason.json', JSON.stringify(REASONS));
  write(root, '.ai/tmp/order.json', JSON.stringify(ORDER));
  write(root, '.ai/tmp/flow.json', JSON.stringify(FLOW));
  write(root, '.ai/tmp/describe.json', JSON.stringify(DESCRIBE));
  return runSync(root, 'pr', '--base', 'main', '--branch', BRANCH, '--reason-file', '.ai/tmp/reason.json', '--order-file', '.ai/tmp/order.json', '--flow-file', '.ai/tmp/flow.json', '--describe-file', '.ai/tmp/describe.json', ...extra);
};
const verify = (...extra: string[]) => runSync(root, 'verify', '--base', 'main', '--branch', BRANCH, ...extra);
const verifyGuide = () => verify('--require-pr', '--require-reason', '--require-order', '--require-flow', '--require-guide');

beforeEach(async () => {
  lib = await import(pathToFileURL(path.join(REPO, 'skills', 'lantern-setup', 'scripts', 'lib.mjs')).href);
  buildProject();
});

afterEach(() => removeDir(root));

describe('sync.mjs pr --guide-file', () => {
  it('writes the guide lines into the record', () => {
    const run = writeRecord('--guide-file', guideFile(FULL));
    expect(run.status, run.stderr).toBe(0);
    expect(run.stdout).toContain('guide of 3 steps');
    const text = record();
    expect(text).toContain('#guide Defaults change, the helper moves.');
    expect(text).toContain('#risk low Constants and a move.');
    expect(text).toContain('#gstep skim The new defaults');
    expect(text).toContain('#ghunk src/b.ts +1');
    expect(text).toContain('#ghunk src/b.ts +12');
    expect(text).toContain('#ghunk src/moved.ts');
  });

  it('exits 2 and writes nothing on an invalid guide, and on a hunk of a file the change does not list', () => {
    const bad = writeRecord('--guide-file', guideFile({ summary: 'x', steps: [] }));
    expect(bad.status).toBe(2);
    expect(bad.stderr).toMatch(/is not a valid guide/);
    expect(fs.existsSync(path.join(root, RECORD))).toBe(false);
    const unlisted = writeRecord('--guide-file', guideFile(guideOf([stepOf('Elsewhere', ['src/nowhere.ts'])])));
    expect(unlisted.status).toBe(2);
    expect(unlisted.stderr).toMatch(/src\/nowhere\.ts/);
    expect(fs.existsSync(path.join(root, RECORD))).toBe(false);
    expect(writeRecord('--guide-file', '.ai/tmp/missing.json').status).toBe(2);
  });

  it('keeps the guide on a rewrite without the flag and clears it with {}', () => {
    expect(writeRecord('--guide-file', guideFile(FULL)).status).toBe(0);
    expect(runSync(root, 'pr', '--base', 'main', '--branch', BRANCH).status).toBe(0);
    expect(record()).toContain('#gstep skim The new defaults');
    expect(runSync(root, 'pr', '--base', 'main', '--branch', BRANCH, '--guide-file', guideFile({}, 'none.json')).status).toBe(0);
    expect(record()).not.toContain('#guide');
    expect(record()).toContain('#story');
  });

  it('is adopted with the guide by a later pr <id>', () => {
    expect(writeRecord('--guide-file', guideFile(FULL)).status).toBe(0);
    const run = runSync(root, 'pr', '77', '--url', 'https://example.test/77', '--title', 'Guided', '--base', 'main', '--branch', BRANCH);
    expect(run.status, run.stderr).toBe(0);
    expect(fs.existsSync(path.join(root, RECORD))).toBe(false);
    const text = fs.readFileSync(path.join(root, '.lantern/prs/77.pr'), 'utf8');
    expect(text).toContain('#guide Defaults change, the helper moves.');
    expect(text).toContain('#ghunk src/moved.ts');
  });
});

describe('sync.mjs verify --require-guide', () => {
  it('is red without a guide and green once it covers every hunk, pure renames, binary and mode changes included', () => {
    expect(writeRecord().status).toBe(0);
    const none = verifyGuide();
    expect(none.status).toBe(1);
    expect(none.stdout).toMatch(/no guide/);
    expect(verify('--require-pr', '--require-reason', '--require-order', '--require-flow').status).toBe(0);
    expect(writeRecord('--guide-file', guideFile(FULL)).status).toBe(0);
    const green = verifyGuide();
    expect(green.status, green.stdout).toBe(0);
  });

  it('is red on an uncovered hunk and names it', () => {
    const partial = guideOf([stepOf('The new defaults', [{ path: 'src/b.ts', side: 'new', start: 1, end: 1 }]), stepOf('The rest', ['src/moved.ts', 'src/a.ts', 'assets/logo.png'])]);
    expect(writeRecord('--guide-file', guideFile(partial)).status).toBe(0);
    const red = verifyGuide();
    expect(red.status).toBe(1);
    expect(red.stdout).toContain('hunk src/b.ts +12 is in no guide step');
    expect(red.stdout).not.toContain('hunk src/b.ts +1 ');
  });

  it('is red on a doubled hunk and on a reference matching no hunk', () => {
    const doubled = guideOf([
      stepOf('The new defaults', [{ path: 'src/b.ts', side: 'new', start: 1, end: 12 }]),
      stepOf('Again', [{ path: 'src/b.ts', side: 'new', start: 12, end: 12 }, 'src/moved.ts', 'src/a.ts', 'assets/logo.png']),
    ]);
    expect(writeRecord('--guide-file', guideFile(doubled)).status).toBe(0);
    const twice = verifyGuide();
    expect(twice.status).toBe(1);
    expect(twice.stdout).toMatch(/hunk src\/b\.ts \+12 is in 2 guide steps \(step 1 "The new defaults", step 2 "Again"\)/);
    const lost = guideOf([stepOf('The new defaults', [{ path: 'src/b.ts', side: 'new', start: 1, end: 1 }, { path: 'src/b.ts', side: 'new', start: 12, end: 12 }, { path: 'src/b.ts', side: 'new', start: 5, end: 6 }]), stepOf('The rest', ['src/moved.ts', 'src/a.ts', 'assets/logo.png'])]);
    expect(writeRecord('--guide-file', guideFile(lost, 'lost.json')).status).toBe(0);
    const unknown = verifyGuide();
    expect(unknown.status).toBe(1);
    expect(unknown.stdout).toMatch(/step 1 "The new defaults" names src\/b\.ts \+5-6, which matches no hunk/);
  });

  it('carries a rename on its new path: a whole-file reference to it covers the hunk and the old path is refused', () => {
    const viaNew = guideOf([stepOf('The new defaults', [{ path: 'src/b.ts', side: 'new', start: 1, end: 1 }, { path: 'src/b.ts', side: 'new', start: 12, end: 12 }]), stepOf('The rest', ['src/moved.ts', 'src/a.ts', 'assets/logo.png'])]);
    expect(writeRecord('--guide-file', guideFile(viaNew)).status).toBe(0);
    expect(verifyGuide().status, 'the old path needs no reference').toBe(0);
    const stale = guideOf([stepOf('The new defaults', [{ path: 'src/b.ts', side: 'new', start: 1, end: 1 }, { path: 'src/b.ts', side: 'new', start: 12, end: 12 }]), stepOf('The rest', ['src/moved.ts', 'src/old.ts', 'src/a.ts', 'assets/logo.png'])]);
    const refused = writeRecord('--guide-file', guideFile(stale, 'stale.json'));
    expect(refused.status).toBe(2);
    expect(refused.stderr).toMatch(/src\/old\.ts/);
  });

  it('fails a malformed guide in the record without the flag', () => {
    expect(writeRecord('--guide-file', guideFile(FULL)).status).toBe(0);
    write(root, RECORD, record().replace(/^#gwhy .*\n/m, ''));
    const red = verify();
    expect(red.status).toBe(1);
    expect(red.stdout).toMatch(/no #gwhy line/);
  });
});
