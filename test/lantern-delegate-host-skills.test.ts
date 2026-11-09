import { execFile, execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
// @ts-expect-error plain ES module, no declarations
import { BUNDLE_SKILLS } from '../scripts/lantern-bundle.mjs';
// @ts-expect-error plain ES module, no declarations
import { HOST_SKILL, hostScript, runHostSkill, skillRoots } from '../skills/lantern-delegate/scripts/host-skill.mjs';
import { createRouter, startFakeHost } from './helpers/fake-host';
import type { Route } from './helpers/fake-host';
import { shortFolder, startFakeLantern } from './helpers/fake-lantern';

vi.setConfig({ testTimeout: 30_000 });

const run = promisify(execFile);
const SKILLS = path.join(__dirname, '..', 'skills');
const SCRIPTS = path.join(SKILLS, 'lantern-delegate', 'scripts');
const PREFLIGHT = path.join(SCRIPTS, 'preflight.mjs');
const PR_CREATE = path.join(SCRIPTS, 'pr-create.mjs');
const PR_APPEND_COST = path.join(SCRIPTS, 'pr-append-cost.mjs');
const REDIRECT = path.join(__dirname, 'helpers', 'redirect-fetch.mjs');
const BUNDLED = BUNDLE_SKILLS.map((skill: { name: string }) => skill.name) as string[];
const ORCHESTRATOR = ['my-extra', 'second-extra'];
const HOST_SKILLS = Object.values(HOST_SKILL).map((host) => (host as { skill: string }).skill);
const TOKEN = 'socket-granted-token-5c2e81';
const EMAIL = 'dev@example.com';

interface HostCase {
  host: 'bitbucket' | 'github';
  skill: string;
  other: string;
  origin: string;
  slug: { first: string; repo: string };
  granted: Record<string, string>;
  authorization: string;
  scopes: Route[];
  noScope: Route[];
  lookup: Route;
  create: Route;
  pr: string;
  readPr: (description: string) => Route;
  write: string;
  written: (body: unknown) => string;
  url: string;
}

const BB = 'https://api.bitbucket.org/2.0/repositories/acme/widgets';
const GH = 'https://api.github.com/repos/acme/widgets';

const CASES: HostCase[] = [
  {
    host: 'bitbucket',
    skill: 'lantern-bitbucket',
    other: 'lantern-github',
    origin: 'git@bitbucket.org:acme/widgets.git',
    slug: { first: '--workspace', repo: '--repo' },
    granted: { BITBUCKET_EMAIL: EMAIL, BITBUCKET_API_TOKEN: TOKEN },
    authorization: `Basic ${Buffer.from(`${EMAIL}:${TOKEN}`).toString('base64')}`,
    scopes: [{ method: 'GET', url: BB, reply: { body: {}, headers: { 'x-oauth-scopes': 'read:repository:bitbucket, write:pullrequest:bitbucket' } } }],
    noScope: [{ method: 'GET', url: BB, reply: { body: {}, headers: { 'x-oauth-scopes': 'read:repository:bitbucket' } } }],
    lookup: { method: 'GET', url: `${BB}/pullrequests?q=`, reply: { body: { values: [] } } },
    create: { method: 'POST', url: `${BB}/pullrequests`, reply: { status: 201, body: { id: 7, links: { html: { href: 'https://bitbucket.org/acme/widgets/pull-requests/7' } } } } },
    pr: `${BB}/pullrequests/7`,
    readPr: (description) => ({ method: 'GET', url: `${BB}/pullrequests/7`, reply: { body: { id: 7, title: 'T', description } } }),
    write: 'PUT',
    written: (body) => (body as { description: string }).description,
    url: 'https://bitbucket.org/acme/widgets/pull-requests/7',
  },
  {
    host: 'github',
    skill: 'lantern-github',
    other: 'lantern-bitbucket',
    origin: 'git@github.com:acme/widgets.git',
    slug: { first: '--owner', repo: '--repo' },
    granted: { GITHUB_TOKEN: TOKEN },
    authorization: `Bearer ${TOKEN}`,
    scopes: [
      { method: 'GET', url: 'https://api.github.com/user', reply: { body: { login: 'ada' } } },
      { method: 'GET', url: GH, reply: { body: {} } },
    ],
    noScope: [{ method: 'GET', url: 'https://api.github.com/user', reply: { status: 401, body: {} } }],
    lookup: { method: 'GET', url: `${GH}/pulls?head=`, reply: { body: [] } },
    create: { method: 'POST', url: `${GH}/pulls`, reply: { status: 201, body: { number: 9, html_url: 'https://github.com/acme/widgets/pull/9' } } },
    pr: `${GH}/pulls/9`,
    readPr: (description) => ({ method: 'GET', url: `${GH}/pulls/9`, reply: { body: { number: 9, title: 'T', body: description } } }),
    write: 'PATCH',
    written: (body) => (body as { body: string }).body,
    url: 'https://github.com/acme/widgets/pull/9',
  },
];

let tmp: string;

beforeEach(() => {
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dl-host-')));
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

function git(cwd: string, ...args: string[]) {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const name of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE']) delete env[name];
  return execFileSync('git', ['-c', 'init.defaultBranch=main', '-c', 'commit.gpgsign=false', ...args], { cwd, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function makeRepo(name: string, remoteUrl: string, branches: string[] = ['main']) {
  const bare = path.join(tmp, `${name}.git`);
  const work = path.join(tmp, name);
  fs.mkdirSync(bare);
  fs.mkdirSync(work);
  git(bare, 'init', '-q', '--bare');
  git(work, 'init', '-q');
  git(work, 'config', 'user.name', 'Tester');
  git(work, 'config', 'user.email', 'tester@example.com');
  fs.writeFileSync(path.join(work, 'a.txt'), 'a\n');
  git(work, 'add', 'a.txt');
  git(work, 'commit', '-q', '-m', 'init');
  git(work, 'remote', 'add', 'origin', remoteUrl);
  const fakeSsh = path.join(tmp, `${name}-ssh.sh`);
  fs.writeFileSync(fakeSsh, `#!/bin/sh\ncase "$2" in\n  git-receive-pack*) exec git-receive-pack '${bare}' ;;\n  *) exec git-upload-pack '${bare}' ;;\nesac\n`, { mode: 0o755 });
  git(work, 'config', 'core.sshCommand', fakeSsh);
  for (const branch of branches) git(work, 'push', '-q', 'origin', `HEAD:refs/heads/${branch}`);
  return { work, bare };
}

function skillsIn(root: string, names: string[]) {
  for (const name of names) {
    const dir = path.join(root, '.claude', 'skills', name);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'SKILL.md'), `# ${name}\n`);
  }
}

function skillLinker() {
  const dir = path.join(tmp, 'linker');
  fs.mkdirSync(path.join(dir, 'core'), { recursive: true });
  const file = path.join(dir, 'skill-linker');
  fs.writeFileSync(file, '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  return file;
}

function offlineSsh() {
  const dir = path.join(tmp, 'bin');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'ssh');
  fs.writeFileSync(file, '#!/bin/sh\nfor last; do :; done\nfor arg in "$@"; do\n  if [ "$arg" = "-G" ]; then echo "hostname $last"; exit 0; fi\ndone\necho "Hi ada! You have successfully authenticated." >&2\nexit 1\n', { mode: 0o755 });
  return dir;
}

function cleanEnv(extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, HOME: path.join(tmp, 'home'), PATH: `${offlineSsh()}${path.delimiter}${process.env.PATH}`, SKILL_LINKER: skillLinker() };
  for (const name of ['BITBUCKET_EMAIL', 'BITBUCKET_API_TOKEN', 'GITHUB_TOKEN', 'LANTERN_CREDENTIAL_SOURCE', 'LANTERN_CREDENTIAL_PROVIDERS', 'LANTERN_CREDENTIAL_SOCKET', 'LANTERN_PROFILE', 'GIT_COMMIT_NAME', 'GIT_COMMIT_EMAIL', 'GIT_CONFIG_GLOBAL', 'GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'NODE_OPTIONS']) delete env[name];
  return { ...env, ...extra };
}

async function node(script: string, args: string[], cwd: string, env: NodeJS.ProcessEnv) {
  try {
    const { stdout, stderr } = await run(process.execPath, [script, ...args], { cwd, env });
    return { code: 0, out: `${stdout}${stderr}`, stdout, stderr };
  } catch (error) {
    const failed = error as { code: number; stdout: string; stderr: string };
    return { code: failed.code, out: `${failed.stdout}${failed.stderr}`, stdout: failed.stdout, stderr: failed.stderr };
  }
}

const line = (out: string, prefix: string) => out.split('\n').find((candidate) => candidate.startsWith(prefix));

describe('finding and running the host skill', () => {
  it('names one skill and one script per host, and the skill names are the bundled ones', () => {
    expect(HOST_SKILLS.sort()).toEqual(['lantern-bitbucket', 'lantern-github']);
    for (const skill of HOST_SKILLS) expect(BUNDLED).toContain(skill);
  });

  it('looks beside the delegate skill first, then in the project .claude/skills and .agents/skills and the home ones', () => {
    const roots = skillRoots({ cwd: '/work/project', home: '/home/me' });
    expect(roots[0]).toBe(SKILLS);
    expect(roots.slice(1)).toEqual(['/work/project/.claude/skills', '/work/project/.agents/skills', '/home/me/.claude/skills', '/home/me/.agents/skills']);
  });

  it.each([['.claude'], ['.agents']])('finds the script in a project %s/skills folder', (folder) => {
    const script = path.join(tmp, folder, 'skills', 'lantern-github', 'scripts', 'github.mjs');
    fs.mkdirSync(path.dirname(script), { recursive: true });
    fs.writeFileSync(script, 'console.log("hi");\n');
    const roots = skillRoots({ cwd: tmp, home: path.join(tmp, 'none') }).slice(1);
    expect(hostScript('github', roots)).toBe(script);
    expect(runHostSkill('github', [], { cwd: tmp, roots })).toMatchObject({ status: 0, stdout: 'hi\n' });
  });

  it('says which skill is missing and where it looked, with exit 1, instead of throwing', () => {
    const result = runHostSkill('bitbucket', ['check'], { cwd: tmp, roots: [path.join(tmp, 'empty')] });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('lantern-bitbucket is not installed');
    expect(result.stderr).toContain(path.join(tmp, 'empty'));
  });
});

describe.each(CASES)('preflight with the $host host skill', (c) => {
  const session = () => path.join(tmp, 'session');
  const env = (extra: NodeJS.ProcessEnv = {}) => cleanEnv(extra);

  function registry(missing: string[] = []) {
    const names = [...BUNDLED.filter((name) => !HOST_SKILLS.includes(name)), c.skill, ...ORCHESTRATOR].filter((name) => !missing.includes(name));
    fs.mkdirSync(session(), { recursive: true });
    skillsIn(session(), names);
  }

  it('requires the host skill in the registry and names the installer when it is missing', async () => {
    registry([c.skill]);
    const { work } = makeRepo('r', c.origin);
    const res = await node(PREFLIGHT, ['--target', 'main', '--repo-dir', work, '--no-api'], session(), env(c.granted));
    expect(res.code).toBe(1);
    expect(line(res.out, 'FAIL skills')).toContain(`not in the registry the delegate inherits: ${c.skill}.`);
    expect(line(res.out, 'FAIL skills')).toContain('pnpm run install-skills');
  });

  it('does not require the skill of the other host', async () => {
    registry();
    const { work } = makeRepo('r', c.origin);
    const res = await node(PREFLIGHT, ['--target', 'main', '--repo-dir', work, '--no-api'], session(), env(c.granted));
    expect(line(res.out, 'ok   skills')).toBeDefined();
    expect(line(res.out, 'ok   skills')).toContain(`host: ${c.skill}`);
    expect(line(res.out, 'ok   skills')).not.toContain(c.other);
  });

  it('prints the host skill for the brief', async () => {
    registry();
    const { work } = makeRepo('r', c.origin);
    const res = await node(PREFLIGHT, ['--target', 'main', '--repo-dir', work, '--no-api'], session(), env(c.granted));
    expect(line(res.out, 'ok   host-skill')).toContain(`Put it in the brief as: Host skill: ${c.skill}`);
  });

  it('passes local mode without any host skill in the registry', async () => {
    registry([c.skill]);
    skillsIn(session(), []);
    const work = path.join(tmp, 'local');
    fs.mkdirSync(work);
    git(work, 'init', '-q');
    git(work, 'config', 'user.name', 'Tester');
    git(work, 'config', 'user.email', 'tester@example.com');
    fs.writeFileSync(path.join(work, 'a.txt'), 'a\n');
    git(work, 'add', 'a.txt');
    git(work, 'commit', '-q', '-m', 'init');
    const res = await node(PREFLIGHT, ['--target', 'main', '--repo-dir', work, '--no-api'], session(), env());
    expect(line(res.out, 'ok   host')).toContain('local mode');
    expect(line(res.out, 'ok   skills')).toBeDefined();
    expect(line(res.out, 'FAIL skills')).toBeUndefined();
    expect(line(res.out, 'ok   host-skill')).toBeUndefined();
  });

  it('fails with the clear message from the skill when no credential resolves, naming the reason Lantern gave', async () => {
    registry();
    const { work } = makeRepo('r', c.origin);
    const res = await node(PREFLIGHT, ['--target', 'main', '--repo-dir', work, '--no-api'], session(), env());
    expect(res.code).toBe(1);
    expect(line(res.out, 'FAIL credentials')).toMatch(/^FAIL credentials: Missing (BITBUCKET_EMAIL, BITBUCKET_API_TOKEN|GITHUB_TOKEN)\./);
    expect(line(res.out, 'FAIL credentials')).toContain('Lantern is not running or does not answer; start it.');
  });

  it('takes the credentials from the running Lantern when the environment has none, and says so without printing them', async () => {
    registry();
    const { work } = makeRepo('r', c.origin);
    const socket = path.join(shortFolder('dlh-'), 'l.sock');
    const lantern = await startFakeLantern(socket, { ok: true, env: c.granted });
    const res = await node(PREFLIGHT, ['--target', 'main', '--repo-dir', work, '--no-api'], session(), env({ LANTERN_CREDENTIAL_SOCKET: socket }));
    expect(line(res.out, 'ok   credentials')).toContain('(from the Lantern credential socket');
    expect(lantern.requests).toHaveLength(2);
    for (const request of lantern.requests) expect(request).toMatchObject({ project: work, provider: c.host });
    expect(res.out).not.toContain(TOKEN);
  });

  it('asks the host through the skill what the token can do: scope granted, or a refusal that stops the dispatch', async () => {
    registry();
    const { work } = makeRepo('r', c.origin);
    const good = createRouter(c.scopes);
    const goodHost = await startFakeHost(good);
    const options = { LANTERN_TEST_HOST: goodHost.origin, NODE_OPTIONS: `--import ${REDIRECT}` };
    const ok = await node(PREFLIGHT, ['--target', 'main', '--repo-dir', work], session(), env({ ...c.granted, ...options }));
    await goodHost.close();
    expect(line(ok.out, 'ok   credentials')).toContain('resolve');
    expect(line(ok.out, c.host === 'bitbucket' ? 'ok   scope' : 'ok   repo')).toBeDefined();
    for (const call of good.calls) expect(call.headers.authorization).toBe(c.authorization);
    const bad = createRouter(c.noScope);
    const badHost = await startFakeHost(bad);
    const refused = await node(PREFLIGHT, ['--target', 'main', '--repo-dir', work], session(), env({ ...c.granted, LANTERN_TEST_HOST: badHost.origin, NODE_OPTIONS: `--import ${REDIRECT}` }));
    await badHost.close();
    expect(refused.code).toBe(1);
    expect(line(refused.out, 'FAIL credentials')).toMatch(c.host === 'bitbucket' ? /no write:pullrequest/ : /\(401\)/);
    expect(refused.out).not.toContain(TOKEN);
  });
});

describe.each(CASES)('preflight --delivery with the $host remote', (c) => {
  const session = () => path.join(tmp, 'session');

  function registry() {
    fs.mkdirSync(session(), { recursive: true });
    skillsIn(session(), [...BUNDLED.filter((name) => !HOST_SKILLS.includes(name)), ...ORCHESTRATOR]);
  }

  it('push needs no host skill and no account: nothing is opened', async () => {
    registry();
    const { work } = makeRepo('r', c.origin);
    const res = await node(PREFLIGHT, ['--target', 'main', '--repo-dir', work, '--no-api', '--delivery', 'push'], session(), cleanEnv());
    expect(line(res.out, 'FAIL credentials')).toBeUndefined();
    expect(line(res.out, 'note credentials')).toContain('not needed for Delivery push');
    expect(line(res.out, 'ok   target')).toContain('exists on origin');
    expect(line(res.out, 'FAIL skills')).toBeUndefined();
    expect(line(res.out, 'ok   host-skill')).toBeUndefined();
  });

  it('pr still needs both, and the default is pr', async () => {
    registry();
    const { work } = makeRepo('r', c.origin);
    const explicit = await node(PREFLIGHT, ['--target', 'main', '--repo-dir', work, '--no-api', '--delivery', 'pr'], session(), cleanEnv());
    const implicit = await node(PREFLIGHT, ['--target', 'main', '--repo-dir', work, '--no-api'], session(), cleanEnv());
    for (const res of [explicit, implicit]) {
      expect(line(res.out, 'FAIL credentials')).toContain('Missing');
      expect(line(res.out, 'FAIL skills')).toContain(c.skill);
    }
  });

  it('local checks like local mode: no host, credentials or remote target', async () => {
    registry();
    const { work } = makeRepo('r', c.origin);
    const res = await node(PREFLIGHT, ['--target', 'main', '--repo-dir', work, '--no-api', '--delivery', 'local'], session(), cleanEnv());
    expect(line(res.out, 'ok   target')).toContain('resolves locally');
    expect(line(res.out, 'ok   publication')).toBeDefined();
    expect(res.out).not.toMatch(/FAIL (host|credentials|scope|repo)|ok {3}host-skill/);
  });

  it('refuses a delivery that is none of the three, with exit 2', async () => {
    registry();
    const { work } = makeRepo('r', c.origin);
    const res = await node(PREFLIGHT, ['--target', 'main', '--repo-dir', work, '--delivery', 'sometimes'], session(), cleanEnv());
    expect(res.code).toBe(2);
    expect(res.out).toContain('Unsupported --delivery sometimes; expected one of: pr, push, local.');
  });
});

describe.each(CASES)('pr-create through the $host host skill, with no credential in the environment', (c) => {
  async function open(extra: string[] = [], options: { socket?: boolean; env?: NodeJS.ProcessEnv; routes?: Route[] } = {}) {
    const { work, bare } = makeRepo('r', c.origin);
    git(work, 'checkout', '-q', '-b', 'worktree-agent-1');
    fs.writeFileSync(path.join(work, 'b.txt'), 'b\n');
    git(work, 'add', 'b.txt');
    git(work, 'commit', '-q', '-m', 'work');
    fs.writeFileSync(path.join(tmp, 'body.md'), 'Why it matters');
    const router = createRouter(options.routes ?? [c.lookup, c.create, ...c.scopes]);
    const host = await startFakeHost(router);
    const socketPath = path.join(shortFolder('dlh-'), 'l.sock');
    const lantern = await startFakeLantern(socketPath, { ok: true, env: c.granted });
    const env = cleanEnv({ LANTERN_TEST_HOST: host.origin, NODE_OPTIONS: `--import ${REDIRECT}`, ...(options.socket === false ? {} : { LANTERN_CREDENTIAL_SOCKET: socketPath }), ...options.env });
    const args = [c.slug.first, 'acme', c.slug.repo, 'widgets', '--target', 'main', '--branch', 'feat/delegate-x', '--title', 'Add the thing', '--body-file', path.join(tmp, 'body.md'), ...extra];
    const res = await node(PR_CREATE, args, work, env);
    await host.close();
    return { res, router, lantern, work, bare };
  }

  it('pushes the branch under its real name and opens the pull request with the account Lantern holds', async () => {
    const { res, router, lantern, work, bare } = await open();
    expect(res.code, res.out).toBe(0);
    expect(res.stdout.trim().split('\n').at(-1)).toBe(c.url);
    expect(git(bare, 'branch', '--list', 'feat/delegate-x')).toContain('feat/delegate-x');
    expect(git(bare, 'branch', '--list', 'worktree-agent-1')).toBe('');
    const posts = router.calls.filter((call) => call.method === 'POST');
    expect(posts).toHaveLength(1);
    for (const call of router.calls) expect(call.headers.authorization).toBe(c.authorization);
    expect(lantern.requests.length).toBeGreaterThan(0);
    expect(lantern.requests[0]).toMatchObject({ project: work, provider: c.host });
    expect(res.out).not.toContain(TOKEN);
  });

  it('opens nothing and pushes nothing when the account cannot be resolved', async () => {
    const { res, router, bare } = await open([], { socket: false });
    expect(res.code).toBe(1);
    expect(res.stderr).toContain('Missing');
    expect(router.calls.filter((call) => call.method === 'POST')).toEqual([]);
    expect(git(bare, 'branch', '--list', 'feat/delegate-x')).toBe('');
  });

  it('refuses a branch that is not a conventional name before anything leaves the machine', async () => {
    const { res, router, bare } = await open(['--branch', 'main']);
    expect(res.code).toBe(1);
    expect(res.stderr).toContain('is not a conventional name');
    expect(router.calls).toEqual([]);
    expect(git(bare, 'branch', '--list', 'worktree-agent-1')).toBe('');
  });

  it('refuses a commit identity that contradicts the declared profile, pushing nothing', async () => {
    const { res, router, bare } = await open([], { env: { GIT_COMMIT_NAME: 'Someone Else', GIT_COMMIT_EMAIL: 'else@example.com' } });
    expect(res.code).toBe(1);
    expect(res.stderr).toContain('Identity mismatch');
    expect(router.calls.filter((call) => call.method === 'POST')).toEqual([]);
    expect(git(bare, 'branch', '--list', 'feat/delegate-x')).toBe('');
  });

  it('prints the plan and sends nothing with --dry-run', async () => {
    const { res, router, bare } = await open(['--dry-run']);
    expect(res.code, res.out).toBe(0);
    expect(res.stdout).toContain('Dry run, nothing pushed or sent.');
    expect(router.calls.filter((call) => call.method === 'POST')).toEqual([]);
    expect(git(bare, 'branch', '--list', 'feat/delegate-x')).toBe('');
  });
});

describe.each(CASES)('pr-append-cost through the $host host skill', (c) => {
  async function append(description: string) {
    const { work } = makeRepo('r', c.origin);
    const table = path.join(tmp, 'cost.md');
    fs.writeFileSync(table, '| agent | cost |\n|---|---|\n| run | $1.23 |\n');
    const router = createRouter([c.readPr(description), { method: c.write, url: c.pr, reply: { body: {} } }]);
    const host = await startFakeHost(router);
    const socketPath = path.join(shortFolder('dlh-'), 'l.sock');
    await startFakeLantern(socketPath, { ok: true, env: c.granted });
    const env = cleanEnv({ LANTERN_TEST_HOST: host.origin, NODE_OPTIONS: `--import ${REDIRECT}`, LANTERN_CREDENTIAL_SOCKET: socketPath });
    const res = await node(PR_APPEND_COST, ['--pr', c.pr.split('/').at(-1) as string, '--table-file', table], work, env);
    await host.close();
    return { res, router };
  }

  const block = (text: string) => `<!-- delegate:cost -->\n\n## Run cost\n\n${text}\n\n<!-- /delegate:cost -->`;

  it('appends the table to a description that has none and prints what the skill printed', async () => {
    const { res, router } = await append('## What this changes\nx\n');
    expect(res.code, res.out).toBe(0);
    expect(res.stdout).toContain('Wrote the delegate:cost block');
    const written = c.written(router.calls.find((call) => call.method === c.write)?.body);
    expect(written).toBe(`## What this changes\nx\n\n${block('| agent | cost |\n|---|---|\n| run | $1.23 |')}\n`);
  });

  it('replaces the placeholder the delegate left in the body instead of stacking a second table', async () => {
    const { router } = await append(`intro\n\n${block('| agent | context |\n|---|---|\n| this run | pending |')}\n`);
    const written = c.written(router.calls.find((call) => call.method === c.write)?.body);
    expect(written).not.toContain('pending');
    expect(written.match(/<!-- delegate:cost -->/g)).toHaveLength(1);
  });

  it('needs the pull request and the table', () => {
    const res = spawnSync(process.execPath, [PR_APPEND_COST, '--pr', '7'], { cwd: tmp, encoding: 'utf8', env: cleanEnv() });
    expect(res.status).toBe(1);
    expect(res.stderr).toContain('Missing --table-file');
  });
});

describe('what lantern-delegate no longer carries', () => {
  it('reads no token variable and calls no host API itself', () => {
    const files = fs.readdirSync(SCRIPTS, { recursive: true }).map(String).filter((file) => file.endsWith('.mjs'));
    for (const file of files) {
      const text = fs.readFileSync(path.join(SCRIPTS, file), 'utf8');
      expect(text, file).not.toMatch(/BITBUCKET_API_TOKEN|BITBUCKET_EMAIL|process\.env\.GITHUB_TOKEN|api\.bitbucket\.org|api\.github\.com|x-oauth-scopes/);
    }
  });
});
