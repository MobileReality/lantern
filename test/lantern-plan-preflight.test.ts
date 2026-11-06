import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { makeTmp } from './helpers/git-repo';
import { DRAFT, EXAMPLE, SKILLS, makeProject, removeDir, runPlan } from './helpers/lantern-plan-world';

const PREFLIGHT = path.join(SKILLS, 'lantern-delegate', 'scripts', 'preflight.mjs');
const STUBS = ['lantern-sync', 'lantern-delegate', 'lantern-delegate-complex', 'lantern-commit', 'lantern-local-loop', 'lantern-no-comments', 'lantern-code-reviewer', 'lantern-jira'];
const REAL = ['lantern-setup', 'lantern-plan', 'lantern-plan-handoff'];

let tmp: string;
let session: string;
let home: string;
let repo: string;

function installSkills(names: string[]) {
  const target = path.join(session, '.claude', 'skills');
  for (const name of STUBS) {
    fs.mkdirSync(path.join(target, name), { recursive: true });
    fs.writeFileSync(path.join(target, name, 'SKILL.md'), `# ${name}\n`);
  }
  for (const name of names) fs.cpSync(path.join(SKILLS, name), path.join(target, name), { recursive: true, filter: (src) => !src.endsWith('example-web') });
}

function preflight(...extra: string[]) {
  const linker = path.join(tmp, 'linker', 'skill-linker');
  fs.mkdirSync(path.join(tmp, 'linker', 'core'), { recursive: true });
  fs.writeFileSync(linker, '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  const env: NodeJS.ProcessEnv = { ...process.env, HOME: home, SKILL_LINKER: linker, LANTERN_PROFILE: '', GIT_CONFIG_GLOBAL: '/dev/null' };
  const result = spawnSync(process.execPath, [PREFLIGHT, '--target', 'main', '--repo-dir', repo, '--no-api', ...extra], { cwd: session, env, encoding: 'utf8' });
  return `${result.stdout}${result.stderr}`;
}

const line = (out: string, prefix: string) => out.split('\n').find((l) => l.startsWith(prefix)) ?? '';

beforeEach(() => {
  tmp = makeTmp('lantern-plan-preflight-');
  session = path.join(tmp, 'session');
  home = path.join(tmp, 'home');
  fs.mkdirSync(session);
  fs.mkdirSync(home);
  repo = makeProject([EXAMPLE, DRAFT]);
  installSkills(REAL);
});

afterEach(() => {
  removeDir(tmp);
  removeDir(repo);
});

describe('preflight --plan', () => {
  it('says nothing about plans when no plan is given', () => {
    const out = preflight();
    expect(line(out, 'ok   skills:')).toBeTruthy();
    expect(out).not.toMatch(/ plan:/);
  });

  it('fails an approved plan that is not on the base the delegates fork from', () => {
    const copy = fs.readFileSync(path.join(repo, '.lantern', 'plans', `${EXAMPLE}.plan`), 'utf8').replace('# plan-on-the-map', '# plan-copy');
    fs.writeFileSync(path.join(repo, '.lantern', 'plans', 'plan-copy.plan'), copy);
    expect(line(preflight('--plan', 'plan-copy'), 'FAIL plan:')).toMatch(/plan-copy is approved but \.lantern\/plans\/plan-copy\.plan is not on main, the base the delegates fork from/);
    expect(line(preflight('--plan', EXAMPLE), 'ok   plan:')).toBeTruthy();
  });

  it('fails when the approved plan on disk is not the one committed on the base', () => {
    expect(runPlan(repo, 'add', EXAMPLE, 'answer', 's2.q1', 'jun', 'Beside the macro view.').status).toBe(0);
    expect(line(preflight('--plan', EXAMPLE), 'FAIL plan:')).toMatch(/plan-on-the-map is approved but \.lantern\/plans\/plan-on-the-map\.plan differs from the copy on main/);
  });

  it('passes an approved, clean plan and says which items are ready', () => {
    const out = preflight('--plan', EXAMPLE);
    expect(line(out, 'ok   plan:')).toMatch(/plan-on-the-map is approved and clean; stage s1, ready: s1\.1, s1\.2\. Put "Plan: plan-on-the-map" in the brief/);
    expect(line(out, 'ok   skills:')).toMatch(/this run: lantern-plan, lantern-plan-handoff/);
  });

  it('fails a plan that is not approved, and says what is open', () => {
    const failed = line(preflight('--plan', DRAFT), 'FAIL plan:');
    expect(failed).toMatch(/draft-reader cannot be handed over: the plan is not approved; sections still open: goal \(pending\)/);
  });

  it('fails a plan that does not exist', () => {
    expect(line(preflight('--plan', 'ghost'), 'FAIL plan:')).toMatch(/plan\.mjs handoff ghost could not run: .*no plan at/);
  });

  it('fails when the planning skills are not installed, and names the installer', () => {
    fs.rmSync(path.join(session, '.claude', 'skills', 'lantern-plan-handoff'), { recursive: true });
    const failed = line(preflight('--plan', EXAMPLE), 'FAIL skills:');
    expect(failed).toContain('not in the registry the delegate inherits: lantern-plan-handoff.');
    expect(failed).toContain('install-skills');
  });

  it('fails when lantern-plan itself is missing', () => {
    fs.rmSync(path.join(session, '.claude', 'skills', 'lantern-plan'), { recursive: true });
    const out = preflight('--plan', EXAMPLE);
    expect(line(out, 'FAIL skills:')).toContain('lantern-plan.');
    expect(line(out, 'FAIL plan:')).toMatch(/needs lantern-plan, which is not in/);
  });
});
