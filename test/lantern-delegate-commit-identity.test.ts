import { execFile, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { shortFolder, startFakeLantern } from './helpers/fake-lantern';

vi.setConfig({ testTimeout: 30_000 });

const run = promisify(execFile);
const SCRIPTS = path.join(__dirname, '..', 'skills', 'lantern-delegate', 'scripts');
const PREFLIGHT = path.join(SCRIPTS, 'preflight.mjs');
const IDENTITY = path.join(SCRIPTS, 'github', 'identity.mjs');
const PROFILE_EMAIL = 'account@acme.example';
const FILE_EMAIL = 'from-file@acme.example';
const GIT_CONFIG_EMAIL = 'global@personal.example';

const HOSTS = [
  { host: 'bitbucket', origin: 'git@bitbucket.org:acme/widgets.git', granted: { BITBUCKET_EMAIL: PROFILE_EMAIL, BITBUCKET_API_TOKEN: 'tok-1' } },
  { host: 'github', origin: 'git@github.com:acme/widgets.git', granted: { GITHUB_TOKEN: 'tok-2' } },
];

let tmp: string;

beforeEach(() => {
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dl-ident-')));
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

function git(cwd: string, ...args: string[]) {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const name of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE']) delete env[name];
  return execFileSync('git', ['-c', 'init.defaultBranch=main', '-c', 'commit.gpgsign=false', ...args], { cwd, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function repo(origin?: string, declared?: string) {
  const work = path.join(tmp, 'work');
  fs.mkdirSync(work);
  git(work, 'init', '-q');
  git(work, 'config', 'user.name', 'Jun Tester');
  git(work, 'config', 'user.email', GIT_CONFIG_EMAIL);
  fs.writeFileSync(path.join(work, 'a.txt'), 'a\n');
  git(work, 'add', 'a.txt');
  git(work, 'commit', '-q', '-m', 'init');
  if (origin) git(work, 'remote', 'add', 'origin', origin);
  if (declared) {
    fs.mkdirSync(path.join(work, '.ai'));
    fs.writeFileSync(path.join(work, '.ai', '.env'), `GIT_COMMIT_EMAIL=${declared}\n`);
  }
  return work;
}

function cleanEnv(extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, HOME: path.join(tmp, 'home') };
  for (const name of ['BITBUCKET_EMAIL', 'BITBUCKET_API_TOKEN', 'GITHUB_TOKEN', 'LANTERN_CREDENTIAL_SOURCE', 'LANTERN_CREDENTIAL_PROVIDERS', 'LANTERN_CREDENTIAL_SOCKET', 'LANTERN_PROFILE', 'GIT_COMMIT_NAME', 'GIT_COMMIT_EMAIL', 'GIT_CONFIG_GLOBAL', 'GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'NODE_OPTIONS']) delete env[name];
  return { ...env, ...extra };
}

async function node(script: string, args: string[], cwd: string, env: NodeJS.ProcessEnv) {
  try {
    const { stdout, stderr } = await run(process.execPath, [script, ...args], { cwd, env });
    return { code: 0, out: `${stdout}${stderr}` };
  } catch (error) {
    const failed = error as { code: number; stdout: string; stderr: string };
    return { code: failed.code, out: `${failed.stdout}${failed.stderr}` };
  }
}

const line = (out: string, prefix: string) => out.split('\n').find((candidate) => candidate.startsWith(prefix));

async function lantern(host: string, granted: Record<string, string>, email: string | null) {
  const socket = path.join(shortFolder('dli-'), 'l.sock');
  const reply = { ok: true, env: { ...granted, ...(email ? { GIT_COMMIT_EMAIL: email } : {}) } };
  await startFakeLantern(socket, (request) => (request.provider === host ? reply : { ok: false, reason: 'no-account' }));
  return socket;
}

async function commitAuthor(work: string, env: NodeJS.ProcessEnv) {
  fs.writeFileSync(path.join(work, 'b.txt'), 'b\n');
  git(work, 'add', 'b.txt');
  const commit = await node(IDENTITY, ['--exec', 'git', '-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'work'], work, env);
  expect(commit.code).toBe(0);
  return git(work, 'log', '-1', '--format=%ae|%ce|%an');
}

describe.each(HOSTS)('the commit e-mail of a run on $host', ({ host, origin, granted }) => {
  it('comes from the Lantern profile with no .ai/.env, preflight says so, and the commit carries it', async () => {
    const work = repo(origin);
    const env = cleanEnv({ LANTERN_CREDENTIAL_SOCKET: await lantern(host, granted, PROFILE_EMAIL) });
    const res = await node(PREFLIGHT, ['--target', 'main', '--repo-dir', work, '--no-api'], tmp, env);
    const identity = line(res.out, 'ok   identity');
    expect(identity).toContain('the e-mail from the Lantern profile');
    expect(identity).toContain(PROFILE_EMAIL);
    expect(identity).toContain('Jun Tester');
    expect(await commitAuthor(work, env)).toBe(`${PROFILE_EMAIL}|${PROFILE_EMAIL}|Jun Tester`);
  });

  it('wins over GIT_COMMIT_EMAIL in .ai/.env, and a differing git config is no contradiction', async () => {
    const work = repo(origin, FILE_EMAIL);
    const env = cleanEnv({ LANTERN_CREDENTIAL_SOCKET: await lantern(host, granted, PROFILE_EMAIL) });
    const res = await node(PREFLIGHT, ['--target', 'main', '--repo-dir', work, '--no-api'], tmp, env);
    expect(line(res.out, 'ok   identity')).toContain('from the Lantern profile');
    expect(line(res.out, 'FAIL identity')).toBeUndefined();
    expect(await commitAuthor(work, env)).toBe(`${PROFILE_EMAIL}|${PROFILE_EMAIL}|Jun Tester`);
  });

  it('falls back to GIT_COMMIT_EMAIL when the profile has no e-mail', async () => {
    const work = repo(origin, FILE_EMAIL);
    git(work, 'config', 'user.email', FILE_EMAIL);
    const env = cleanEnv({ LANTERN_CREDENTIAL_SOCKET: await lantern(host, granted, null) });
    const res = await node(PREFLIGHT, ['--target', 'main', '--repo-dir', work, '--no-api'], tmp, env);
    expect(line(res.out, 'ok   identity')).toContain('the e-mail from GIT_COMMIT_EMAIL');
    expect(await commitAuthor(work, env)).toBe(`${FILE_EMAIL}|${FILE_EMAIL}|Jun Tester`);
  });

  it('still fails on a declared e-mail that git config contradicts, as before', async () => {
    const work = repo(origin, FILE_EMAIL);
    const res = await node(PREFLIGHT, ['--target', 'main', '--repo-dir', work, '--no-api'], tmp, cleanEnv());
    expect(line(res.out, 'FAIL identity')).toContain('user.email: expected');
  });

  it('warns clearly when neither source has an e-mail, and does not fail on it', async () => {
    const work = repo(origin);
    const env = cleanEnv({ LANTERN_CREDENTIAL_SOCKET: await lantern(host, granted, null) });
    const res = await node(PREFLIGHT, ['--target', 'main', '--repo-dir', work, '--no-api'], tmp, env);
    expect(line(res.out, 'WARN identity')).toContain('no commit e-mail found');
    expect(line(res.out, 'FAIL identity')).toBeUndefined();
    expect(await commitAuthor(work, env)).toBe(`${GIT_CONFIG_EMAIL}|${GIT_CONFIG_EMAIL}|Jun Tester`);
  });
});

describe('a project with no remote', () => {
  it('warns when nothing supplies an e-mail', async () => {
    const work = repo();
    const res = await node(PREFLIGHT, ['--target', 'main', '--repo-dir', work], tmp, cleanEnv());
    expect(line(res.out, 'WARN identity')).toContain('no commit e-mail found');
  });
});
