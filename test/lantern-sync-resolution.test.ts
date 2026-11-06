import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const SYNC = path.join(__dirname, '..', 'skills', 'lantern-sync', 'scripts', 'sync.mjs');
const SETUP = path.join(__dirname, '..', 'skills', 'lantern-setup');

let root: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'lantern-sync-resolution-'));
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

function writeDecoy(providerDir: '.claude' | '.agents') {
  const decoy = path.join(root, 'project', providerDir, 'skills', 'lantern-setup');
  fs.mkdirSync(path.join(decoy, 'scripts'), { recursive: true });
  fs.writeFileSync(path.join(decoy, 'SKILL.md'), '# decoy\n');
  fs.writeFileSync(path.join(decoy, 'scripts', 'lib.mjs'), 'throw new Error("opposite provider selected");\n');
}

function run(script: string, args: string[]) {
  return spawnSync(process.execPath, [script, 'status', '--root', path.join(root, 'project'), ...args], {
    cwd: path.join(root, 'project'),
    encoding: 'utf8',
    env: { ...process.env, HOME: path.join(root, 'home'), CODEX_HOME: path.join(root, 'codex-home') },
  });
}

describe('lantern-sync setup discovery', () => {
  beforeEach(() => fs.mkdirSync(path.join(root, 'project'), { recursive: true }));

  it('uses only Codex roots when provider is explicit', () => {
    writeDecoy('.claude');
    const selected = path.join(root, 'project', '.agents', 'skills', 'lantern-setup');
    fs.mkdirSync(path.dirname(selected), { recursive: true });
    fs.symlinkSync(SETUP, selected);
    const result = run(SYNC, ['--provider', 'codex']);
    expect(result.status, `${result.stdout}${result.stderr}`).toBe(0);
    expect(result.stdout).toContain('no .lantern/map');
  });

  it('infers Codex from an installed .agents skill path and honors CODEX_HOME', () => {
    writeDecoy('.claude');
    const installedScript = path.join(root, 'project', '.agents', 'skills', 'lantern-sync', 'scripts', 'sync.mjs');
    fs.mkdirSync(path.dirname(installedScript), { recursive: true });
    fs.copyFileSync(SYNC, installedScript);
    const selected = path.join(root, 'codex-home', 'skills', 'lantern-setup');
    fs.mkdirSync(path.dirname(selected), { recursive: true });
    fs.symlinkSync(SETUP, selected);
    const result = run(installedScript, []);
    expect(result.status, `${result.stdout}${result.stderr}`).toBe(0);
    expect(result.stdout).toContain('no .lantern/map');
  });

  it('runs without lantern-plan beside it', () => {
    const skills = path.join(root, 'project', '.claude', 'skills');
    for (const name of ['lantern-sync', 'lantern-setup']) fs.cpSync(path.join(__dirname, '..', 'skills', name), path.join(skills, name), { recursive: true, filter: (src) => !src.endsWith('example-web') });
    const script = path.join(skills, 'lantern-sync', 'scripts', 'sync.mjs');
    const status = run(script, []);
    expect(status.status, `${status.stdout}${status.stderr}`).toBe(0);
    expect(status.stdout).toContain('no .lantern/map');
  });
});
