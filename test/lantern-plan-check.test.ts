import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { git, write } from './helpers/git-repo';
import { DRAFT, EXAMPLE, PLAN_SCRIPT, fixtureText, makeProject, planJson, removeDir, runNode, runPlan } from './helpers/lantern-plan-world';

interface CheckReport {
  ok: boolean;
  results: { plan: string; ok: boolean; errors: string[]; warnings: string[] }[];
}

let root: string;

beforeEach(() => {
  root = makeProject([EXAMPLE, DRAFT]);
});

afterEach(() => {
  removeDir(root);
});

const planFile = (slug: string) => path.join(root, '.lantern', 'plans', `${slug}.plan`);
const editKeepingApprovals = (slug: string, from: string, to: string) => {
  const before = fs.readFileSync(planFile(slug), 'utf8');
  expect(before).toContain(from);
  fs.writeFileSync(planFile(slug), before.replace(from, to));
};
const withoutApprovals = (slug: string) => fs.writeFileSync(planFile(slug), fs.readFileSync(planFile(slug), 'utf8').replace(/^#approved .*\n/gm, ''));
const edit = (slug: string, from: string, to: string) => {
  editKeepingApprovals(slug, from, to);
  withoutApprovals(slug);
};
const check = (slug: string) => planJson<CheckReport>(root, 'check', slug).results[0];
const errorsOf = (slug: string) => check(slug).errors.join('\n');
const warningsOf = (slug: string) => check(slug).warnings.join('\n');

describe('plan.mjs check: a clean plan', () => {
  it('passes the worked example against its map', () => {
    expect(check(EXAMPLE)).toMatchObject({ ok: true, errors: [], warnings: [] });
  });

  it('exits 0 for a clean plan and 1 for a broken one', () => {
    expect(runPlan(root, 'check', EXAMPLE).status).toBe(0);
    edit(EXAMPLE, '#touch file src/main/lantern-prs.ts', '#touch file src/main/nowhere.ts');
    expect(runPlan(root, 'check', EXAMPLE).status).toBe(1);
  });
});

describe('plan.mjs check: new files', () => {
  it('accepts a new path that is not in the map, with its purpose', () => {
    expect(check(EXAMPLE).errors).toEqual([]);
    expect(check(EXAMPLE).warnings).toEqual([]);
  });

  it('fails when a new path is touched but has no purpose in the impact section', () => {
    edit(EXAMPLE, '#impact new src/main/lantern-plans.ts Loads every plan file with the pull requests that tick its items.\n', '');
    expect(runPlan(root, 'check', EXAMPLE).status).toBe(1);
    expect(errorsOf(EXAMPLE)).toMatch(/src\/main\/lantern-plans\.ts is touched as a new file but has no purpose/);
  });

  it('fails when the impact line gives a path and no purpose', () => {
    edit(EXAMPLE, 'src/main/lantern-plans.ts Loads every plan file with the pull requests that tick its items.', 'src/main/lantern-plans.ts');
    expect(runPlan(root, 'check', EXAMPLE).status).toBe(1);
    expect(check(EXAMPLE).errors.join('\n')).toMatch(/reason is empty/);
  });

  it('warns when the path is already in the map, and when it already exists on disk', () => {
    edit(EXAMPLE, '#impact new src/main/lantern-plans.ts', '#impact new src/main/lantern.ts');
    edit(EXAMPLE, '#touch new src/main/lantern-plans.ts', '#touch new src/main/lantern.ts');
    expect(warningsOf(EXAMPLE)).toMatch(/src\/main\/lantern\.ts is already in the map, so it is not new: name it as a file/);
    write(root, 'src/main/lantern.ts', 'export {};\n');
    write(root, 'src/main/elsewhere.ts', 'export {};\n');
    edit(EXAMPLE, '#impact new src/main/lantern.ts', '#impact new src/main/elsewhere.ts');
    edit(EXAMPLE, '#touch new src/main/lantern.ts', '#touch new src/main/elsewhere.ts');
    expect(warningsOf(EXAMPLE)).toMatch(/src\/main\/elsewhere\.ts already exists in the project, so it is not new/);
    expect(errorsOf(EXAMPLE)).toBe('');
  });

  it('still rejects a file that is neither in the map nor ever was', () => {
    edit(EXAMPLE, '#touch file src/main/lantern-prs.ts', '#touch file src/main/never.ts');
    expect(errorsOf(EXAMPLE)).toMatch(/src\/main\/never\.ts is not in the map and never was/);
  });

  it('accepts a new file through add, impact and touch', () => {
    expect(runPlan(root, 'add', DRAFT, 'impact', 'new', 'src/main/brand-new.ts', 'Holds the new thing.').status).toBe(0);
    expect(runPlan(root, 'add', DRAFT, 'touch', 's1.1', 'new', 'src/main/brand-new.ts').status).toBe(0);
    expect(fs.readFileSync(planFile(DRAFT), 'utf8')).toContain('#impact new src/main/brand-new.ts Holds the new thing.');
    expect(fs.readFileSync(planFile(DRAFT), 'utf8')).toContain('#touch new src/main/brand-new.ts');
  });

  it('shows the new lines in the review of their sections', () => {
    expect(runPlan(root, 'show', EXAMPLE, 'impact').stdout).toContain('#impact new src/main/lantern-plans.ts Loads every plan file');
    expect(runPlan(root, 'show', EXAMPLE, 's1').stdout).toContain('#touch new src/main/lantern-plans.ts');
  });
});

describe('plan.mjs check: names that are not in the map', () => {
  it('errors on an unknown feature in the impact section and on a stage item', () => {
    edit(EXAMPLE, '#impact feature macro-view', '#impact feature macro-vew');
    edit(EXAMPLE, '#touch feature macro-view', '#touch feature mapview');
    const errors = errorsOf(EXAMPLE);
    expect(errors).toMatch(/#impact feature macro-vew: feature macro-vew is not in \.lantern\/features/);
    expect(errors).toMatch(/s2\.1 #touch feature mapview: feature mapview is not in \.lantern\/features \(known: file-graph, macro-view, pull-requests\)/);
  });

  it('errors on an unknown area', () => {
    edit(EXAMPLE, '#impact area review-changes', '#impact area reviewing');
    expect(errorsOf(EXAMPLE)).toMatch(/area reviewing is not in \.lantern\/areas \(known: explore-the-map, review-changes\)/);
  });

  it('errors on a file that is not in the map and never was', () => {
    edit(EXAMPLE, '#touch file src/main/main.ts', '#touch file src/main/mian.ts');
    expect(errorsOf(EXAMPLE)).toMatch(/s1\.2 #touch file src\/main\/mian\.ts: src\/main\/mian\.ts is not in the map and never was/);
  });

  it('errors on a file that exists but has no record, and says to refresh the map', () => {
    write(root, 'src/main/extra.ts', 'export {};\n');
    edit(EXAMPLE, '#touch file src/main/main.ts', '#touch file src/main/extra.ts');
    expect(errorsOf(EXAMPLE)).toMatch(/src\/main\/extra\.ts exists but the map has no record of it; refresh the map first/);
  });

  it('only warns about a file that was deleted since', () => {
    write(root, 'src/main/gone.ts', 'export {};\n');
    git(root, ['add', '.']);
    git(root, ['commit', '-q', '-m', 'add gone']);
    git(root, ['rm', '-q', 'src/main/gone.ts']);
    git(root, ['commit', '-q', '-m', 'drop gone']);
    edit(EXAMPLE, '#touch file src/main/main.ts', '#touch file src/main/gone.ts');
    expect(check(EXAMPLE).ok).toBe(true);
    expect(warningsOf(EXAMPLE)).toMatch(/src\/main\/gone\.ts was deleted since/);
  });

  it('warns when an item touches something the impact section does not cover', () => {
    edit(EXAMPLE, '#touch file src/main/main.ts', '#touch file src/main/lantern-types.ts');
    expect(check(EXAMPLE).ok).toBe(true);
    expect(warningsOf(EXAMPLE)).toMatch(/s1\.2 touches file src\/main\/lantern-types\.ts, which the #impact section does not cover/);
  });

  it('counts a file as covered when its feature or its area is in the impact section', () => {
    edit(EXAMPLE, '#touch file src/main/main.ts', '#touch file src/renderer/lib/macroview/mount.ts');
    expect(warningsOf(EXAMPLE)).toBe('');
  });
});

describe('plan.mjs check: structure', () => {
  it('errors on a duplicate item id and a duplicate stage', () => {
    edit(EXAMPLE, '#item s1.2 Hand the plans', '#item s1.1 Hand the plans');
    expect(errorsOf(EXAMPLE)).toMatch(/second #item s1\.1/);
    edit(EXAMPLE, '#stage s2 Show the plan on the map', '#stage s1 Show the plan on the map');
    expect(errorsOf(EXAMPLE)).toMatch(/second #stage s1/);
  });

  it('errors when stages are out of order', () => {
    const text = fs.readFileSync(planFile(DRAFT), 'utf8').replace('#stage s1 Parse', '#stage s2 Parse').replace('#item s1.1', '#item s2.1').replace('s1.q1', 's2.q1');
    fs.writeFileSync(planFile(DRAFT), text);
    expect(errorsOf(DRAFT)).toMatch(/stage order: s2 stands at position 1, expected s1/);
  });

  it('errors on a question that has no stage to belong to', () => {
    edit(DRAFT, '#stage s1 Parse', '#question s1.q9 Early?\n#stage s1 Parse');
    expect(errorsOf(DRAFT)).toMatch(/question without a stage/);
  });

  it('errors on an item without an acceptance check or without anything it touches', () => {
    edit(DRAFT, '#accept The reader parses every fixture the skill scripts parse.\n', '');
    edit(DRAFT, '#touch file src/main/lantern-pr-parse.ts\n', '');
    const errors = errorsOf(DRAFT);
    expect(errors).toMatch(/item s1\.1 has no #accept/);
    expect(errors).toMatch(/item s1\.1 has no #touch/);
  });

  it('errors on a stage with no item and on a plan with no impact', () => {
    fs.writeFileSync(planFile(DRAFT), ['lantern-plan 1', '# draft-reader', '#title T', '#opened 2026-10-26', '#goal G.', '#scope-in S.', '#stage s1 Empty', ''].join('\n'));
    const errors = errorsOf(DRAFT);
    expect(errors).toMatch(/stage s1 has no #item/);
    expect(errors).toMatch(/the plan has no #impact line/);
  });

  it('says which line of a plan that does not parse', () => {
    edit(EXAMPLE, '#risk A plan edited', '#risk A plan\u0001 edited');
    const run = runPlan(root, 'check', EXAMPLE);
    expect(run.status).toBe(1);
    expect(run.stdout).toMatch(/plan-on-the-map\.plan:\d+: #risk .*control character/);
  });
});

describe('plan.mjs check: approvals', () => {
  it('errors on an approval for a section the plan does not have', () => {
    editKeepingApprovals(DRAFT, '#approved title', '#approved s9 jun 2026-10-26 aaaaaaaaaaaa\n#approved title');
    expect(errorsOf(DRAFT)).toMatch(/#approved s9: the plan has no such section/);
  });

  it('warns about a changed section while the plan is a draft, and errors once the plan was approved', () => {
    editKeepingApprovals(DRAFT, '#title Read a plan file in the app', '#title Read a plan file in the Lantern app');
    expect(check(DRAFT).ok).toBe(true);
    expect(warningsOf(DRAFT)).toMatch(/section title changed after jun approved it on 2026-10-26/);
    editKeepingApprovals(EXAMPLE, '#goal A selected stage lights up', '#goal A chosen stage lights up');
    expect(errorsOf(EXAMPLE)).toMatch(/the plan is approved \("#approved plan"\) but section goal is changed since it was approved/);
  });

  it('errors on a plan approval with a section that was never approved', () => {
    editKeepingApprovals(EXAMPLE, '#approved risks jun 2026-10-26 4022fd4c7568\n', '');
    expect(errorsOf(EXAMPLE)).toMatch(/section risks is not approved/);
  });
});

describe('plan.mjs check: several plans', () => {
  it('checks every plan with --all and fails if any fails', () => {
    expect(planJson<CheckReport>(root, 'check', '--all').ok).toBe(true);
    edit(DRAFT, '#touch feature pull-requests', '#touch feature nothing');
    const report = planJson<CheckReport>(root, 'check', '--all');
    expect(report.ok).toBe(false);
    expect(report.results.map((r) => [r.plan, r.ok])).toEqual([
      ['.lantern/plans/draft-reader.plan', false],
      ['.lantern/plans/plan-on-the-map.plan', true],
    ]);
  });

  it('resolves a relative path against --root, not against the working directory', () => {
    const run = runNode(PLAN_SCRIPT, ['check', `.lantern/plans/${EXAMPLE}.plan`, '--root', root], os.tmpdir());
    expect(run.status).toBe(0);
    expect(run.stdout).toContain(`${EXAMPLE}.plan: OK`);
  });

  it('checks a plan file by path, so a fixture can be checked against a map', () => {
    const run = runPlan(root, 'check', path.join(root, '.lantern', 'plans', `${EXAMPLE}.plan`));
    expect(run.status).toBe(0);
    expect(fixtureText(EXAMPLE)).toBe(fs.readFileSync(planFile(EXAMPLE), 'utf8'));
  });
});
