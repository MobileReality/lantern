import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DRAFT, makeProject, removeDir, runPlan } from './helpers/lantern-plan-world';

let root: string;

beforeEach(() => {
  root = makeProject([DRAFT]);
});

afterEach(() => {
  removeDir(root);
});

const planText = () => fs.readFileSync(path.join(root, '.lantern', 'plans', `${DRAFT}.plan`), 'utf8');

describe('plan.mjs reads its arguments through cli-args', () => {
  it('refuses a flag whose value is the next flag, and leaves the plan alone', () => {
    const before = planText();
    const run = runPlan(root, 'approve', DRAFT, 'goal', '--by', '--date', 'x');
    expect(run.status).toBe(2);
    expect(run.stderr).toMatch(/--by needs a value/);
    expect(planText()).toBe(before);
  });

  it('refuses a value flag that ends the command line', () => {
    const run = runPlan(root, 'approve', DRAFT, 'goal', '--date');
    expect(run.status).toBe(2);
    expect(run.stderr).toMatch(/--date needs a value/);
  });

  it('refuses an option it does not know, and prints the usage', () => {
    const run = runPlan(root, 'list', '--bogus');
    expect(run.status).toBe(2);
    expect(run.stderr).toMatch(/unknown option --bogus/);
    expect(run.stderr).toMatch(/usage: plan\.mjs <command>/);
  });

  it('exits 2 with the usage for a command it does not know and for no command', () => {
    expect(runPlan(root, 'bogus').status).toBe(2);
    expect(runPlan(root).status).toBe(2);
  });

  it('still takes a value flag with a value, a repeated flag and a boolean flag', () => {
    expect(runPlan(root, 'approve', DRAFT, 'goal', '--by', 'jun', '--date', '2026-10-26').status).toBe(0);
    expect(runPlan(root, 'impact', '--file', 'src/main/lantern-prs.ts', '--feature', 'file-graph', '--depth', '2', '--json').status).toBe(0);
  });

  it('keeps a failed command at exit 1 and a usage mistake at exit 2', () => {
    expect(runPlan(root, 'show', 'ghost').status).toBe(1);
    expect(runPlan(root, 'show').status).toBe(2);
  });
});
