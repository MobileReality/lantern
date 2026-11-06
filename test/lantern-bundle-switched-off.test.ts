import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { installBundleGuarded, SKILL_MARKER } from '../scripts/lantern-bundle.mjs';
import { offEverywhere } from '../skills/lantern-delegate/scripts/bundled-skills.mjs';
import { forgetAttempts, reinstallOf, settled } from '../src/main/bundle';
import { git, makeBundle, makeHome, makeRepo } from './support/bundle-fixtures';

const run = promisify(execFile);
const INSTALL = path.join(__dirname, '..', 'scripts', 'install-skills.mjs');
const MAIN = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'main.ts'), 'utf8');
const EXTENSIONS_IPC = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'extensions-ipc.ts'), 'utf8');
const LOCKED = ['lantern-setup', 'lantern-sync', 'lantern-delegate', 'lantern-plan', 'lantern-bitbucket', 'lantern-github', 'lantern-jira'];
const DELEGATE_ONLY = ['lantern-commit', 'lantern-local-loop'];

let tmp: string;
let project: string;
let skills: string;
let home: string;
let root: string;

const present = (name: string) => fs.existsSync(path.join(skills, name, 'SKILL.md'));

function switchOff(off: Record<string, string[]>) {
  fs.writeFileSync(path.join(home, '.claude', 'lantern-extensions.json'), JSON.stringify({ off }));
}

const install = () => installBundleGuarded({ project, root, home });

beforeEach(() => {
  forgetAttempts();
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bundle-off-'));
  project = makeRepo(path.join(tmp, 'project'));
  skills = path.join(project, '.claude', 'skills');
  home = makeHome(path.join(tmp, 'home'));
  root = path.join(tmp, 'bundle');
  makeBundle(root);
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('offEverywhere', () => {
  it('names a skill only when every role that lists it has it switched off', () => {
    expect(offEverywhere({})).toEqual([]);
    expect(offEverywhere({ delegate: ['lantern-no-comments'] })).toEqual([]);
    expect(offEverywhere({ reviewer: ['lantern-no-comments', 'lantern-code-reviewer'] })).toEqual(['lantern-code-reviewer']);
    expect(offEverywhere({ delegate: ['lantern-commit', 'lantern-no-comments', 'lantern-local-loop'], reviewer: ['lantern-no-comments', 'lantern-code-reviewer'] })).toEqual([
      'lantern-commit',
      'lantern-local-loop',
      'lantern-no-comments',
      'lantern-code-reviewer',
    ]);
  });

  it('never names a skill no role can switch off', () => {
    expect(offEverywhere({ delegate: [...LOCKED], orchestrator: [...LOCKED], reviewer: [...LOCKED] })).toEqual([]);
  });
});

describe('the installer and skills switched off', () => {
  it('installs everything when nothing is switched off', async () => {
    await install();
    for (const name of [...LOCKED, ...DELEGATE_ONLY, 'lantern-no-comments', 'lantern-code-reviewer']) expect(present(name), name).toBe(true);
  });

  it('leaves out the four skills switched off for every role that lists them, and keeps the locked ones', async () => {
    switchOff({ delegate: ['lantern-commit', 'lantern-no-comments', 'lantern-local-loop'], reviewer: ['lantern-no-comments', 'lantern-code-reviewer'] });
    const result = await install();
    for (const name of ['lantern-commit', 'lantern-no-comments', 'lantern-local-loop', 'lantern-code-reviewer']) {
      expect(present(name), name).toBe(false);
      expect(result.skills[name]).toBe('off');
    }
    for (const name of LOCKED) expect(present(name), name).toBe(true);
  });

  it('keeps lantern-no-comments while the reviewer still has it on, and drops the delegate-only ones', async () => {
    switchOff({ delegate: ['lantern-commit', 'lantern-no-comments', 'lantern-local-loop'] });
    await install();
    expect(present('lantern-no-comments')).toBe(true);
    expect(present('lantern-code-reviewer')).toBe(true);
    for (const name of DELEGATE_ONLY) expect(present(name), name).toBe(false);
  });

  it('removes a marked copy already in the project and reports it', async () => {
    await install();
    expect(present('lantern-commit')).toBe(true);
    switchOff({ delegate: ['lantern-commit'] });
    const result = await install();
    expect(present('lantern-commit')).toBe(false);
    expect(result.skills['lantern-commit']).toBe('removed-off');
    expect(present('lantern-local-loop')).toBe(true);
  });

  it('keeps a folder of that name without the marker', async () => {
    fs.mkdirSync(path.join(skills, 'lantern-commit'), { recursive: true });
    fs.writeFileSync(path.join(skills, 'lantern-commit', 'SKILL.md'), 'mine');
    switchOff({ delegate: ['lantern-commit'] });
    const result = await install();
    expect(fs.readFileSync(path.join(skills, 'lantern-commit', 'SKILL.md'), 'utf8')).toBe('mine');
    expect(fs.existsSync(path.join(skills, 'lantern-commit', SKILL_MARKER))).toBe(false);
    expect(result.skills['lantern-commit']).toBe('off');
  });

  it('installs the skill again once it is switched back on', async () => {
    switchOff({ delegate: ['lantern-commit'] });
    await install();
    expect(present('lantern-commit')).toBe(false);
    switchOff({ delegate: [] });
    await install();
    expect(present('lantern-commit')).toBe(true);
    expect(fs.existsSync(path.join(skills, 'lantern-commit', SKILL_MARKER))).toBe(true);
  });

  it('treats an unreadable config as nothing switched off', async () => {
    fs.writeFileSync(path.join(home, '.claude', 'lantern-extensions.json'), '{ not json');
    await install();
    expect(present('lantern-commit')).toBe(true);
  });

  it('prints skipped and removed lines from install-skills', async () => {
    const env = { ...process.env, HOME: home, USERPROFILE: home, CODEX_HOME: path.join(home, '.codex'), INSTALL_SKILLS_SOURCE: root };
    await run(process.execPath, [INSTALL, project], { env });
    switchOff({ delegate: ['lantern-commit', 'lantern-local-loop'] });
    fs.rmSync(path.join(skills, 'lantern-local-loop'), { recursive: true });
    const { stdout } = await run(process.execPath, [INSTALL, project], { env });
    expect(stdout).toMatch(/removed +lantern-commit \(switched off in the Skills window\)/);
    expect(stdout).toMatch(/skipped +lantern-local-loop \(switched off in the Skills window\)/);
    expect(stdout).not.toMatch(/\b(old|legacy)\b.*lantern-commit/);
  });
});

describe('switched-off copies that git tracks', () => {
  const trackAll = () => {
    git(project, 'add', '-f', '.claude');
    git(project, 'commit', '-q', '-m', 'track skills');
  };

  it('leaves a committed marked copy on disk and reports it as not ignored', async () => {
    await install();
    trackAll();
    switchOff({ delegate: ['lantern-commit'] });
    const result = await install();
    expect(present('lantern-commit')).toBe(true);
    expect(result.skills['lantern-commit']).toBe('not-ignored');
    expect(git(project, 'status', '--short')).toBe('');
  });

  it('still removes a marked copy that git ignores', async () => {
    await install();
    switchOff({ delegate: ['lantern-commit'] });
    const result = await install();
    expect(present('lantern-commit')).toBe(false);
    expect(result.skills['lantern-commit']).toBe('removed-off');
  });

  it('deletes no obsolete copy when git ignores nothing it would install', async () => {
    await install();
    fs.mkdirSync(path.join(skills, 'commit'));
    fs.writeFileSync(path.join(skills, 'commit', 'SKILL.md'), 'obsolete');
    fs.writeFileSync(path.join(skills, 'commit', SKILL_MARKER), 'x\n');
    trackAll();
    switchOff({ delegate: ['lantern-commit'] });
    const result = await install();
    expect(result.skipped).toBe('not-ignored');
    expect(fs.existsSync(path.join(skills, 'commit', 'SKILL.md'))).toBe(true);
    expect(git(project, 'status', '--short')).toBe('');
  });
});

describe('saving a switch in the Skills window', () => {
  it('waits for an install already running for the project', async () => {
    const order: string[] = [];
    const first = reinstallOf(project, { home, root }).then(() => order.push('first'));
    const second = reinstallOf(project, { home, root }).then(() => order.push('second'));
    await Promise.all([first, second]);
    expect(order).toEqual(['first', 'second']);
  });

  it('reinstalls the open project at once, though it was installed before', async () => {
    await install();
    switchOff({ delegate: ['lantern-commit'] });
    await reinstallOf(project, { home, root });
    expect(present('lantern-commit')).toBe(false);
    switchOff({ delegate: [] });
    await reinstallOf(project, { home, root });
    await settled();
    expect(present('lantern-commit')).toBe(true);
  });

  it('is wired into the handler that saves a slot with its switches', () => {
    expect(MAIN).toMatch(/const reinstallFor = [^\n]*reinstallOf\(project, \{ provider: settings\.provider\(project\) \}\)/);
    expect(EXTENSIONS_IPC).toMatch(/'extensions:save',\n\s*fromWorkspace\(async[^\n]*\n\s*const run = \(\) => saveExtensionsSlot\([^\n]*\n[^\n]*\n\s*if \(!Array\.isArray\(req\?\.off\)\) return panel;\n\s*await reinstallFor\(req\?\.project\);/);
  });
});
