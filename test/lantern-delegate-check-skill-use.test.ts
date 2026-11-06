import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const SCRIPTS = path.join(__dirname, '..', 'skills', 'lantern-delegate', 'scripts');
const SCRIPT = path.join(SCRIPTS, 'check-skill-use.mjs');
const PROTOCOL = path.join(__dirname, '..', 'skills', 'lantern-delegate', 'protocol.md');
const LINKER_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-use-linker-'));
fs.mkdirSync(path.join(LINKER_DIR, 'core'));
const LINKER = path.join(LINKER_DIR, 'my-linker');
fs.writeFileSync(LINKER, '#!/bin/sh\nexit 0\n', { mode: 0o755 });

const bash = (command: string) => ({ type: 'tool_use', name: 'Bash', input: { command } });
const read = (file_path: string, extra: object = {}) => ({ type: 'tool_use', name: 'Read', input: { file_path, ...extra } });
const edit = (file_path: string) => ({ type: 'tool_use', name: 'Edit', input: { file_path } });
const skillFile = (name: string) => `/wt/.claude/skills/${name}/SKILL.md`;
const rel = (name: string) => `.claude/skills/${name}/SKILL.md`;

const passingCalls = () => [
  read(skillFile('lantern-commit')),
  read(skillFile('lantern-no-comments')),
  bash(`cat ${rel('lantern-local-loop')}`),
  bash(`${LINKER} . --skill team-conventions`),
  read(skillFile('team-conventions')),
];

interface World {
  config?: string;
  installed?: string[];
  brief?: string;
}

function run(calls: object[], extra: string[] = [], agent = 'a1', world: World = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-use-'));
  const dir = path.join(root, 'transcripts');
  const home = path.join(root, 'home');
  const project = path.join(root, 'project');
  for (const folder of [dir, path.join(home, '.claude'), path.join(project, '.claude', 'skills')]) fs.mkdirSync(folder, { recursive: true });
  if (world.config !== undefined) fs.writeFileSync(path.join(home, '.claude', 'lantern-extensions.json'), world.config);
  for (const name of world.installed ?? []) {
    fs.mkdirSync(path.join(home, '.claude', 'skills', name), { recursive: true });
    fs.writeFileSync(path.join(home, '.claude', 'skills', name, 'SKILL.md'), `# ${name}\n`);
  }
  const lines = calls.map((c) => JSON.stringify({ message: { content: [c] } }));
  if (world.brief !== undefined) lines.unshift(JSON.stringify({ type: 'user', message: { role: 'user', content: world.brief } }));
  fs.writeFileSync(path.join(dir, 'agent-a1.jsonl'), lines.join('\n') + '\n');
  const res = spawnSync('node', [SCRIPT, ...extra, '--home', home, '--agent-id', agent, dir], { cwd: project, encoding: 'utf8', env: { ...process.env, SKILL_LINKER: LINKER } });
  return { status: res.status, out: res.stdout, err: res.stderr };
}

describe('check-skill-use', () => {
  it('passes a delegate that read every required skill in full', () => {
    const r = run(passingCalls());
    expect(r.out).toContain('0 skill-use finding(s)');
    expect(r.status).toBe(0);
  });

  it('passes with cat of several files and a for-loop cat over a literal list', () => {
    const r = run([
      bash(`cat ${rel('lantern-commit')} ${rel('lantern-no-comments')}`),
      bash(`for s in lantern-commit lantern-local-loop team-conventions; do cat .claude/skills/$s/SKILL.md; done`),
    ]);
    expect(r.out).toContain('0 skill-use finding(s)');
    expect(r.status).toBe(0);
  });

  it('passes with team-conventions found already present and read', () => {
    const r = run([...passingCalls().slice(0, 3), read(skillFile('team-conventions'))]);
    expect(r.status).toBe(0);
  });

  it('fails a skill read only with head -c, as skill-partly-read', () => {
    const calls = passingCalls();
    calls[2] = bash(`head -c 2500 ${rel('lantern-local-loop')}`);
    const r = run(calls);
    expect(r.status).toBe(1);
    expect(r.out).toMatch(/agent-a1\.jsonl:3 skill-partly-read lantern-local-loop/);
  });

  it('fails a Read with a limit, and with an offset above 1', () => {
    const limited = run([...passingCalls().filter((_, i) => i !== 1), read(skillFile('lantern-no-comments'), { limit: 30 })]);
    expect(limited.status).toBe(1);
    expect(limited.out).toContain('skill-partly-read lantern-no-comments');
    const offset = run([...passingCalls().filter((_, i) => i !== 1), read(skillFile('lantern-no-comments'), { offset: 20 })]);
    expect(offset.out).toContain('skill-partly-read lantern-no-comments');
    expect(run([...passingCalls(), read(skillFile('lantern-no-comments'), { offset: 1 })]).status).toBe(0);
  });

  it('treats cat piped into a truncating command as partial', () => {
    for (const tail of ['head -80', 'tail -20', 'sed -n 1,40p', 'grep -n x', "awk 'NR<5'"]) {
      const r = run([...passingCalls().slice(1), bash(`cat ${rel('lantern-commit')} | ${tail}`)]);
      expect(r.out, tail).toContain('skill-partly-read lantern-commit');
    }
  });

  it('treats grep, sed -n, tail and awk on the file as partial', () => {
    for (const cmd of ['grep -n x', 'sed -n 1,40p', 'tail -n 20', 'head -n 5']) {
      const r = run([...passingCalls().slice(1), bash(`${cmd} ${rel('lantern-commit')}`)]);
      expect(r.out, cmd).toContain('skill-partly-read lantern-commit');
    }
  });

  it('fails a skill never read, as skill-not-read', () => {
    const r = run(passingCalls().filter((_, i) => i !== 0));
    expect(r.status).toBe(1);
    expect(r.out).toMatch(/agent-a1\.jsonl:1 skill-not-read lantern-commit/);
    expect(r.out).toContain('1 skill-use finding(s)');
  });

  it('counts a full read after a partial one', () => {
    const r = run([bash(`head -c 2500 ${rel('lantern-commit')}`), ...passingCalls()]);
    expect(r.status).toBe(0);
  });

  it('does not require team-conventions with an empty or missing config', () => {
    const r = run(passingCalls().slice(0, 3));
    expect(r.out).toContain('0 skill-use finding(s)');
    expect(r.status).toBe(0);
    expect(r.out).not.toContain('warning');
  });

  it('fails team-conventions linked but never read, as skill-not-read', () => {
    const r = run(passingCalls().slice(0, 4));
    expect(r.out).toContain('skill-not-read team-conventions');
  });

  it('requires every other linked convention to be read in full', () => {
    const calls = [...passingCalls(), bash(`${LINKER} . --skill typescript`)];
    const r = run(calls);
    expect(r.status).toBe(1);
    expect(r.out).toContain('skill-not-read typescript');
    expect(run([...calls, read(skillFile('typescript'))]).status).toBe(0);
  });

  it('does not require a design skill after a UI file was edited', () => {
    expect(run([...passingCalls(), edit('/wt/src/app.css')]).status).toBe(0);
  });

  it('filters by --agent-id and exits 2 on usage errors', () => {
    expect(run(passingCalls().slice(0, 1), [], 'other').out).toContain('0 skill-use finding(s) in 0 transcript(s)');
    expect(spawnSync('node', [SCRIPT], { encoding: 'utf8' }).status).toBe(2);
    expect(spawnSync('node', [SCRIPT, '--home', os.tmpdir(), '/nonexistent/path'], { encoding: 'utf8' }).status).toBe(2);
    expect(spawnSync('node', [SCRIPT, '--home'], { encoding: 'utf8' }).status).toBe(2);
  });

  it('requires a configured delegate extra that resolves to be read in full', () => {
    const world = { config: JSON.stringify({ delegate: ['typescript'] }), installed: ['typescript'], brief: '## Goal\nx\n' };
    const missing = run(passingCalls(), [], 'a1', world);
    expect(missing.status).toBe(1);
    expect(missing.out).toMatch(/skill-not-read typescript/);
    const done = run([...passingCalls(), read(skillFile('typescript'))], [], 'a1', world);
    expect(done.out).toContain('0 skill-use finding(s)');
    expect(done.status).toBe(0);
  });

  it('is green with a brief that carries no line when every slot skill is read in full, red when one is not', () => {
    const config = JSON.stringify({ delegate: ['typescript', 'zod-schemas'] });
    const installed = ['typescript', 'zod-schemas'];
    const brief = '## Goal\nx\n';
    const calls = [...passingCalls(), read(skillFile('typescript')), read(skillFile('zod-schemas'))];
    const full = run(calls, [], 'a1', { config, installed, brief });
    expect(full.out).toContain('0 skill-use finding(s)');
    expect(full.status).toBe(0);
    const partial = run(calls.slice(0, -1), [], 'a1', { config, installed, brief });
    expect(partial.status).toBe(1);
    expect(partial.out).toContain('skill-not-read zod-schemas');
    expect(partial.out).not.toContain('skill-not-read typescript');
    expect(partial.out).not.toContain('brief-');
  });

  it('does not ask for anything beyond the fixed skills when the slot is empty or does not resolve', () => {
    expect(run(passingCalls(), [], 'a1', { brief: '## Goal\n' }).status).toBe(0);
    expect(run(passingCalls(), [], 'a1', { config: JSON.stringify({ delegate: ['typescript'] }), brief: '## Goal\n' }).status).toBe(0);
  });

  it('holds an orchestrator transcript to the orchestrator list with --role orchestrator', () => {
    const config = JSON.stringify({ delegate: ['typescript'], orchestrator: ['my-extra'] });
    const installed = ['typescript', 'my-extra'];
    const orchestratorCalls = [read(skillFile('lantern-sync')), read(skillFile('my-extra'))];
    const done = run(orchestratorCalls, ['--role', 'orchestrator'], 'a1', { config, installed });
    expect(done.out).toContain('0 skill-use finding(s)');
    expect(done.status).toBe(0);
    const missing = run(orchestratorCalls.slice(0, 1), ['--role', 'orchestrator'], 'a1', { config, installed });
    expect(missing.status).toBe(1);
    expect(missing.out).toContain('skill-not-read my-extra');
    expect(missing.out).not.toContain('typescript');
    const delegateList = run(orchestratorCalls, [], 'a1', { config, installed });
    expect(delegateList.out).toContain('skill-not-read lantern-commit');
  });

  it('holds a reviewer transcript to the reviewer list with --role reviewer, the full-read rules unchanged', () => {
    const config = JSON.stringify({ delegate: ['typescript'], reviewer: ['biome'] });
    const installed = ['typescript', 'biome'];
    const reviewerCalls = [read(skillFile('lantern-no-comments')), read(skillFile('lantern-code-reviewer')), read(skillFile('biome'))];
    const done = run(reviewerCalls, ['--role', 'reviewer'], 'a1', { config, installed });
    expect(done.out).toContain('0 skill-use finding(s)');
    expect(done.status).toBe(0);
    const missing = run(reviewerCalls.slice(0, 2), ['--role', 'reviewer'], 'a1', { config, installed });
    expect(missing.status).toBe(1);
    expect(missing.out).toContain('skill-not-read biome');
    expect(missing.out).not.toContain('typescript');
    const partial = run([...reviewerCalls.slice(0, 2), read(skillFile('biome'), { limit: 20 })], ['--role', 'reviewer'], 'a1', { config, installed });
    expect(partial.out).toContain('skill-partly-read biome');
    const delegateList = run(reviewerCalls, [], 'a1', { config, installed });
    expect(delegateList.out).toContain('skill-not-read lantern-commit');
    expect(run(reviewerCalls.slice(0, 1), ['--role', 'reviewer']).out).toContain('skill-not-read lantern-code-reviewer');
  });

  it('adds the host skill and the planning skills to the orchestrator list with --host and --plan', () => {
    const base = [read(skillFile('lantern-sync'))];
    expect(run(base, ['--role', 'orchestrator']).status).toBe(0);
    const host = run(base, ['--role', 'orchestrator', '--host', 'lantern-github']);
    expect(host.out).toContain('skill-not-read lantern-github');
    const plan = run(base, ['--role', 'orchestrator', '--plan']);
    expect(plan.out).toContain('skill-not-read lantern-plan');
    expect(plan.out).toContain('skill-not-read lantern-plan-handoff');
    expect(run(base, ['--role', 'nobody']).status).toBe(2);
    expect(run(base, ['--role', 'orchestrator', '--host', 'unknown']).status).toBe(2);
  });

  it('skips a configured delegate extra that does not resolve, with a warning naming it', () => {
    const r = run(passingCalls(), [], 'a1', { config: JSON.stringify({ delegate: ['typescript'] }) });
    expect(r.status).toBe(0);
    expect(r.out).toMatch(/warning: Configured delegate extra "typescript" does not resolve.*skipped/);
  });

  it('treats a damaged config as a warning and as empty', () => {
    const r = run(passingCalls().slice(0, 3), [], 'a1', { config: '{ not json' });
    expect(r.status).toBe(0);
    expect(r.out).toMatch(/warning: The extensions config is ignored and treated as empty/);
    expect(r.out).toContain('0 skill-use finding(s)');
  });

  it('prints the warnings in the JSON too', () => {
    const r = run(passingCalls(), ['--json'], 'a1', { config: '[]' });
    expect(JSON.parse(r.out).warnings).toHaveLength(1);
  });

  it('prints findings as JSON with --json', () => {
    const r = run(passingCalls().slice(1), ['--json']);
    expect(JSON.parse(r.out).findings[0]).toMatchObject({ rule: 'skill-not-read', skill: 'lantern-commit' });
  });
});

describe('protocol.md sends the delegate to the one list', () => {
  it('keeps no list of its own in the section on skills to read in full', async () => {
    const mod = await import(path.join(SCRIPTS, 'required-skills.mjs'));
    const text = fs.readFileSync(PROTOCOL, 'utf8');
    const section = text.split('### Skills you must read in full')[1].split(/\n#{2,3} /)[0];
    expect(section).toContain('required-skills.mjs');
    const bundled = await import(path.join(SCRIPTS, 'bundled-skills.mjs'));
    const names = Object.values(bundled.SWITCHABLE_SKILLS).flat() as string[];
    expect(names.length).toBeGreaterThan(0);
    for (const name of names) expect(section, name).not.toContain(name);
    expect(mod.REQUIRED_SKILLS).toEqual(bundled.SWITCHABLE_SKILLS.delegate);
  });
});

describe('check-skill-use follows a switched-off skill', () => {
  const findings = (out: string) => [...out.matchAll(/agent-a1\.jsonl:\d+ ([a-z-]+ [\w-]+)/g)].map((m) => m[1]);
  const config = (off: object) => JSON.stringify({ off });
  const skillRead = (...names: string[]) => names.map((name) => read(skillFile(name)));

  it('demands every fixed skill of the delegate with no off list', () => {
    const r = run(skillRead('lantern-commit'));
    expect(r.status).toBe(1);
    expect(findings(r.out)).toEqual(['skill-not-read lantern-no-comments', 'skill-not-read lantern-local-loop']);
  });

  it('does not demand a switched-off skill and still demands the rest', () => {
    const world = { config: config({ delegate: ['lantern-commit'] }) };
    const partial = run(skillRead('lantern-local-loop'), [], 'a1', world);
    expect(partial.status).toBe(1);
    expect(findings(partial.out)).toEqual(['skill-not-read lantern-no-comments']);
    expect(run(skillRead('lantern-no-comments', 'lantern-local-loop'), [], 'a1', world).status).toBe(0);
  });

  it('follows the reviewer off list for the reviewer role and never the delegate one', () => {
    const world = { config: config({ reviewer: ['lantern-code-reviewer'], delegate: ['lantern-commit'] }) };
    expect(run(skillRead('lantern-no-comments'), ['--role', 'reviewer'], 'a1', world).status).toBe(0);
    expect(findings(run(skillRead('lantern-code-reviewer'), ['--role', 'reviewer'], 'a1', world).out)).toEqual(['skill-not-read lantern-no-comments']);
  });

  it('keeps demanding a locked skill whatever the off list says', () => {
    const r = run([], ['--role', 'orchestrator'], 'a1', { config: config({ orchestrator: ['lantern-sync'] }) });
    expect(findings(r.out)).toEqual(['skill-not-read lantern-sync']);
  });
});

describe('exports the e2e harness reuses', () => {
  const user = (content: string) => JSON.stringify({ type: 'user', message: { role: 'user', content } });
  const toolLine = (...blocks: object[]) => JSON.stringify({ message: { content: blocks } });

  it('skillReadFindings judges only the names given, by the full-read rule', async () => {
    const mod = await import(path.join(SCRIPTS, 'check-skill-use.mjs'));
    const text = [toolLine(read(skillFile('x'))), toolLine(read(skillFile('y'), { limit: 3 }))].join('\n');
    expect(mod.skillReadFindings(text, ['x'])).toEqual([]);
    expect(mod.skillReadFindings(text, ['y', 'z']).map((f: { rule: string; skill: string }) => `${f.rule} ${f.skill}`)).toEqual(['skill-partly-read y', 'skill-not-read z']);
  });
});
