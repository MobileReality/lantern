import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { git, makeTmp, write } from './helpers/git-repo';
import { REPO, removeDir, runPlan, runSync } from './helpers/lantern-plan-world';

let lib: { hashFile: (root: string, rel: string) => string };
let root: string;
let repoDir: string;

const SLUG = 'settled';
const A = 'export const a = 1;\n';
const B_BEFORE = 'export const b = 1;\n';
const B_AFTER = 'export const b = 2;\n';

function writeMap(hashOfB: string) {
  const hashOfA = lib.hashFile(root, 'src/a.ts');
  write(root, '.lantern/map/src.lantern', `lantern 1\n# src\n\nsrc/a.ts . service ${hashOfA}\n#feature core\n  = src/b.ts\nsrc/b.ts . util ${hashOfB}\n#feature core\n`);
}

function commitAll(message: string, ...paths: string[]) {
  git(root, ['add', ...paths]);
  git(root, ['commit', '-q', '-m', message]);
}

function buildProject(subfolder = '') {
  repoDir = makeTmp('lantern-plan-sync-');
  root = subfolder ? path.join(repoDir, subfolder) : repoDir;
  fs.mkdirSync(root, { recursive: true });
  write(root, 'src/a.ts', A);
  write(root, 'src/b.ts', B_BEFORE);
  write(root, '.lantern/features', 'core\n');
  write(root, '.lantern/lang/en/features.json', '{"text":{"core":"the core"}}\n');
  write(root, '.lantern/lang/en/src.lantern.json', '{"text":{"a.ts":"entry","b.ts":"helper","a.ts = src/b.ts":"calls"}}\n');
  writeMap(lib.hashFile(root, 'src/b.ts'));
  git(repoDir, ['init', '-q', '-b', 'main']);
  commitAll('base', '.');
  expect(runPlan(root, 'new', SLUG, '--title', 'Change b', '--goal', 'b changes.').status).toBe(0);
  for (const args of [
    ['scope', 'in', 'The b file.'],
    ['impact', 'feature', 'core', 'b lives in the core.'],
    ['stage', 'Change it'],
    ['item', 's1', 'Change b', '--touch', 'file:src/b.ts', '--accept', 'b is 2.'],
    ['item', 's1', 'Tell a', '--touch', 'file:src/a.ts', '--accept', 'a knows.'],
  ]) expect(runPlan(root, 'add', SLUG, ...args).status).toBe(0);
  commitAll('plan', '.lantern/plans');
  git(root, ['checkout', '-q', '-b', 'feat/change-b']);
  write(root, 'src/b.ts', B_AFTER);
  commitAll('change b', 'src/b.ts');
  writeMap(lib.hashFile(root, 'src/b.ts'));
  commitAll('chore: update the Lantern map', '.lantern');
}

const pr = (...extra: string[]) => runSync(root, 'pr', '301', '--url', 'https://example.test/301', '--title', 'Change b', '--base', 'main', '--branch', 'feat/change-b', '--reason', 'src/b.ts=Moves b to 2.', ...extra);
const record = () => fs.readFileSync(path.join(root, '.lantern', 'prs', '301.pr'), 'utf8');
const verify = (...extra: string[]) => runSync(root, 'verify', '--base', 'main', '--require-pr', '--branch', 'feat/change-b', ...extra);

beforeEach(async () => {
  lib = await import(pathToFileURL(path.join(REPO, 'skills', 'lantern-setup', 'scripts', 'lib.mjs')).href);
  buildProject();
});

afterEach(() => {
  removeDir(repoDir);
});

describe('sync.mjs pr --plan --item', () => {
  it('writes a #plan line for each item the pull request ticks', () => {
    const run = pr('--plan', SLUG, '--item', 's1.1', '--item', 's1.2');
    expect(run.status).toBe(0);
    expect(run.stdout).toMatch(/ticks settled s1\.1, settled s1\.2/);
    expect(record()).toMatch(/#plan settled s1\.1\n#plan settled s1\.2\n~ src\/b\.ts\n/);
  });

  it('refuses a plan that is not in .lantern/plans, and writes nothing', () => {
    const run = pr('--plan', 'ghost', '--item', 's1.1');
    expect(run.status).toBe(1);
    expect(run.stderr).toMatch(/plan "ghost" is not in \.lantern\/plans/);
    expect(fs.existsSync(path.join(root, '.lantern', 'prs', '301.pr'))).toBe(false);
  });

  it('refuses an item the plan does not have, and says which items it has', () => {
    const run = pr('--plan', SLUG, '--item', 's1.1', '--item', 's9.9');
    expect(run.status).toBe(1);
    expect(run.stderr).toMatch(/plan "settled" has no item s9\.9 \(items: s1\.1, s1\.2\); refusing to tick them/);
    expect(fs.existsSync(path.join(root, '.lantern', 'prs', '301.pr'))).toBe(false);
  });

  it('refuses a plan without an item and an item without a plan', () => {
    expect(pr('--plan', SLUG).status).toBe(2);
    expect(pr('--item', 's1.1').status).toBe(2);
  });

  it('keeps the ticks when the record is rewritten, and replaces them when asked', () => {
    expect(pr('--plan', SLUG, '--item', 's1.1').status).toBe(0);
    expect(pr().status).toBe(0);
    expect(record()).toContain('#plan settled s1.1');
    expect(pr('--plan', SLUG, '--item', 's1.2').status).toBe(0);
    expect(record()).toContain('#plan settled s1.2');
    expect(record()).not.toContain('#plan settled s1.1');
  });

  it('is read back by the record parser of the skill scripts', async () => {
    pr('--plan', SLUG, '--item', 's1.1');
    const prs = await import(pathToFileURL(path.join(REPO, 'skills', 'lantern-setup', 'scripts', 'prs.mjs')).href);
    const parsed = prs.parsePr(record(), '.lantern/prs/301.pr');
    expect(parsed.errors).toEqual([]);
    expect(parsed.plans).toEqual([{ slug: SLUG, item: 's1.1' }]);
  });
});

describe('sync.mjs verify and plans', () => {
  const commitRecord = () => commitAll('chore: record pull request #301', '.lantern/prs');

  it('is green for a record that ticks a real item of a clean plan', () => {
    pr('--plan', SLUG, '--item', 's1.1');
    commitRecord();
    const run = verify();
    expect(run.stdout).toMatch(/GREEN/);
    expect(run.stdout).not.toMatch(/warning: .*(plan|item)/);
  });

  it('warns, and stays green, when a record ticks a plan or an item that is not there', () => {
    pr('--plan', SLUG, '--item', 's1.1');
    const text = record().replace('#plan settled s1.1', '#plan settled s1.1\n#plan settled s7.7\n#plan ghost s1.1');
    write(root, '.lantern/prs/301.pr', text);
    commitRecord();
    const run = verify();
    expect(run.status).toBe(0);
    expect(run.stdout).toMatch(/warning: \.lantern\/prs\/301\.pr: ticks item s7\.7 of plan "settled", which has no such item/);
    expect(run.stdout).toMatch(/warning: \.lantern\/prs\/301\.pr: ticks plan "ghost", which is not in \.lantern\/plans/);
  });

  it('fails when the branch touched a plan that no longer checks', () => {
    pr('--plan', SLUG, '--item', 's1.1');
    commitRecord();
    const file = path.join(root, '.lantern', 'plans', `${SLUG}.plan`);
    fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('#touch file src/b.ts', '#touch file src/typo.ts'));
    commitAll('break the plan', '.lantern/plans');
    const run = verify();
    expect(run.status).toBe(1);
    expect(run.stdout).toMatch(/RED/);
    expect(run.stdout).toMatch(/\.lantern\/plans\/settled\.plan: s1\.1 #touch file src\/typo\.ts: src\/typo\.ts is not in the map and never was/);
  });

  it('says nothing about plans when the plans folder is empty', () => {
    fs.rmSync(path.join(root, '.lantern', 'plans', `${SLUG}.plan`));
    fs.writeFileSync(path.join(root, '.lantern', 'plans', '.gitkeep'), '');
    commitAll('empty the plans', '.lantern/plans');
    pr();
    commitRecord();
    const run = verify();
    expect(run.status).toBe(0);
    expect(run.stdout).not.toMatch(/plan/i);
  });

  it('fails for a touched plan when the project is a subfolder of the git repository', () => {
    removeDir(repoDir);
    buildProject('app');
    pr('--plan', SLUG, '--item', 's1.1');
    commitRecord();
    const file = path.join(root, '.lantern', 'plans', `${SLUG}.plan`);
    fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('#touch file src/b.ts', '#touch file src/typo.ts'));
    commitAll('break the plan', '.lantern/plans');
    const run = verify();
    expect(run.status).toBe(1);
    expect(run.stdout).toMatch(/\.lantern\/plans\/settled\.plan: s1\.1 #touch file src\/typo\.ts/);
  });

  it('only warns about a broken plan the branch did not touch', () => {
    const file = path.join(root, '.lantern', 'plans', `${SLUG}.plan`);
    git(root, ['checkout', '-q', 'main']);
    fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('#touch file src/b.ts', '#touch file src/typo.ts'));
    commitAll('break the plan on main', '.lantern/plans');
    git(root, ['checkout', '-q', 'feat/change-b']);
    git(root, ['merge', '-q', '--no-edit', 'main']);
    pr();
    commitRecord();
    const run = verify();
    expect(run.status).toBe(0);
    expect(run.stdout).toMatch(/warning: \.lantern\/plans\/settled\.plan: s1\.1 #touch file src\/typo\.ts: .*\(not touched by this branch\)/);
  });
});

describe('sync.mjs dismiss and plans', () => {
  it('warns that dismissing a pull request takes its ticks away', () => {
    pr('--plan', SLUG, '--item', 's1.1');
    const run = runSync(root, 'dismiss', '301');
    expect(run.status).toBe(0);
    expect(run.stdout).toMatch(/warning: PR #301 ticked item s1\.1 of plan settled; the tick leaves with its record, so mark the item verified first/);
  });
});
