import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { localPrs } from '../src/main/lantern-local';
import { compareId } from '../src/shared/local-review';
import { git, makeTmp, write } from './helpers/git-repo';
import { REPO, planJson, removeDir, runPlan, runSync } from './helpers/lantern-plan-world';

let lib: { hashFile: (root: string, rel: string) => string };
let root: string;
let other: string;

const SLUG = 'settled';
const BRANCH = 'feat/change-b';
const RECORD = '.lantern/local/feat__change-b.branch';
const REASON = 'Moves b to 2 so the caller gets the new default.';
const COMPARE = compareId('main', BRANCH);

const FLOW = [
  {
    title: 'A caller gets the new default',
    steps: [
      { kind: 'actor', text: 'The caller' },
      { kind: 'action', text: 'asks for b' },
      { kind: 'subject', text: 'the helper', files: ['src/b.ts'] },
    ],
    below: [{ kind: 'consequence', old: 'b answered 1', new: 'b answers 2' }],
  },
];
const DESCRIBE = { what: ['b answers 2 now.'], before: ['b answered 1.'], after: ['b answers 2.'], verified: ['The unit tests pass.'] };

function writeMap(hashOfB: string) {
  const hashOfA = lib.hashFile(root, 'src/a.ts');
  write(root, '.lantern/map/src.lantern', `lantern 1\n# src\n\nsrc/a.ts . service ${hashOfA}\n#feature core\n  = src/b.ts\nsrc/b.ts . util ${hashOfB}\n#feature core\n`);
}

function commitAll(message: string, ...paths: string[]) {
  git(root, ['add', ...paths]);
  git(root, ['commit', '-q', '-m', message]);
}

function buildProject() {
  root = makeTmp('lantern-branch-record-');
  write(root, 'src/a.ts', 'export const a = 1;\n');
  write(root, 'src/b.ts', 'export const b = 1;\n');
  write(root, '.lantern/features', 'core\n');
  write(root, '.lantern/lang/en/features.json', '{"text":{"core":"the core"}}\n');
  write(root, '.lantern/lang/en/src.lantern.json', '{"text":{"a.ts":"entry","b.ts":"helper","a.ts = src/b.ts":"calls"}}\n');
  writeMap(lib.hashFile(root, 'src/b.ts'));
  git(root, ['init', '-q', '-b', 'main']);
  write(root, '.git/info/exclude', '.ai/tmp/\n');
  commitAll('base', '.');
  expect(runPlan(root, 'new', SLUG, '--title', 'Change b', '--goal', 'b changes.').status).toBe(0);
  for (const args of [
    ['scope', 'in', 'The b file.'],
    ['impact', 'feature', 'core', 'b lives in the core.'],
    ['stage', 'Change it'],
    ['item', 's1', 'Change b', '--touch', 'file:src/b.ts', '--accept', 'b is 2.'],
  ]) expect(runPlan(root, 'add', SLUG, ...args).status).toBe(0);
  commitAll('plan', '.lantern/plans');
  git(root, ['checkout', '-q', '-b', BRANCH]);
  write(root, 'src/b.ts', 'export const b = 2;\n');
  commitAll('change b', 'src/b.ts');
  writeMap(lib.hashFile(root, 'src/b.ts'));
  commitAll('chore: update the Lantern map', '.lantern');
}

function inputs() {
  write(root, '.ai/tmp/order.json', JSON.stringify(['src/b.ts']));
  write(root, '.ai/tmp/flow.json', JSON.stringify(FLOW));
  write(root, '.ai/tmp/describe.json', JSON.stringify(DESCRIBE));
  return ['--order-file', '.ai/tmp/order.json', '--flow-file', '.ai/tmp/flow.json', '--describe-file', '.ai/tmp/describe.json'];
}

const record = (dir = root) => fs.readFileSync(path.join(dir, RECORD), 'utf8');
const writeBranchRecord = (...extra: string[]) => runSync(root, 'pr', '--base', 'main', '--branch', BRANCH, '--reason', `src/b.ts=${REASON}`, ...inputs(), ...extra);
const verifyAll = (...extra: string[]) => runSync(root, 'verify', '--base', 'main', '--require-pr', '--require-reason', '--require-order', '--require-flow', '--branch', BRANCH, ...extra);

beforeEach(async () => {
  lib = await import(pathToFileURL(path.join(REPO, 'skills', 'lantern-setup', 'scripts', 'lib.mjs')).href);
  buildProject();
});

afterEach(() => {
  removeDir(root);
  if (other) removeDir(other);
  other = '';
});

describe('sync.mjs pr for a branch with no pull request', () => {
  it('writes reasons, order, flow, description and plan ticks to an ignored local record', () => {
    const run = writeBranchRecord('--plan', SLUG, '--item', 's1.1');
    expect(run.status, run.stderr).toBe(0);
    expect(run.stdout).toContain(`wrote ${RECORD}`);
    const text = record();
    expect(text.split('\n')[0]).toBe('lantern-branch 1');
    expect(text).toContain(`#branch ${BRANCH}`);
    expect(text).toContain('#plan settled s1.1');
    expect(text).toContain('#order src/b.ts');
    expect(text).toContain(`#reason src/b.ts ${REASON}`);
    expect(text).toContain('#story A caller gets the new default');
    expect(text).toMatch(/#describe what b answers 2 now\./);
    expect(git(root, ['check-ignore', RECORD])).toBe(RECORD);
  });

  it('is never staged by git add .lantern', () => {
    expect(writeBranchRecord().status).toBe(0);
    git(root, ['add', '.lantern']);
    expect(git(root, ['status', '--porcelain', '--', '.lantern/local'])).toBe('');
    expect(git(root, ['ls-files', '--', '.lantern/local'])).toBe('');
  });

  it('refuses a changed file without a reason, and a --url or --title', () => {
    const run = runSync(root, 'pr', '--base', 'main', '--branch', BRANCH, ...inputs());
    expect(run.status).toBe(1);
    expect(run.stderr).toMatch(/1 of 1 changed file\(s\) have no reason/);
    expect(fs.existsSync(path.join(root, RECORD))).toBe(false);
    expect(runSync(root, 'pr', '--base', 'main', '--branch', BRANCH, '--url', 'https://x.test/1', '--reason', `src/b.ts=${REASON}`).status).toBe(2);
  });

  it('keeps its parts when rewritten', () => {
    expect(writeBranchRecord('--plan', SLUG, '--item', 's1.1').status).toBe(0);
    expect(runSync(root, 'pr', '--base', 'main', '--branch', BRANCH).status).toBe(0);
    const text = record();
    expect(text).toContain('#plan settled s1.1');
    expect(text).toContain('#story A caller gets the new default');
    expect(text).toContain(`#reason src/b.ts ${REASON}`);
  });
});

describe('sync.mjs verify with all four --require flags on a local record', () => {
  it('is green with the record and red without it', () => {
    const missing = verifyAll();
    expect(missing.status).toBe(1);
    expect(missing.stdout).toMatch(/no \.lantern\/prs\/\*\.pr record \(or \.lantern\/local\/\*\.branch record/);
    expect(writeBranchRecord().status).toBe(0);
    const green = verifyAll();
    expect(green.status, green.stdout).toBe(0);
    expect(green.stdout).toMatch(/GREEN/);
  });

  it('is red when a reason is missing from the record', () => {
    expect(writeBranchRecord().status).toBe(0);
    write(root, RECORD, record().replace(/^#reason .*\n/m, ''));
    const red = verifyAll();
    expect(red.status).toBe(1);
    expect(red.stdout).toMatch(/1 of 1 changed file\(s\) have no reason \(src\/b\.ts\)/);
  });

  it('is red without the order or the flow', () => {
    expect(runSync(root, 'pr', '--base', 'main', '--branch', BRANCH, '--reason', `src/b.ts=${REASON}`).status).toBe(0);
    const red = verifyAll();
    expect(red.status).toBe(1);
    expect(red.stdout).toMatch(/no review position/);
    expect(red.stdout).toMatch(/no flow/);
  });

  it('is red when the record is behind the last source commit', () => {
    expect(writeBranchRecord().status).toBe(0);
    write(root, 'src/b.ts', 'export const b = 3;\n');
    commitAll('change b again', 'src/b.ts');
    writeMap(lib.hashFile(root, 'src/b.ts'));
    commitAll('chore: update the Lantern map', '.lantern');
    const red = verifyAll();
    expect(red.status).toBe(1);
    expect(red.stdout).toMatch(/#head is [0-9a-f]{40}, the last source commit is/);
  });
});

describe('sync.mjs carry', () => {
  it('copies the record from a worktree into the checkout, which keeps ignoring it', () => {
    expect(writeBranchRecord().status).toBe(0);
    other = makeTmp('lantern-branch-main-');
    write(other, '.lantern/map/src.lantern', 'lantern 1\n# src\n');
    git(other, ['init', '-q', '-b', 'main']);
    const run = runSync(other, 'carry', '--from', root, '--branch', BRANCH);
    expect(run.status, run.stderr).toBe(0);
    expect(record(other)).toBe(record(root));
    expect(git(other, ['check-ignore', RECORD])).toBe(RECORD);
    git(other, ['add', '.lantern']);
    expect(git(other, ['ls-files', '--', '.lantern/local'])).toBe('');
  });

  it('refuses a worktree with no record for the branch and a malformed one', () => {
    other = makeTmp('lantern-branch-main-');
    write(other, '.lantern/map/src.lantern', 'lantern 1\n# src\n');
    expect(runSync(other, 'carry', '--from', root, '--branch', BRANCH).status).toBe(1);
    write(root, RECORD, 'lantern-branch 1\n#branch feat/change-b\n');
    const run = runSync(other, 'carry', '--from', root, '--branch', BRANCH);
    expect(run.status).toBe(1);
    expect(run.stderr).toMatch(/malformed/);
    expect(fs.existsSync(path.join(other, RECORD))).toBe(false);
  });
});

describe('opening a pull request later adopts the local record', () => {
  it('keeps reasons, order, flow, description and plan ticks, writes the PR record and removes the local one', () => {
    expect(writeBranchRecord('--plan', SLUG, '--item', 's1.1').status).toBe(0);
    const run = runSync(root, 'pr', '301', '--url', 'https://example.test/301', '--title', 'Change b', '--base', 'main', '--branch', BRANCH);
    expect(run.status, run.stderr).toBe(0);
    expect(run.stdout).toContain(`adopted the local record ${RECORD}`);
    expect(fs.existsSync(path.join(root, RECORD))).toBe(false);
    const text = fs.readFileSync(path.join(root, '.lantern', 'prs', '301.pr'), 'utf8');
    expect(text).toContain(`#reason src/b.ts ${REASON}`);
    expect(text).toContain('#order src/b.ts');
    expect(text).toContain('#story A caller gets the new default');
    expect(text).toContain('#describe what b answers 2 now.');
    expect(text).toContain('#plan settled s1.1');
    commitAll('chore: record pull request #301 in the Lantern map', '.lantern/prs');
    const green = runSync(root, 'verify', '--base', 'main', '--require-pr', '--require-reason', '--require-order', '--require-flow', '--branch', BRANCH);
    expect(green.status, green.stdout).toBe(0);
  });

  it('still refuses a second pull request record for the branch', () => {
    expect(runSync(root, 'pr', '301', '--url', 'https://example.test/301', '--title', 'Change b', '--base', 'main', '--branch', BRANCH, '--reason', `src/b.ts=${REASON}`).status).toBe(0);
    const second = runSync(root, 'pr', '302', '--url', 'https://example.test/302', '--title', 'Change b', '--base', 'main', '--branch', BRANCH, '--reason', `src/b.ts=${REASON}`);
    expect(second.status).toBe(1);
    expect(second.stderr).toMatch(/refusing to add a second record/);
  });
});

describe('plan.mjs status with a local record', () => {
  const item = () => planJson<{ stages: { items: { id: string; status: string; prs: { id: string; state: string }[] }[] }[] }>(root, 'status', SLUG).stages[0].items[0];

  it('ticks the item as in progress, then implemented once the branch is merged', () => {
    expect(item().status).toBe('planned');
    expect(writeBranchRecord('--plan', SLUG, '--item', 's1.1').status).toBe(0);
    expect(item()).toMatchObject({ id: 's1.1', status: 'in progress', prs: [{ id: BRANCH, state: 'open' }] });
    git(root, ['checkout', '-q', 'main']);
    git(root, ['merge', '-q', '--no-ff', '-m', 'merge the branch', BRANCH]);
    expect(item()).toMatchObject({ status: 'implemented', prs: [{ id: BRANCH, state: 'merged' }] });
  });
});

describe('the app comparison view of the branch', () => {
  const shown = async () => (await localPrs(root, [COMPARE], new Set(['src/b.ts'])))[0];

  it('shows the reasons, review order, flow and description of the local record', async () => {
    expect(writeBranchRecord('--plan', SLUG, '--item', 's1.1').status).toBe(0);
    const pr = await shown();
    expect(pr.source).toBe('local');
    expect(pr.files).toEqual([{ path: 'src/b.ts', kind: 'modified', mapped: true, reason: REASON }]);
    expect(pr.ordered).toBe(true);
    expect(pr.flow?.[0].title).toBe('A caller gets the new default');
    expect(pr.description?.what).toEqual(['b answers 2 now.']);
    expect(pr.plans).toEqual([{ slug: SLUG, item: 's1.1' }]);
  });

  it('shows the file with no reason before the record exists, and again when the record is behind', async () => {
    expect((await shown()).files[0].reason).toBeUndefined();
    expect(writeBranchRecord().status).toBe(0);
    expect((await shown()).files[0].reason).toBe(REASON);
    write(root, 'src/b.ts', 'export const b = 3;\n');
    commitAll('change b again', 'src/b.ts');
    const behind = await shown();
    expect(behind.files[0].reason).toBeUndefined();
    expect(behind.flow).toBeUndefined();
  });
});
