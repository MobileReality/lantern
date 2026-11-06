import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BUNDLE_SKILLS } from '../scripts/lantern-bundle.mjs';
import { brokenSettings } from '../skills/lantern-delegate/scripts/permissions.mjs';
import { makeRepo } from './support/bundle-fixtures';

const PREFLIGHT = path.join(__dirname, '..', 'skills', 'lantern-delegate', 'scripts', 'preflight.mjs');
const SKILL_NAMES = [...BUNDLE_SKILLS.map((s) => s.name), 'my-extra', 'second-extra'];

let tmp: string;
let home: string;
let repo: string;

const localFile = () => path.join(repo, '.claude', 'settings.local.json');

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'broken-settings-'));
  home = path.join(tmp, 'home');
  fs.mkdirSync(home);
  repo = makeRepo(path.join(tmp, 'repo'));
  for (const name of SKILL_NAMES) {
    fs.mkdirSync(path.join(repo, '.claude', 'skills', name), { recursive: true });
    fs.writeFileSync(path.join(repo, '.claude', 'skills', name, 'SKILL.md'), `# ${name}\n`);
  }
  fs.mkdirSync(path.join(tmp, 'linker'), { recursive: true });
  fs.writeFileSync(path.join(tmp, 'linker', 'skill-linker'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

function preflight() {
  const env: NodeJS.ProcessEnv = { ...process.env, HOME: home, USERPROFILE: home, SKILL_LINKER: path.join(tmp, 'linker', 'skill-linker'), LANTERN_RTK_DETECT: 'off' };
  for (const name of ['BITBUCKET_EMAIL', 'BITBUCKET_API_TOKEN', 'GITHUB_TOKEN', 'GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE']) delete env[name];
  const res = spawnSync(process.execPath, [PREFLIGHT, '--target', 'main', '--no-api'], { cwd: repo, env, encoding: 'utf8' });
  return `${res.stdout}${res.stderr}`;
}

describe('preflight names a settings file it cannot read', () => {
  it('names an unparseable settings.local.json in the permissions failure, with the snippet', () => {
    fs.writeFileSync(localFile(), '{ "permissions": ');
    const out = preflight();
    expect(out).toContain(`${localFile()}: not valid JSON`);
    expect(out).toContain('fix it by hand');
    expect(out).toContain('"permissions"');
    expect(fs.readFileSync(localFile(), 'utf8')).toBe('{ "permissions": ');
  });

  it('names a file whose allow list has the wrong shape', () => {
    fs.writeFileSync(localFile(), '{"permissions":{"allow":"Bash(ls:*)"}}');
    expect(preflight()).toContain(`${localFile()}: "permissions.allow" is not an array`);
  });

  it('names nothing when the files are valid', () => {
    fs.writeFileSync(localFile(), '{"permissions":{"allow":[]}}');
    expect(preflight()).not.toContain('fix it by hand');
    expect(brokenSettings([localFile(), path.join(tmp, 'absent.json')])).toEqual([]);
  });
});
