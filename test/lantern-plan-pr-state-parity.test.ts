import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { loadPrs } from '../src/main/lantern-prs';
import { branchOff, commitFile, commitRecord, git, makeWorld } from './helpers/git-repo';
import type { World } from './helpers/git-repo';
import { SKILLS, importScript } from './helpers/lantern-plan-world';

vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });

interface SkillRecord {
  id: string;
  branch: string;
  base: string;
  head: string;
  errors: string[];
}

let prStates: (root: string, records: SkillRecord[]) => Map<string, string>;
let listPrs: (root: string) => SkillRecord[];
let PR_STATE: Record<string, string>;
let world: World;

beforeAll(async () => {
  prStates = (await importScript<{ prStates: typeof prStates }>('plan-git.mjs')).prStates;
  PR_STATE = (await importScript<{ PR_STATE: Record<string, string> }>('plan-format.mjs')).PR_STATE;
  listPrs = (await import(pathToFileURL(path.join(SKILLS, 'lantern-setup', 'scripts', 'prs.mjs')).href)).listPrs;
});

afterEach(() => {
  fs.rmSync(world.dir, { recursive: true, force: true });
});

function stackedMergeThenDelete(project: string, id: number) {
  branchOff(project, 'chore/x');
  commitFile(project, 'src/x.ts', 'export const x = 1;\n', 'base work');
  git(project, ['push', '-q', 'origin', 'chore/x']);
  branchOff(project, 'feat/stacked', 'chore/x');
  const head = commitFile(project, 'src/stacked.ts', 'export const s = 1;\n', 'stacked work');
  commitRecord(project, { id, branch: 'feat/stacked', base: 'chore/x', head });
  git(project, ['push', '-q', 'origin', 'feat/stacked']);
  git(project, ['checkout', '-q', 'chore/x']);
  git(project, ['merge', '-q', '--no-ff', '-m', `Merged in feat/stacked (pull request #${id})`, 'feat/stacked']);
  git(project, ['checkout', '-q', 'main']);
  git(project, ['merge', '-q', '--no-ff', '-m', `Merged in chore/x (pull request #${id - 1})`, 'chore/x']);
  git(project, ['push', '-q', 'origin', 'main']);
  git(project, ['push', '-q', 'origin', '--delete', 'chore/x', 'feat/stacked']);
  git(project, ['branch', '-q', '-D', 'chore/x', 'feat/stacked']);
  git(project, ['fetch', '-q', '--prune', 'origin']);
}

function squashed(project: string, id: number) {
  commitRecord(project, { id, branch: 'feat/squashed', base: 'chore/gone', head: 'c'.repeat(40) });
  commitFile(project, 'src/sq.ts', 'export {};\n', `Merged in feat/squashed (pull request #${id})\n\nsquash body`);
  git(project, ['push', '-q', 'origin', 'main']);
}

function fastForwarded(project: string, id: number) {
  const head = git(project, ['rev-parse', 'HEAD']);
  commitRecord(project, { id, branch: 'feat/ff', base: 'chore/gone', head });
  commitFile(project, 'src/after.ts', 'export {};\n', 'after');
  git(project, ['push', '-q', 'origin', 'main']);
}

function stackedBranchCheckedOut(project: string, id: number) {
  branchOff(project, 'feat/lower');
  const head = commitFile(project, 'src/lower.ts', 'export {};\n', 'lower');
  commitRecord(project, { id, branch: 'feat/lower', head });
  git(project, ['push', '-q', 'origin', 'feat/lower']);
  branchOff(project, 'feat/upper', 'feat/lower');
  commitFile(project, 'src/upper.ts', 'export {};\n', 'upper');
}

function branchGoneNothingMerged(project: string, id: number) {
  commitRecord(project, { id, branch: 'feat/dropped', base: 'chore/gone', head: 'd'.repeat(40) });
  git(project, ['push', '-q', 'origin', 'main']);
}

function mapOnlyUnmerged(project: string, id: number) {
  const head = git(project, ['rev-parse', 'HEAD']);
  branchOff(project, 'chore/map-only');
  commitRecord(project, { id, branch: 'chore/map-only', head });
  git(project, ['push', '-q', 'origin', 'chore/map-only']);
  git(project, ['checkout', '-q', 'main']);
  commitFile(project, 'src/other.ts', 'export {};\n', 'later main work');
  git(project, ['push', '-q', 'origin', 'main']);
  git(project, ['checkout', '-q', 'chore/map-only']);
}

const SCENARIOS: [string, (project: string, id: number) => void, string][] = [
  ['a stacked pull request merged into its base, branches deleted', stackedMergeThenDelete, 'MERGED'],
  ['a squash merge found by its message', squashed, 'MERGED'],
  ['a head that is an ancestor of the default line', fastForwarded, 'MERGED'],
  ['a branch under a checked-out stacked branch', stackedBranchCheckedOut, 'OPEN'],
  ['a branch that is gone with nothing merged', branchGoneNothingMerged, 'CLOSED'],
  ['a map-only branch whose head is already on the base', mapOnlyUnmerged, 'OPEN'],
];

describe('plan-git.mjs derives the same pull request state as lantern-prs.ts', () => {
  it.each(SCENARIOS)('%s', async (_label, build, expected) => {
    world = makeWorld();
    build(world.project, 90);
    const records = listPrs(world.project).filter((record) => record.errors.length === 0);
    const skill = prStates(world.project, records);
    const app = new Map((await loadPrs(world.project, new Set())).prs.map((pr) => [pr.id, pr.state]));
    expect(records.map((record) => record.id).sort()).toEqual([...app.keys()].sort());
    expect(Object.fromEntries(skill)).toEqual(Object.fromEntries(app));
    expect(skill.get('90')).toBe(PR_STATE[expected]);
  });

  it('names the states the app names', () => {
    world = makeWorld();
    expect(Object.values(PR_STATE).sort()).toEqual(['closed', 'merged', 'open']);
  });
});
