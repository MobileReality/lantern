import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { beforeAll, describe, expect, it } from 'vitest';
import { BUNDLE_SKILLS } from '../scripts/lantern-bundle.mjs';
import { PLAN_SCRIPT, PLAN_SCRIPTS, REPO, SKILLS, importScript, runNode } from './helpers/lantern-plan-world';

const run = promisify(execFile);

interface Registry {
  PLANNING_SKILLS: { name: string; purpose: string }[];
  STEP_SKILLS: { step: number; name: string; read: string[] }[];
}

let registry: Registry;

beforeAll(async () => {
  registry = await importScript<Registry>('planning-skills.mjs');
});

const skillText = (name: string) => fs.readFileSync(path.join(SKILLS, name, 'SKILL.md'), 'utf8');
const names = () => registry.PLANNING_SKILLS.map((s) => s.name);

describe('lantern-plan self-test', () => {
  it('passes every assertion and exits 0', async () => {
    const { stdout } = await run(process.execPath, [path.join(PLAN_SCRIPTS, 'selftest.mjs')], { maxBuffer: 10 * 1024 * 1024 });
    expect(stdout).toMatch(/all \d+ assertions passed/);
    expect(stdout).not.toMatch(/^not ok/m);
  }, 120_000);
});

describe('the planning skills are a registered set', () => {
  it('are in the bundle, in order, and each is a folder with a SKILL.md named after it', () => {
    const bundled = BUNDLE_SKILLS.map((s: { name: string }) => s.name);
    expect(bundled.filter((n: string) => n.startsWith('lantern-plan'))).toEqual(names());
    for (const name of names()) expect(skillText(name), name).toMatch(new RegExp(`^---\\nname: ${name}\\ndescription: .{80,}\\n---\\n`));
  });

  it('is exactly the lantern-plan family: nothing in skills/ shares the prefix without being listed', () => {
    const family = fs.readdirSync(SKILLS).filter((n) => n.startsWith('lantern-plan'));
    expect(family.sort()).toEqual([...names()].sort());
  });

  it('keeps every skill short enough to read whole, with the scripts in lantern-plan only', () => {
    for (const name of names()) {
      expect(skillText(name).split('\n').length, name).toBeLessThanOrEqual(100);
      expect(fs.existsSync(path.join(SKILLS, name, 'scripts')), name).toBe(name === 'lantern-plan');
    }
  });

  it('triggers on the phrases the owner named', () => {
    const description = /description: (.*)/.exec(skillText('lantern-plan'))![1];
    for (const phrase of ['"plan"', '"plan this feature"', '"lantern plan"', '"zaplanuj"']) expect(description).toContain(phrase);
  });

  it('has the same read-before-each-step table in SKILL.md and in the registry', () => {
    const rows = [...skillText('lantern-plan').matchAll(/^\| (\d) \| ([^|]+) \| `([a-z-]+)` \|$/gm)].map((m) => ({ step: Number(m[1]), name: m[2].trim(), read: [m[3]] }));
    expect(rows).toEqual(registry.STEP_SKILLS);
    for (const step of registry.STEP_SKILLS) for (const skill of step.read) expect(names()).toContain(skill);
  });

  it('only names plan.mjs commands that exist', () => {
    const usage = runNode(PLAN_SCRIPT, [], REPO).stderr;
    const commands = new Set(usage.split('\n').flatMap((l) => (/^ {2}([a-z]+) /.exec(l) ? [/^ {2}([a-z]+) /.exec(l)![1]] : [])));
    for (const name of names()) {
      for (const m of skillText(name).matchAll(/plan\.mjs (?:\$P\/scripts\/)?([a-z]+)/g)) expect(commands, `${name}: plan.mjs ${m[1]}`).toContain(m[1]);
      for (const m of skillText(name).matchAll(/\$P\/scripts\/plan\.mjs ([a-z]+)/g)) expect(commands, `${name}: ${m[1]}`).toContain(m[1]);
    }
  });
});
