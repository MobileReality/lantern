import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { commitFile, git, mergeNoFf, prRecord, write } from './helpers/git-repo';
import { EXAMPLE, DRAFT, makeRemoteProject, planJson, removeDir, runPlan } from './helpers/lantern-plan-world';
import type { RemoteWorld } from './helpers/lantern-plan-world';

interface ItemStatus {
  id: string;
  status: string;
  blocked: boolean;
  prs: { id: string; state: string; branch: string }[];
}

interface StatusReport {
  slug: string;
  approved: boolean;
  total: number;
  counts: Record<string, number>;
  stages: { id: string; done: boolean; openQuestions: { id: string }[]; items: ItemStatus[] }[];
  next: { stage: string; ready: string[]; waiting: string[]; ask: { id: string; text: string }[] } | null;
}

let world: RemoteWorld;

beforeEach(() => {
  world = makeRemoteProject([EXAMPLE]);
});

afterEach(() => {
  removeDir(world.dir);
});

const status = () => planJson<StatusReport>(world.root, 'status', EXAMPLE);
const statusOf = (item: string) => status().stages.flatMap((s) => s.items).find((i) => i.id === item)!;

function pushPrBranch(id: number, branch: string, item: string, extra: string[] = []) {
  git(world.root, ['checkout', '-q', '-b', branch, 'main']);
  const head = commitFile(world.root, 'src/main/lantern-prs.ts', `export const change${id} = ${id};\n`, `change ${id}`);
  const record = prRecord({ id, branch, head, files: [`#plan ${EXAMPLE} ${item}`, ...extra, '~ src/main/lantern-prs.ts'] });
  commitFile(world.root, `.lantern/prs/${id}.pr`, record, `chore: record pull request #${id}`);
  git(world.root, ['push', '-q', 'origin', branch]);
  git(world.root, ['checkout', '-q', 'main']);
  return head;
}

function mergeAndPush(branch: string, id: number) {
  mergeNoFf(world.root, branch, id);
  git(world.root, ['push', '-q', 'origin', 'main']);
}

describe('plan.mjs status: what the pull request records say about each item', () => {
  it('reads every item as planned while no pull request names it', () => {
    const report = status();
    expect(report.total).toBe(4);
    expect(report.counts).toEqual({ planned: 4, 'in progress': 0, implemented: 0, verified: 0 });
    expect(report.approved).toBe(true);
  });

  it('reads an item as in progress while its pull request is open, even before the record reaches the base', () => {
    pushPrBranch(201, 'feat/s1-1', 's1.1');
    const item = statusOf('s1.1');
    expect(item.status).toBe('in progress');
    expect(item.prs).toEqual([{ id: '201', state: 'open', branch: 'feat/s1-1' }]);
    expect(statusOf('s1.2').status).toBe('planned');
  });

  it('reads an item as implemented once its pull request is merged', () => {
    pushPrBranch(201, 'feat/s1-1', 's1.1');
    mergeAndPush('feat/s1-1', 201);
    expect(statusOf('s1.1')).toMatchObject({ status: 'implemented', prs: [{ id: '201', state: 'merged' }] });
  });

  it('counts a fast-forward merge too, by the record head being in the base', () => {
    pushPrBranch(202, 'feat/s1-2', 's1.2');
    git(world.root, ['merge', '-q', '--ff-only', 'feat/s1-2']);
    expect(statusOf('s1.2').status).toBe('implemented');
  });

  it('reads an item as verified once the plan says so, whatever the pull requests say', () => {
    pushPrBranch(201, 'feat/s1-1', 's1.1');
    mergeAndPush('feat/s1-1', 201);
    expect(runPlan(world.root, 'verified', EXAMPLE, 's1.1', '--by', 'jun', '--date', '2026-11-02').status).toBe(0);
    expect(statusOf('s1.1').status).toBe('verified');
    expect(status().counts).toMatchObject({ verified: 1, planned: 3 });
  });

  it('does not count a declined pull request: its branch is gone and nothing merged', () => {
    const head = pushPrBranch(203, 'feat/s1-1-dead', 's1.1');
    git(world.root, ['push', '-q', 'origin', '--delete', 'feat/s1-1-dead']);
    git(world.root, ['update-ref', '-d', 'refs/remotes/origin/feat/s1-1-dead']);
    commitFile(world.root, '.lantern/prs/203.pr', prRecord({ id: 203, branch: 'feat/s1-1-dead', head, files: [`#plan ${EXAMPLE} s1.1`, '~ src/main/lantern-prs.ts'] }), 'chore: keep the record');
    expect(statusOf('s1.1')).toMatchObject({ status: 'planned', prs: [{ id: '203', state: 'closed' }] });
  });

  it('reads a merged pull request as implemented even when a later one is declined', () => {
    pushPrBranch(201, 'feat/s1-1', 's1.1');
    mergeAndPush('feat/s1-1', 201);
    const head = pushPrBranch(204, 'feat/s1-1-again', 's1.1');
    git(world.root, ['push', '-q', 'origin', '--delete', 'feat/s1-1-again']);
    git(world.root, ['update-ref', '-d', 'refs/remotes/origin/feat/s1-1-again']);
    commitFile(world.root, '.lantern/prs/204.pr', prRecord({ id: 204, branch: 'feat/s1-1-again', head, files: [`#plan ${EXAMPLE} s1.1`, '~ src/main/lantern-prs.ts'] }), 'chore: keep the record');
    expect(statusOf('s1.1').status).toBe('implemented');
  });

  it('keeps a merged item in progress while a follow-up pull request for it is open', () => {
    pushPrBranch(201, 'feat/s1-1', 's1.1');
    mergeAndPush('feat/s1-1', 201);
    pushPrBranch(205, 'feat/s1-1-fix', 's1.1');
    expect(statusOf('s1.1').status).toBe('in progress');
  });

  it('ignores a record that names another plan or that does not parse', () => {
    commitFile(world.root, '.lantern/prs/206.pr', prRecord({ id: 206, branch: 'feat/other', head: 'a'.repeat(40), files: ['#plan some-other-plan s1.1', '~ src/main/lantern-prs.ts'] }), 'chore: other plan');
    commitFile(world.root, '.lantern/prs/207.pr', 'lantern-pr 1\n# 207\n#plan plan-on-the-map s1.1\n', 'chore: broken record');
    expect(status().counts.planned).toBe(4);
  });

  it('prints a readable summary', () => {
    pushPrBranch(201, 'feat/s1-1', 's1.1');
    const run = runPlan(world.root, 'status', EXAMPLE);
    expect(run.stdout).toMatch(/^plan plan-on-the-map: approved, 0 of 4 items implemented \(3 planned, 1 in progress, 0 implemented, 0 verified\)/);
    expect(run.stdout).toMatch(/ {2}s1\.1 in progress {2}Load every plan with the pull requests that tick its items {2}\[PR #201 open\]/);
  });
});

describe('plan.mjs status and handoff: stage order and open questions', () => {
  const finishStage = (stage: 's1' | 's2') => {
    const items = stage === 's1' ? ['s1.1', 's1.2'] : ['s2.1', 's2.2'];
    items.forEach((item, index) => {
      const id = (stage === 's1' ? 210 : 220) + index;
      pushPrBranch(id, `feat/${item.replace('.', '-')}`, item);
      mergeAndPush(`feat/${item.replace('.', '-')}`, id);
    });
  };

  it('offers the items of the first stage that is not finished', () => {
    const next = status().next!;
    expect(next).toMatchObject({ stage: 's1', ready: ['s1.1', 's1.2'], waiting: [], ask: [] });
  });

  it('waits for a stage whose items are in progress instead of starting the next one', () => {
    pushPrBranch(201, 'feat/s1-1', 's1.1');
    expect(status().next).toMatchObject({ stage: 's1', ready: ['s1.2'], waiting: ['s1.1'] });
  });

  it('blocks a stage that has an unanswered question and gives the question to ask', () => {
    finishStage('s1');
    const report = status();
    expect(report.stages[0].done).toBe(true);
    expect(report.next).toEqual({ stage: 's2', ready: [], waiting: [], ask: [{ id: 's2.q1', text: 'Does the stage list sit in the review pane or beside the macro view?' }] });
    expect(report.stages[1].items.map((i) => [i.id, i.blocked])).toEqual([['s2.1', true], ['s2.2', true]]);
    const run = runPlan(world.root, 'handoff', EXAMPLE);
    expect(run.status).toBe(0);
    expect(run.stdout).toMatch(/stage s2 is blocked; ask the user before delegating:\n {2}s2\.q1 {2}Does the stage list sit in the review pane/);
  });

  it('releases the stage once the question is answered', () => {
    finishStage('s1');
    expect(runPlan(world.root, 'add', EXAMPLE, 'answer', 's2.q1', 'jun', 'Beside the macro view.').status).toBe(0);
    expect(status().next).toMatchObject({ stage: 's2', ready: ['s2.1', 's2.2'], ask: [] });
    expect(status().stages[1].items.every((i) => !i.blocked)).toBe(true);
  });

  it('ends with nothing left once every item is implemented', () => {
    finishStage('s1');
    runPlan(world.root, 'add', EXAMPLE, 'answer', 's2.q1', 'jun', 'Beside it.');
    finishStage('s2');
    expect(status().next).toBeNull();
    expect(runPlan(world.root, 'handoff', EXAMPLE).stdout).toMatch(/every item is implemented; nothing to delegate/);
  }, 30_000);

  it('hands over the brief for each ready item: title, what it touches, how to verify it, how to record it', () => {
    const run = runPlan(world.root, 'handoff', EXAMPLE);
    expect(run.status).toBe(0);
    expect(run.stdout).toContain('plan plan-on-the-map: approved and clean, next stage s1');
    expect(run.stdout).toContain('s1.1  Load every plan with the pull requests that tick its items');
    expect(run.stdout).toContain('impacted: file src/main/lantern-prs.ts, file src/main/lantern.ts');
    expect(run.stdout).toContain('verify:   A test loads a repo with one plan and two PRs and gets one open and one merged item.');
    expect(run.stdout).toContain(`sync.mjs pr <id> ... --plan ${EXAMPLE} --item s1.1`);
    const json = planJson<{ ok: boolean; items: { id: string; accept: string }[]; maxDelegates: number }>(world.root, 'handoff', EXAMPLE);
    expect(json.items.map((i) => i.id)).toEqual(['s1.1', 's1.2']);
    expect(json.maxDelegates).toBe(3);
  });

  it('refuses to hand over a plan that is not approved, and says why', () => {
    write(world.root, `.lantern/plans/${DRAFT}.plan`, fs.readFileSync(path.join(__dirname, 'fixtures', 'lantern-plans', `${DRAFT}.plan`), 'utf8'));
    const run = runPlan(world.root, 'handoff', DRAFT);
    expect(run.status).toBe(1);
    expect(run.stdout).toMatch(/plan draft-reader cannot be handed over:\n {2}the plan is not approved; sections still open: goal \(pending\), scope \(pending\), impact \(pending\), s1 \(pending\), risks \(pending\)/);
  });

  it('refuses to hand over an approved plan that no longer checks clean', () => {
    const file = path.join(world.root, '.lantern', 'plans', `${EXAMPLE}.plan`);
    fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('#goal A selected stage', '#goal A chosen stage'));
    const run = runPlan(world.root, 'handoff', EXAMPLE);
    expect(run.status).toBe(1);
    expect(run.stdout).toMatch(/sections no longer approved: goal \(stale\)/);
  });
});
