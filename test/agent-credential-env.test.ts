import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as agent from '@main/agent';
import { PROVIDERS_VAR, SOURCE_VAR, injectionOf } from '@main/auth/spawn-env';

const spawned = vi.hoisted(() => ({ envs: [] as NodeJS.ProcessEnv[], processes: [] as EventEmitter[] }));

vi.mock('node:child_process', () => ({
  spawn: (_bin: string, _args: string[], opts: { env: NodeJS.ProcessEnv }) => {
    spawned.envs.push(opts.env);
    const p = new EventEmitter() as EventEmitter & { stdout: EventEmitter; stderr: EventEmitter; stdin: null; kill: () => boolean };
    p.stdout = new EventEmitter();
    p.stderr = new EventEmitter();
    p.stdin = null;
    p.kill = () => true;
    spawned.processes.push(p);
    return p;
  },
}));

const fakeCodexDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ccm-fake-codex-env-'));
fs.writeFileSync(path.join(fakeCodexDir, process.platform === 'win32' ? 'codex.exe' : 'codex'), '#!/bin/sh\n', { mode: 0o755 });
const originalPath = process.env.PATH;

const credentialEnv = injectionOf({
  github: { secret: 'ghp_lantern_token', login: 'work' },
  jira: { secret: 'jira_lantern_token', login: 'me@x.test', email: 'me@x.test', site: 'https://acme.atlassian.net' },
});

const SCRUBBED = ['GITHUB_TOKEN', 'GLOBAL_ATLASSIAN_TOKEN', 'ATLASSIAN_EMAIL', 'ATLASSIAN_BASE_URL', SOURCE_VAR, PROVIDERS_VAR];
const saved: Record<string, string | undefined> = {};

describe('the environment of a run Lantern starts', () => {
  const dirs: string[] = [];

  beforeEach(() => {
    process.env.PATH = `${fakeCodexDir}${path.delimiter}${originalPath ?? ''}`;
    for (const name of SCRUBBED) {
      saved[name] = process.env[name];
      delete process.env[name];
    }
  });

  afterEach(async () => {
    vi.spyOn(process, 'kill').mockImplementation(() => true);
    const cancelling = agent.cancel();
    spawned.processes.splice(0).forEach((process) => { process.emit('close', null); });
    await cancelling;
    vi.restoreAllMocks();
    spawned.envs.length = 0;
    process.env.PATH = originalPath;
    for (const name of SCRUBBED) {
      if (saved[name] === undefined) delete process.env[name];
      else process.env[name] = saved[name];
    }
    for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
  });

  const project = () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ccm-credential-env-'));
    dirs.push(dir);
    return dir;
  };

  it('gives a Codex run the bound accounts and says they came from Lantern', () => {
    expect(agent.start({ project: project(), kind: 'lantern', provider: 'codex', credentialEnv, onEvent: () => {} }).ok).toBe(true);
    expect(spawned.envs.at(-1)).toMatchObject({
      GITHUB_TOKEN: 'ghp_lantern_token',
      ATLASSIAN_EMAIL: 'me@x.test',
      GLOBAL_ATLASSIAN_TOKEN: 'jira_lantern_token',
      ATLASSIAN_BASE_URL: 'https://acme.atlassian.net',
      [SOURCE_VAR]: 'lantern',
      [PROVIDERS_VAR]: 'github,jira',
    });
  });

  it('lets a variable the app already has win over the Lantern account', () => {
    process.env.GITHUB_TOKEN = 'explicit-from-the-shell';
    expect(agent.start({ project: project(), kind: 'lantern', provider: 'codex', credentialEnv, onEvent: () => {} }).ok).toBe(true);
    const env = spawned.envs.at(-1);
    expect(env?.GITHUB_TOKEN).toBe('explicit-from-the-shell');
    expect(env?.GLOBAL_ATLASSIAN_TOKEN).toBe('jira_lantern_token');
    expect(env?.[PROVIDERS_VAR]).toBe('jira');
  });

  it('adds nothing when the project has no bound account, and drops a stale marker', () => {
    process.env[SOURCE_VAR] = 'lantern';
    expect(agent.start({ project: project(), kind: 'lantern', provider: 'codex', onEvent: () => {} }).ok).toBe(true);
    const env = spawned.envs.at(-1);
    expect(env?.GITHUB_TOKEN).toBeUndefined();
    expect(env?.[SOURCE_VAR]).toBeUndefined();
  });

  it.skipIf(!agent.isAvailable())('does the same for a Claude run', () => {
    expect(agent.start({ project: project(), kind: 'lantern', credentialEnv, onEvent: () => {} }).ok).toBe(true);
    expect(spawned.envs.at(-1)).toMatchObject({ GITHUB_TOKEN: 'ghp_lantern_token', [SOURCE_VAR]: 'lantern' });
    expect(spawned.envs.at(-1)?.ELECTRON_RUN_AS_NODE).toBeUndefined();
  });
});
