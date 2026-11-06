import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { forgetAttempts, installOnOpen, settled, setPermissionConsent } from '../src/main/bundle';
import { createPermissionConsent } from '../src/main/permission-consent';
import { settingsSnippet, ruleMatches } from '../skills/lantern-delegate/scripts/permissions.mjs';
import { makeHome, makeRepo } from './support/bundle-fixtures';

vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });

const REAL_ROOT = path.join(__dirname, '..', 'skills');
const MAIN = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'main.ts'), 'utf8');

let tmp: string;
let project: string;
let home: string;

const settingsFile = () => path.join(project, '.claude', 'settings.local.json');

function memoryConsent(answer: boolean) {
  const answers = new Map<string, boolean>();
  const ask = vi.fn(async () => answer);
  const consent = createPermissionConsent({ stored: (p) => answers.get(p), remember: (p, granted) => void answers.set(p, granted), ask });
  return { consent, ask, answers };
}

beforeEach(() => {
  vi.stubEnv('SKILL_LINKER', '');
  forgetAttempts();
  setPermissionConsent(() => false);
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lantern-consent-'));
  project = makeRepo(path.join(tmp, 'project'));
  home = makeHome(path.join(tmp, 'home'));
});

afterEach(() => {
  vi.unstubAllEnvs();
  setPermissionConsent(() => false);
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('opening a project asks before the delegate rules are written', () => {
  it('writes no rules when nobody has answered', async () => {
    installOnOpen(project, { home, root: REAL_ROOT });
    await settled();
    expect(fs.existsSync(settingsFile())).toBe(false);
  });

  it('asks once, writes nothing after a decline, and does not ask again on the next open', async () => {
    const { consent, ask } = memoryConsent(false);
    installOnOpen(project, { home, root: REAL_ROOT, consent });
    await settled();
    forgetAttempts();
    installOnOpen(project, { home, root: REAL_ROOT, consent });
    await settled();
    expect(ask).toHaveBeenCalledTimes(1);
    expect(fs.existsSync(settingsFile())).toBe(false);
  });

  it('writes the rules after an accept and does not ask again', async () => {
    const { consent, ask, answers } = memoryConsent(true);
    installOnOpen(project, { home, root: REAL_ROOT, consent });
    await settled();
    const allow = JSON.parse(fs.readFileSync(settingsFile(), 'utf8')).permissions.allow as string[];
    expect(allow).toContain('Bash(git commit:*)');
    forgetAttempts();
    installOnOpen(project, { home, root: REAL_ROOT, consent });
    await settled();
    expect(ask).toHaveBeenCalledTimes(1);
    expect([...answers.values()]).toEqual([true]);
  });

  it('keeps an edit made to the file while the dialog is open', async () => {
    const consent = async () => {
      fs.mkdirSync(path.dirname(settingsFile()), { recursive: true });
      fs.writeFileSync(settingsFile(), JSON.stringify({ permissions: { allow: ['Bash(ls:*)'] } }));
      return true;
    };
    installOnOpen(project, { home, root: REAL_ROOT, consent });
    await settled();
    const allow = JSON.parse(fs.readFileSync(settingsFile(), 'utf8')).permissions.allow as string[];
    expect(allow).toContain('Bash(ls:*)');
    expect(allow).toContain('Bash(git commit:*)');
  });

  it('adds new deny rules without asking when no allow rule is missing', async () => {
    const { consent } = memoryConsent(true);
    installOnOpen(project, { home, root: REAL_ROOT, consent });
    await settled();
    const file = JSON.parse(fs.readFileSync(settingsFile(), 'utf8'));
    file.permissions.deny = file.permissions.deny.filter((rule: string) => !rule.startsWith('Bash(git reset'));
    fs.writeFileSync(settingsFile(), JSON.stringify(file));
    forgetAttempts();
    const ask = vi.fn(() => false);
    installOnOpen(project, { home, root: REAL_ROOT, consent: ask });
    await settled();
    expect(ask).not.toHaveBeenCalled();
    expect(JSON.parse(fs.readFileSync(settingsFile(), 'utf8')).permissions.deny).toContain('Bash(git reset --hard origin/* *)');
  });

  it('shares one dialog between two opens that overlap', async () => {
    const { consent, ask } = memoryConsent(true);
    await Promise.all([consent(project), consent(project)]);
    expect(ask).toHaveBeenCalledTimes(1);
  });

  it('treats a dialog that fails as a decline and remembers nothing', async () => {
    const answers = new Map<string, boolean>();
    const consent = createPermissionConsent({ stored: (p) => answers.get(p), remember: (p, g) => void answers.set(p, g), ask: async () => Promise.reject(new Error('no window')) });
    expect(await consent(project)).toBe(false);
    expect(answers.size).toBe(0);
  });

  it('is wired to the app dialog and the saved settings in main', () => {
    expect(MAIN).toMatch(/setPermissionConsent\(\s*createPermissionConsent\(\{\s*stored: settings\.permissionConsent,\s*remember: settings\.setPermissionConsent/);
    expect(MAIN).toMatch(/dialog\.showMessageBox/);
  });
});

describe('git reset --hard', () => {
  const { allow, deny } = JSON.parse(settingsSnippet()).permissions as { allow: string[]; deny: string[] };
  const runs = (command: string) => allow.some((rule) => ruleMatches(rule, command)) && !deny.some((rule) => ruleMatches(rule, command));

  it('allows only a bare reset to one origin branch', () => {
    expect(runs('git reset --hard origin/main')).toBe(true);
    expect(runs('git reset --hard origin/feat/open-source')).toBe(true);
  });

  it('refuses a reset to anything else, or with anything after the ref', () => {
    for (const command of ['git reset --hard', 'git reset --hard HEAD~3', 'git reset --hard main', 'git reset --hard origin/main -- src', 'git reset --hard origin/main HEAD~1', 'git reset --hard origin/main --merge']) {
      expect(runs(command), command).toBe(false);
    }
  });

  it('carries no allow rule that resets more than origin/<ref>', () => {
    expect(allow.filter((rule) => /git reset/.test(rule))).toEqual(['Bash(git reset --hard origin/*)']);
  });
});
