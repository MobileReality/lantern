import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
// @ts-expect-error plain ES module, no declarations
import { BUNDLE_SKILLS } from '../scripts/lantern-bundle.mjs';
// @ts-expect-error plain ES module, no declarations
import { COST_BLOCK_NAME, costContent } from '../skills/lantern-delegate/scripts/cost-block.mjs';
// @ts-expect-error plain ES module, no declarations
import { classifyRemote, listRemotes, pickRemote } from '../skills/lantern-delegate/scripts/host.mjs';
// @ts-expect-error plain ES module, no declarations
import { covers, ruleMatches, settingsSnippet } from '../skills/lantern-delegate/scripts/permissions.mjs';
// @ts-expect-error plain ES module, no declarations
import { chooseHost } from '../skills/lantern-delegate/scripts/pr-create.mjs';

vi.setConfig({ testTimeout: 30_000 });

const SCRIPTS = path.join(__dirname, '..', 'skills', 'lantern-delegate', 'scripts');
const PREFLIGHT = path.join(SCRIPTS, 'preflight.mjs');
const DISPATCHER = path.join(SCRIPTS, 'pr-create.mjs');
const INIT_LOCAL = path.join(SCRIPTS, 'init-local.mjs');
const REMOTE_URL = 'git@bitbucket.org:acme/widgets.git';
const PLANNING = ['lantern-plan', 'lantern-plan-impact', 'lantern-plan-stages', 'lantern-plan-review', 'lantern-plan-handoff'];
const ALWAYS = BUNDLE_SKILLS.map((s: { name: string }) => s.name).filter((name: string) => !PLANNING.includes(name));

let tmp: string;
let linkerStub: string;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lantern-delegate-'));
  linkerStub = makeSkillLinker(path.join(tmp, 'linker-default'));
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

function git(cwd: string, ...args: string[]) {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const name of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE']) delete env[name];
  return execFileSync('git', ['-c', 'init.defaultBranch=main', '-c', 'commit.gpgsign=false', ...args], { cwd, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

interface RepoOptions {
  name: string;
  branches: string[];
  remoteUrl?: string;
  rewrite?: boolean;
}

function makeRepo({ name, branches, remoteUrl = REMOTE_URL, rewrite = false }: RepoOptions) {
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
  if (rewrite) {
    git(work, 'config', `url.${bare}.insteadOf`, remoteUrl);
  } else {
    const fakeSsh = path.join(tmp, `${name}-ssh.sh`);
    fs.writeFileSync(fakeSsh, `#!/bin/sh\ncase "$2" in\n  git-receive-pack*) exec git-receive-pack '${bare}' ;;\n  *) exec git-upload-pack '${bare}' ;;\nesac\n`, { mode: 0o755 });
    git(work, 'config', 'core.sshCommand', fakeSsh);
  }
  for (const branch of branches) git(work, 'push', '-q', 'origin', `HEAD:refs/heads/${branch}`);
  return work;
}

function skills(root: string, names: string[], provider: 'claude' | 'codex' = 'claude') {
  for (const name of names) {
    const dir = provider === 'codex' ? path.join(root, '.agents', 'skills', name) : path.join(root, '.claude', 'skills', name);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'SKILL.md'), `# ${name}\n`);
  }
}

function makeSkillLinker(dir: string, { core = true, mode = 0o755 } = {}) {
  fs.mkdirSync(dir, { recursive: true });
  if (core) fs.mkdirSync(path.join(dir, 'core'), { recursive: true });
  const file = path.join(dir, 'skill-linker');
  fs.writeFileSync(file, '#!/bin/sh\nexit 0\n', { mode });
  fs.chmodSync(file, mode);
  return file;
}

function pathWithoutSkillLinker() {
  return (process.env.PATH ?? '').split(path.delimiter).filter((dir) => dir && !fs.existsSync(path.join(dir, 'skill-linker'))).join(path.delimiter);
}

function sessionEnv(home: string, extra: NodeJS.ProcessEnv = {}) {
  const env: NodeJS.ProcessEnv = { ...process.env, HOME: home, PATH: pathWithoutSkillLinker(), SKILL_LINKER: linkerStub };
  delete env.SKILLS_REPO;
  for (const name of ['BITBUCKET_EMAIL', 'BITBUCKET_API_TOKEN', 'GITHUB_TOKEN', 'LANTERN_CREDENTIAL_SOURCE', 'LANTERN_CREDENTIAL_PROVIDERS', 'LANTERN_CREDENTIAL_SOCKET', 'LANTERN_PROFILE', 'GIT_COMMIT_NAME', 'GIT_COMMIT_EMAIL', 'GIT_CONFIG_GLOBAL', 'GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE']) delete env[name];
  return { ...env, ...extra };
}

function preflight(cwd: string, args: string[], env: NodeJS.ProcessEnv) {
  const res = spawnSync(process.execPath, [PREFLIGHT, ...args], { cwd, env, encoding: 'utf8' });
  return { code: res.status, out: `${res.stdout}${res.stderr}` };
}

function allowDelegate(session: string, home: string, skillLinker: string = linkerStub) {
  const skillRoots = [path.join(fs.realpathSync(session), '.claude', 'skills'), path.join(home, '.claude', 'skills')];
  fs.mkdirSync(path.join(session, '.claude'), { recursive: true });
  fs.writeFileSync(path.join(session, '.claude', 'settings.local.json'), settingsSnippet({ skillRoots, skillLinker }));
}

function writeExtensions(home: string, config: object) {
  fs.mkdirSync(path.join(home, '.claude'), { recursive: true });
  fs.writeFileSync(path.join(home, '.claude', 'lantern-extensions.json'), JSON.stringify(config));
}

function line(out: string, prefix: string) {
  return out.split('\n').find((l) => l.startsWith(prefix));
}

describe('preflight --repo-dir', () => {
  it('finds a target branch in another repo than the one the session runs in', () => {
    const session = makeRepo({ name: 'session', branches: ['main'] });
    const other = makeRepo({ name: 'other', branches: ['main', 'feat/stacked'] });
    const home = path.join(tmp, 'home');
    fs.mkdirSync(home);

    const here = preflight(session, ['--target', 'feat/stacked', '--no-api'], sessionEnv(home));
    expect(line(here.out, 'FAIL target')).toMatch(/no branch "feat\/stacked"/);

    const there = preflight(session, ['--target', 'feat/stacked', '--repo-dir', other, '--no-api'], sessionEnv(home));
    expect(line(there.out, 'ok   target')).toContain(`feat/stacked exists on origin of ${other}`);
    expect(line(there.out, 'FAIL target')).toBeUndefined();
  });

  it('fails a target the other repo does not have, and names the repo', () => {
    const session = makeRepo({ name: 'session', branches: ['main', 'nope/nope'] });
    const other = makeRepo({ name: 'other', branches: ['main'] });
    const home = path.join(tmp, 'home');
    fs.mkdirSync(home);

    const res = preflight(session, ['--target', 'nope/nope', '--repo-dir', other, '--no-api'], sessionEnv(home));
    expect(res.code).toBe(1);
    expect(line(res.out, 'FAIL target')).toContain(`of ${other} has no branch "nope/nope"`);
  });

  it('matches the target exactly, not as a suffix of another branch', () => {
    const repo = makeRepo({ name: 'repo', branches: ['main', 'team/feat/x'] });
    const home = path.join(tmp, 'home');
    fs.mkdirSync(home);
    const res = preflight(repo, ['--target', 'feat/x', '--no-api'], sessionEnv(home));
    expect(line(res.out, 'FAIL target')).toBeDefined();
  });

  it('rejects a repo-dir that is not a directory', () => {
    const res = preflight(tmp, ['--target', 'main', '--repo-dir', path.join(tmp, 'missing'), '--no-api'], sessionEnv(tmp));
    expect(res.code).toBe(2);
    expect(res.out).toMatch(/is not a directory/);
  });

  it('fails the host check for a remote on another host', () => {
    const repo = makeRepo({ name: 'repo', branches: ['main'], remoteUrl: 'git@example.com:acme/widgets.git' });
    const res = preflight(repo, ['--target', 'main', '--no-api'], sessionEnv(tmp));
    expect(line(res.out, 'FAIL host')).toMatch(/neither bitbucket.org nor github.com/);
  });

  it('picks a bitbucket origin that nothing rewrites', () => {
    const repo = makeRepo({ name: 'repo', branches: ['main'], remoteUrl: 'git@bitbucket.org:ws/repo.git' });
    const res = preflight(repo, ['--target', 'main', '--no-api'], sessionEnv(tmp));
    expect(line(res.out, 'ok   host')).toContain('bitbucket (from remote origin: git@bitbucket.org:ws/repo.git)');
  });

  it('rejects an origin that insteadOf rewrites to a local path, naming both URLs', () => {
    const repo = makeRepo({ name: 'repo', branches: ['main'], remoteUrl: 'git@bitbucket.org:ws/repo.git', rewrite: true });
    const res = preflight(repo, ['--target', 'main', '--no-api'], sessionEnv(tmp));
    expect(res.code).toBe(1);
    const failure = line(res.out, 'FAIL host');
    expect(failure).toContain('git@bitbucket.org:ws/repo.git');
    expect(failure).toContain(`${tmp}/repo.git`);
    expect(failure).toMatch(/host is unknown/);
  });

  it('needs --target', () => {
    const res = preflight(tmp, [], sessionEnv(tmp));
    expect(res.code).toBe(2);
    expect(res.out).toMatch(/Missing --target/);
  });
});

describe('preflight credentials', () => {
  const BITBUCKET = { BITBUCKET_EMAIL: 'a@example.com', BITBUCKET_API_TOKEN: 'bb-secret-value' };
  const GITHUB = { GITHUB_TOKEN: 'gh-secret-value' };
  const BITBUCKET_URL = 'git@bitbucket.org:acme/widgets.git';
  const GITHUB_URL = 'git@github.com:acme/widgets.git';
  const noHome = () => path.join(tmp, 'nohome');
  let made = 0;
  const check = (remoteUrl: string, env: NodeJS.ProcessEnv, fileKeys?: string) => {
    made += 1;
    const repo = makeRepo({ name: `source-${made}`, branches: ['main'], remoteUrl });
    if (fileKeys) {
      fs.mkdirSync(path.join(repo, '.ai'));
      fs.writeFileSync(path.join(repo, '.ai', '.env'), fileKeys);
    }
    return preflight(repo, ['--target', 'main', '--no-api'], sessionEnv(noHome(), env));
  };

  it('reports absent Bitbucket credentials with the reason Lantern gave, and does not call the API for the scope', () => {
    const res = check(BITBUCKET_URL, {});
    expect(res.code).toBe(1);
    expect(line(res.out, 'FAIL credentials')).toMatch(/Missing BITBUCKET_EMAIL, BITBUCKET_API_TOKEN\./);
    expect(line(res.out, 'FAIL credentials')).toContain('Lantern is not running or does not answer; start it.');
    expect(line(res.out, 'ok   scope')).toBeUndefined();
  });

  it('accepts credentials from the environment and skips the scope call under --no-api', () => {
    const res = check(BITBUCKET_URL, { BITBUCKET_EMAIL: 'a@example.com', BITBUCKET_API_TOKEN: 'secret' });
    expect(line(res.out, 'ok   credentials')).toMatch(/resolve/);
    expect(line(res.out, 'ok   scope')).toMatch(/skipped \(--no-api\)/);
  });

  it.each([
    [BITBUCKET_URL, 'BITBUCKET_EMAIL=a@example.com\nBITBUCKET_API_TOKEN=bb-file-value\n'],
    [GITHUB_URL, 'GITHUB_TOKEN=gh-file-value\n'],
  ])('does not read a token from .ai/.env any more (%s)', (remoteUrl, keys) => {
    const res = check(remoteUrl, {}, keys);
    expect(line(res.out, 'FAIL credentials')).toMatch(/Missing/);
    expect(line(res.out, 'ok   credentials')).toBeUndefined();
    expect(res.out).not.toMatch(/bb-file-value|gh-file-value/);
  });

  describe('says where the credential came from, never its value', () => {
    it('names the environment for variables the shell exported', () => {
      expect(line(check(BITBUCKET_URL, BITBUCKET).out, 'ok   credentials')).toContain('(from environment)');
      expect(line(check(GITHUB_URL, GITHUB).out, 'ok   credentials')).toContain('from environment');
    });

    it('names Lantern when the app marked the run, for the providers it filled', () => {
      const marked = { LANTERN_CREDENTIAL_SOURCE: 'lantern' };
      expect(line(check(BITBUCKET_URL, { ...BITBUCKET, ...marked }).out, 'ok   credentials')).toContain('(from Lantern)');
      expect(line(check(GITHUB_URL, { ...GITHUB, ...marked, LANTERN_CREDENTIAL_PROVIDERS: 'github,jira' }).out, 'ok   credentials')).toContain('from Lantern');
    });

    it('does not credit Lantern for a provider it did not fill, nor without the marker', () => {
      const providers = { LANTERN_CREDENTIAL_SOURCE: 'lantern', LANTERN_CREDENTIAL_PROVIDERS: 'github' };
      expect(line(check(BITBUCKET_URL, { ...BITBUCKET, ...providers }).out, 'ok   credentials')).toContain('(from environment)');
      expect(line(check(BITBUCKET_URL, { ...BITBUCKET, LANTERN_CREDENTIAL_PROVIDERS: 'bitbucket' }).out, 'ok   credentials')).toContain('(from environment)');
      expect(line(check(BITBUCKET_URL, { ...BITBUCKET, LANTERN_CREDENTIAL_SOURCE: 'other' }).out, 'ok   credentials')).toContain('(from environment)');
    });

    it('never prints a token or an email', () => {
      const res = check(BITBUCKET_URL, { ...BITBUCKET, LANTERN_CREDENTIAL_SOURCE: 'lantern' });
      const gh = check(GITHUB_URL, GITHUB);
      for (const out of [res.out, gh.out]) expect(out).not.toMatch(/bb-secret-value|gh-secret-value|a@example\.com/);
    });
  });

  it.each([[BITBUCKET_URL], [GITHUB_URL]])('points a missing credential at Lantern Integrations, not at a file (%s)', (remoteUrl) => {
    const res = check(remoteUrl, {});
    expect(line(res.out, 'FAIL credentials')).toMatch(/Lantern \(command palette, Integrations\)/);
    expect(line(res.out, 'FAIL credentials')).not.toMatch(/\.ai\/\.env/);
  });

  it('checks a GitHub remote for GITHUB_TOKEN', () => {
    const absent = check(GITHUB_URL, {});
    expect(line(absent.out, 'FAIL credentials')).toMatch(/Missing GITHUB_TOKEN/);
    const present = check(GITHUB_URL, { GITHUB_TOKEN: 'secret' });
    expect(line(present.out, 'ok   credentials')).toMatch(/GITHUB_TOKEN resolves/);
    expect(line(present.out, 'ok   host')).toMatch(/^ok {3}host: github/);
  });
});

const AUTHOR = { GIT_AUTHOR_NAME: 'Tester', GIT_AUTHOR_EMAIL: 'tester@example.com', GIT_COMMITTER_NAME: 'Tester', GIT_COMMITTER_EMAIL: 'tester@example.com' };

function initLocal(cwd: string, env: NodeJS.ProcessEnv) {
  const res = spawnSync(process.execPath, [INIT_LOCAL, cwd], { cwd, env, encoding: 'utf8' });
  return { code: res.status, out: `${res.stdout}${res.stderr}` };
}

function remotelessRepo(name: string) {
  const work = path.join(tmp, name);
  fs.mkdirSync(work);
  git(work, 'init', '-q');
  git(work, 'config', 'user.name', 'Tester');
  git(work, 'config', 'user.email', 'tester@example.com');
  fs.writeFileSync(path.join(work, 'a.txt'), 'a\n');
  git(work, 'add', 'a.txt');
  git(work, 'commit', '-q', '-m', 'init');
  return work;
}

describe('preflight local mode', () => {
  function home() {
    const dir = path.join(tmp, 'home');
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  }

  it('passes for a git repository with no remote, with no credentials and no remote target', () => {
    const repo = remotelessRepo('norem');
    const res = preflight(repo, ['--target', 'main', '--no-api'], sessionEnv(home()));
    expect(line(res.out, 'ok   host')).toMatch(/local mode: no remote/);
    expect(res.out).not.toMatch(/FAIL (host|credentials|scope|target|repo)/);
  });

  it('does not fail when the target branch exists nowhere', () => {
    const repo = remotelessRepo('notarget');
    const res = preflight(repo, ['--target', 'develop', '--no-api'], sessionEnv(home()));
    expect(line(res.out, 'WARN target')).toMatch(/no local branch "develop"/);
    expect(line(res.out, 'FAIL target')).toBeUndefined();
  });

  it('fails on a folder that is not a git repository, and does not touch it', () => {
    const dir = path.join(tmp, 'fresh');
    fs.mkdirSync(dir);
    const res = preflight(dir, ['--target', 'main', '--no-api'], sessionEnv(home()));
    expect(line(res.out, 'FAIL repo')).toMatch(/not a git repository.*--init/);
    expect(fs.existsSync(path.join(dir, '.git'))).toBe(false);
    expect(fs.existsSync(path.join(dir, '.gitignore'))).toBe(false);
  });

  it('with --init sets a non-git folder up, then passes in local mode', () => {
    const dir = path.join(tmp, 'fresh');
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, 'notes.txt'), 'hello\n');
    const res = preflight(dir, ['--target', 'main', '--init', '--no-api'], sessionEnv(home(), AUTHOR));
    expect(line(res.out, 'ok   repo')).toMatch(/Initialised a git repository on main/);
    expect(line(res.out, 'ok   host')).toMatch(/local mode/);
    expect(res.out).not.toMatch(/FAIL (host|credentials|scope|target|repo|commit)/);
    expect(git(dir, 'log', '--format=%s')).toBe('chore: initial commit');
    expect(git(dir, 'branch', '--show-current')).toBe('main');
    expect(git(dir, 'ls-files').split('\n').sort()).toEqual(['.gitignore', 'notes.txt']);
  });

  it('still requires credentials and the remote target branch when a remote exists', () => {
    const repo = makeRepo({ name: 'remote', branches: ['main'] });
    const res = preflight(repo, ['--target', 'main', '--no-api'], sessionEnv(home()));
    expect(res.code).toBe(1);
    expect(line(res.out, 'FAIL credentials')).toBeDefined();
    expect(line(res.out, 'ok   host')).not.toMatch(/local mode/);

    const credentials = { BITBUCKET_EMAIL: 'a@example.com', BITBUCKET_API_TOKEN: 'secret' };
    const missing = preflight(repo, ['--target', 'nope', '--no-api'], sessionEnv(home(), credentials));
    expect(line(missing.out, 'FAIL target')).toMatch(/has no branch "nope"/);
  });

  it('does not take local mode for a remote on an unknown host', () => {
    const repo = makeRepo({ name: 'other-host', branches: ['main'], remoteUrl: 'git@example.com:acme/widgets.git' });
    const res = preflight(repo, ['--target', 'main', '--no-api'], sessionEnv(home()));
    expect(line(res.out, 'FAIL host')).toMatch(/neither bitbucket.org nor github.com/);
  });
});

describe('init-local', () => {
  const env = () => sessionEnv(path.join(tmp, 'home'), AUTHOR);

  function fresh(name = 'fresh') {
    fs.mkdirSync(path.join(tmp, 'home'), { recursive: true });
    const dir = path.join(tmp, name);
    fs.mkdirSync(dir);
    return dir;
  }

  it('inits main with the minimal .gitignore, never listing .lantern/, in one commit', () => {
    const dir = fresh();
    fs.mkdirSync(path.join(dir, 'node_modules'));
    fs.writeFileSync(path.join(dir, 'node_modules', 'x.js'), '');
    fs.writeFileSync(path.join(dir, '.env'), 'SECRET=1\n');
    fs.mkdirSync(path.join(dir, '.lantern'));
    fs.writeFileSync(path.join(dir, '.lantern', 'map'), 'm\n');
    fs.writeFileSync(path.join(dir, 'index.js'), '1\n');
    expect(initLocal(dir, env()).code).toBe(0);
    const ignore = fs.readFileSync(path.join(dir, '.gitignore'), 'utf8').split('\n').filter(Boolean);
    expect(ignore).toEqual(['node_modules/', '.env', '.env.*', '.ai/.env', '.claude/', 'dist/', '.DS_Store']);
    expect(git(dir, 'rev-list', '--count', 'HEAD')).toBe('1');
    expect(git(dir, 'log', '--format=%s')).toBe('chore: initial commit');
    expect(git(dir, 'ls-files').split('\n').sort()).toEqual(['.gitignore', '.lantern/map', 'index.js']);
  });

  it('commits an empty folder and leaves an existing repository alone', () => {
    const dir = fresh();
    expect(initLocal(dir, env()).code).toBe(0);
    expect(git(dir, 'ls-files')).toBe('.gitignore');
    expect(initLocal(dir, env()).out).toMatch(/already a git repository/);
    expect(git(dir, 'rev-list', '--count', 'HEAD')).toBe('1');
  });

  it('adds only the missing lines to an existing .gitignore', () => {
    const dir = fresh();
    fs.writeFileSync(path.join(dir, '.gitignore'), 'dist/\ncustom.log');
    expect(initLocal(dir, env()).code).toBe(0);
    expect(fs.readFileSync(path.join(dir, '.gitignore'), 'utf8')).toBe('dist/\ncustom.log\nnode_modules/\n.env\n.env.*\n.ai/.env\n.claude/\n.DS_Store\n');
  });

  it('refuses the home directory', () => {
    const home = path.join(tmp, 'home');
    fs.mkdirSync(home, { recursive: true });
    const res = initLocal(home, env());
    expect(res.code).toBe(1);
    expect(res.out).toMatch(/home directory/);
    expect(fs.existsSync(path.join(home, '.git'))).toBe(false);
  });

  it('refuses more than 5000 files after ignoring, but not files that are ignored', () => {
    const dir = fresh();
    fs.mkdirSync(path.join(dir, 'node_modules'));
    for (let i = 0; i < 5100; i += 1) fs.writeFileSync(path.join(dir, 'node_modules', `f${i}.js`), '');
    for (let i = 0; i < 10; i += 1) fs.writeFileSync(path.join(dir, `s${i}.js`), '');
    expect(initLocal(dir, env()).code).toBe(0);

    const big = fresh('big');
    for (let i = 0; i < 5001; i += 1) fs.writeFileSync(path.join(big, `f${i}.txt`), '');
    const res = initLocal(big, env());
    expect(res.code).toBe(1);
    expect(res.out).toMatch(/5001 files after ignoring/);
    expect(fs.existsSync(path.join(big, '.git'))).toBe(false);
    expect(fs.existsSync(path.join(big, '.gitignore'))).toBe(false);
  });
});

describe('preflight skill registry', () => {
  function run(session: string, home: string, extra: string[] = []) {
    const repo = makeRepo({ name: `repo-${path.basename(session)}-${path.basename(home)}`, branches: ['main'] });
    return preflight(session, ['--target', 'main', '--repo-dir', repo, '--no-api', ...extra], sessionEnv(home));
  }

  function runAgain(session: string, home: string, extra: string[] = []) {
    return preflight(session, ['--target', 'main', '--repo-dir', path.join(tmp, `repo-${path.basename(session)}-${path.basename(home)}`), '--no-api', ...extra], sessionEnv(home));
  }

  function dirs() {
    const session = path.join(tmp, 'session');
    const home = path.join(tmp, 'home');
    fs.mkdirSync(session);
    fs.mkdirSync(home);
    return { session, home };
  }

  it('passes when the session project holds every skill', () => {
    const { session, home } = dirs();
    skills(session, ALWAYS);
    expect(line(run(session, home).out, 'ok   skills')).toMatch(new RegExp(`${ALWAYS.length - 1} resolve`));
  });

  it('looks in ~/.claude/skills as well as <cwd>/.claude/skills', () => {
    const { session, home } = dirs();
    skills(session, ALWAYS.slice(0, 4));
    skills(home, ALWAYS.slice(4));
    expect(line(run(session, home).out, 'ok   skills')).toBeDefined();
  });

  it('names what is missing and where it looked', () => {
    const { session, home } = dirs();
    skills(session, ALWAYS.filter((n) => n !== 'lantern-local-loop'));
    const res = run(session, home);
    const failed = line(res.out, 'FAIL skills') ?? '';
    expect(failed).toContain('not in the registry the delegate inherits: lantern-local-loop.');
    expect(failed).toContain(path.join(session, '.claude', 'skills'));
    expect(failed).toContain(path.join(home, '.claude', 'skills'));
  });

  it('does not look in the repo-dir or require the host PR skills', () => {
    const { session, home } = dirs();
    skills(session, ALWAYS);
    const repo = makeRepo({ name: 'repo-with-skills', branches: ['main'] });
    skills(repo, ['team-conventions']);
    const res = preflight(session, ['--target', 'main', '--repo-dir', repo, '--skills', 'team-conventions', '--no-api'], sessionEnv(home));
    expect(line(res.out, 'FAIL skills')).toContain('not in the registry the delegate inherits: team-conventions.');
    expect(res.out).not.toMatch(/bitbucket-pr|github-pr/);
  });

  it('adds the skills the brief names to the always-group', () => {
    const { session, home } = dirs();
    skills(session, [...ALWAYS, 'team-conventions', 'typescript']);
    const res = run(session, home, ['--skills', 'lantern-delegate,team-conventions,typescript']);
    expect(line(res.out, 'ok   skills')).toMatch(new RegExp(`${ALWAYS.length + 1} resolve.*this run: team-conventions, typescript`));
  });

  it('demands no extra skill with an empty or missing extensions config', () => {
    const { session, home } = dirs();
    skills(session, ALWAYS);
    const res = run(session, home);
    expect(line(res.out, 'ok   skills')).toBeDefined();
    expect(res.out).not.toContain('WARN extensions');
    writeExtensions(home, { delegate: [], orchestrator: [] });
    const again = runAgain(session, home);
    expect(line(again.out, 'ok   skills')).toBeDefined();
    expect(again.out).not.toContain('Extra skills:');
  });

  it('lists the delegate slot names that resolve as information, with no wording for the brief, and leaves out the ones that do not', () => {
    const { session, home } = dirs();
    skills(session, [...ALWAYS, 'alpha-skill']);
    writeExtensions(home, { delegate: ['alpha-skill', 'beta-skill'], orchestrator: [] });
    const res = run(session, home);
    expect(line(res.out, 'ok   extra-skills')).toContain('resolves: alpha-skill');
    expect(line(res.out, 'ok   extra-skills')).not.toContain('brief');
    expect(line(res.out, 'ok   extra-skills')).not.toContain('beta-skill');
    expect(res.out).toMatch(/WARN extensions: .*delegate extra "beta-skill" does not resolve/);
    expect(res.out).not.toContain('FAIL skills');
  });

  it('lists the reviewer slot names that resolve as information and warns about the ones that do not, never failing', () => {
    const { session, home } = dirs();
    skills(session, [...ALWAYS, 'alpha-skill']);
    writeExtensions(home, { reviewer: ['alpha-skill', 'beta-skill'] });
    const res = run(session, home);
    const lines = res.out.split('\n').filter((row) => row.includes('ok   extra-skills'));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('reviewer slot');
    expect(lines[0]).toContain('resolves: alpha-skill');
    expect(lines[0]).not.toContain('beta-skill');
    expect(res.out).toMatch(/WARN extensions: .*reviewer extra "beta-skill" does not resolve.*skipped/);
    expect(res.out).not.toContain('FAIL skills');
  });

  it('names the built-in skills switched off per role as information', () => {
    const { session, home } = dirs();
    skills(session, ALWAYS);
    writeExtensions(home, { off: { delegate: ['lantern-commit', 'lantern-local-loop'], reviewer: ['lantern-code-reviewer'] } });
    const res = run(session, home);
    const lines = res.out.split('\n').filter((row) => row.includes('ok   skills-off'));
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain('delegate slot');
    expect(lines[0]).toContain('switches off: lantern-commit, lantern-local-loop');
    expect(lines[1]).toContain('reviewer slot');
    expect(lines[1]).toContain('lantern-code-reviewer');
    expect(res.out).not.toContain('FAIL skills');
  });

  it('does not demand a built-in skill switched off for every role that lists it, though it is not installed', () => {
    const { session, home } = dirs();
    skills(session, ALWAYS.filter((n) => n !== 'lantern-commit'));
    writeExtensions(home, { off: { delegate: ['lantern-commit'] } });
    const res = run(session, home);
    expect(res.out).not.toContain('FAIL skills');
    expect(line(res.out, 'ok   skills:') ?? '').toMatch(/bundled: [^|]*lantern-local-loop/);
    expect(line(res.out, 'ok   skills:') ?? '').not.toContain('lantern-commit');
  });

  it('still demands a skill that is on and not installed beside one that is switched off', () => {
    const { session, home } = dirs();
    skills(session, ALWAYS.filter((n) => n !== 'lantern-commit' && n !== 'lantern-local-loop'));
    writeExtensions(home, { off: { delegate: ['lantern-commit'] } });
    const failed = line(run(session, home).out, 'FAIL skills') ?? '';
    expect(failed).toContain('not in the registry the delegate inherits: lantern-local-loop.');
    expect(failed).not.toContain('lantern-commit');
  });

  it('still demands a skill another role keeps on: lantern-no-comments off for the delegate only', () => {
    const { session, home } = dirs();
    skills(session, ALWAYS.filter((n) => n !== 'lantern-no-comments'));
    writeExtensions(home, { off: { delegate: ['lantern-no-comments'] } });
    expect(line(run(session, home).out, 'FAIL skills') ?? '').toContain('lantern-no-comments');
    writeExtensions(home, { off: { delegate: ['lantern-no-comments'], reviewer: ['lantern-no-comments'] } });
    expect(runAgain(session, home).out).not.toContain('FAIL skills');
  });

  it('prints no switched-off line by default and warns, naming the name, when the off list holds a locked one', () => {
    const { session, home } = dirs();
    skills(session, ALWAYS);
    expect(run(session, home).out).not.toContain('skills-off');
    writeExtensions(home, { off: { delegate: ['lantern-sync', 'lantern-commit'] } });
    const again = runAgain(session, home);
    expect(again.out).toMatch(/WARN extensions: .*cannot be switched off.*lantern-sync/);
    expect(line(again.out, 'ok   skills-off')).toContain('switches off: lantern-commit');
    expect(line(again.out, 'ok   skills-off')).not.toContain('lantern-sync');
  });

  it('requires a configured orchestrator extra that resolves and lists it', () => {
    const { session, home } = dirs();
    skills(session, ALWAYS);
    writeExtensions(home, { orchestrator: ['my-extra'] });
    const failed = line(run(session, home).out, 'FAIL skills') ?? '';
    expect(failed).toBe('');
    skills(home, ['my-extra']);
    const res = runAgain(session, home);
    expect(line(res.out, 'ok   skills')).toContain('orchestrator extras: my-extra');
    expect(line(res.out, 'ok   skills')).toMatch(new RegExp(`${ALWAYS.length} resolve`));
  });

  it('skips a configured extra that does not resolve with a warning naming it, never a failure', () => {
    const { session, home } = dirs();
    skills(session, ALWAYS);
    writeExtensions(home, { orchestrator: ['my-extra'], delegate: ['typescript'] });
    const res = run(session, home);
    expect(line(res.out, 'ok   skills')).toBeDefined();
    expect(res.out).toMatch(/WARN extensions: .*orchestrator extra "my-extra" does not resolve.*skipped/);
    expect(res.out).toMatch(/WARN extensions: .*delegate extra "typescript" does not resolve.*skipped/);
    expect(res.out).not.toContain('FAIL skills');
  });

  it('takes the config from --home instead of the real home', () => {
    const { session, home } = dirs();
    const other = path.join(tmp, 'other-home');
    skills(session, ALWAYS);
    writeExtensions(other, { orchestrator: ['second-extra'] });
    const res = run(session, home, ['--home', other]);
    expect(res.out).toMatch(/WARN extensions: .*"second-extra" does not resolve/);
  });

  it('adds the extras of the project file to the global ones, and warns about a missing one only in that project', () => {
    const { session, home } = dirs();
    skills(session, [...ALWAYS, 'global-skill', 'project-skill']);
    writeExtensions(home, { delegate: ['global-skill'] });
    run(session, home);
    const repo = path.join(tmp, 'repo-session-home');
    fs.mkdirSync(path.join(repo, '.claude'), { recursive: true });
    fs.writeFileSync(path.join(repo, '.claude', 'lantern-extensions.json'), JSON.stringify({ delegate: ['project-skill', 'project-missing'], reviewer: ['project-skill'] }));
    const res = runAgain(session, home);
    const lines = res.out.split('\n').filter((row) => row.includes('ok   extra-skills'));
    expect(lines.find((row) => row.includes('reviewer slot'))).toContain('resolves: project-skill');
    expect(lines.find((row) => !row.includes('reviewer slot'))).toContain('resolves: global-skill, project-skill');
    expect(res.out).toMatch(/WARN extensions: .*delegate extra "project-missing" does not resolve/);
    expect(res.out).not.toContain('FAIL skills');
    fs.rmSync(path.join(repo, '.claude', 'lantern-extensions.json'));
    const without = runAgain(session, home);
    expect(without.out).not.toContain('project-missing');
    expect(without.out).not.toContain('project-skill');
  });

  it('names a damaged project file as a warning and keeps the global extras', () => {
    const { session, home } = dirs();
    skills(session, [...ALWAYS, 'global-skill']);
    writeExtensions(home, { delegate: ['global-skill'] });
    run(session, home);
    const repo = path.join(tmp, 'repo-session-home');
    fs.mkdirSync(path.join(repo, '.claude'), { recursive: true });
    fs.writeFileSync(path.join(repo, '.claude', 'lantern-extensions.json'), '{ not json');
    const res = runAgain(session, home);
    expect(line(res.out, 'ok   extra-skills')).toContain('resolves: global-skill');
    expect(res.out).toMatch(/WARN extensions: The project extensions file is ignored.*global extras still apply/);
    expect(res.out).toContain(path.join('.claude', 'lantern-extensions.json'));
    expect(res.out).not.toContain('FAIL skills');
  });

  it('treats a damaged config as a warning and as empty, not a crash', () => {
    const { session, home } = dirs();
    skills(session, ALWAYS);
    fs.mkdirSync(path.join(home, '.claude'), { recursive: true });
    fs.writeFileSync(path.join(home, '.claude', 'lantern-extensions.json'), '{ not json');
    const res = run(session, home);
    expect(line(res.out, 'ok   skills')).toBeDefined();
    expect(res.out).toMatch(/WARN extensions: The extensions config is ignored and treated as empty/);
    expect(res.out).not.toContain('FAIL skills');
  });

  it('is green end to end with a declared credential, target and skills', () => {
    const { session, home } = dirs();
    skills(session, ALWAYS);
    const repo = makeRepo({ name: 'green', branches: ['main'] });
    const env = sessionEnv(home, { BITBUCKET_EMAIL: 'a@example.com', BITBUCKET_API_TOKEN: 'secret' });
    allowDelegate(session, home);
    const res = preflight(session, ['--target', 'main', '--repo-dir', repo, '--no-api'], env);
    expect(res.out).toMatch(/preflight green/);
    expect(res.code).toBe(0);
  });

  it('uses native Codex skill roots without Claude agents or publication credentials', () => {
    const { session, home } = dirs();
    skills(session, ['lantern-delegate', 'lantern-sync'], 'codex');
    const codexHome = path.join(home, 'custom-codex');
    skills(codexHome, ['lantern-setup']);
    fs.renameSync(path.join(codexHome, '.claude', 'skills'), path.join(codexHome, 'skills'));
    fs.rmSync(path.join(codexHome, '.claude'), { recursive: true });
    const repo = makeRepo({ name: 'codex-green', branches: ['main'] });
    const res = preflight(
      session,
      ['--target', 'main', '--repo-dir', repo, '--provider', 'codex', '--local-only'],
      sessionEnv(home, { CODEX_HOME: codexHome }),
    );
    expect(res.code).toBe(0);
    expect(line(res.out, 'ok   skills')).toMatch(/3 resolve/);
    expect(line(res.out, 'ok   publication')).toMatch(/local-only/);
    expect(res.out).not.toMatch(/Missing BITBUCKET/);
  });

  it('passes local-only preflight without a remote or network checks', () => {
    const { session, home } = dirs();
    skills(session, ['lantern-delegate', 'lantern-sync', 'lantern-setup'], 'codex');
    const repo = path.join(tmp, 'offline');
    fs.mkdirSync(repo);
    git(repo, 'init', '-q');
    git(repo, 'config', 'user.name', 'Tester');
    git(repo, 'config', 'user.email', 'tester@example.com');
    fs.writeFileSync(path.join(repo, 'a.txt'), 'a\n');
    git(repo, 'add', 'a.txt');
    git(repo, 'commit', '-q', '-m', 'init');
    const res = preflight(session, ['--target', 'main', '--repo-dir', repo, '--provider', 'codex', '--local-only'], sessionEnv(home));
    expect(res.code).toBe(0);
    expect(line(res.out, 'ok   target')).toMatch(/resolves locally/);
    expect(line(res.out, 'ok   publication')).toMatch(/remote, network/);
    expect(res.out).not.toMatch(/host:|credentials:|scope:/);
  });
});

describe('host dispatcher', () => {
  it('classifies the host from a remote URL', () => {
    const host = (url: string) => classifyRemote(url, (h: string) => h).host;
    expect(host('git@bitbucket.org:acme/widgets.git')).toBe('bitbucket');
    expect(host('https://user@bitbucket.org/acme/widgets.git')).toBe('bitbucket');
    expect(host('ssh://git@bitbucket.org/acme/widgets.git')).toBe('bitbucket');
    expect(host('git@github.com:acme/widgets.git')).toBe('github');
    expect(host('https://github.com/acme/widgets')).toBe('github');
  });

  it('resolves an SSH alias to its real host, but never an https host', () => {
    const alias = (h: string) => (h === 'work-github' ? 'github.com' : h);
    expect(classifyRemote('git@work-github:acme/widgets.git', alias).host).toBe('github');
    expect(classifyRemote('https://work-github/acme/widgets.git', alias).error).toMatch(/neither bitbucket.org nor github.com/);
  });

  it('refuses another host and an unreadable URL', () => {
    expect(classifyRemote('git@gitlab.com:acme/widgets.git', (h: string) => h).error).toMatch(/"gitlab.com" is neither/);
    expect(classifyRemote('/srv/git/widgets.git', (h: string) => h).error).toMatch(/cannot read a host/);
  });

  it('picks a remote by name, by owner and repo, or the only one', () => {
    const remotes = [
      { name: 'origin', url: 'git@bitbucket.org:acme/widgets.git' },
      { name: 'fork', url: 'git@github.com:me/widgets.git' },
    ];
    expect(pickRemote(remotes, { name: 'fork' }).remote.url).toContain('github.com');
    expect(pickRemote(remotes, { owner: 'acme', repo: 'widgets' }).remote.name).toBe('origin');
    expect(pickRemote([remotes[1]]).remote.name).toBe('fork');
    expect(pickRemote(remotes).error).toMatch(/2 remotes \(origin, fork\) and none chosen/);
    expect(pickRemote(remotes, { name: 'nope' }).error).toMatch(/no remote named "nope"/);
    expect(pickRemote(remotes, { owner: 'x', repo: 'y' }).error).toMatch(/no remote points at x\/y/);
    expect(pickRemote([]).error).toMatch(/no remote/);
  });

  it('chooses the host from the remotes and the owner flags, --workspace and --owner being the same flag', () => {
    const remotes = [
      { name: 'origin', url: 'git@bitbucket.org:acme/widgets.git' },
      { name: 'mirror', url: 'git@github.com:acme/mirror.git' },
    ];
    const resolve = (h: string) => h;
    expect(chooseHost({ workspace: 'acme', repo: 'widgets' }, remotes, resolve)).toMatchObject({ host: 'bitbucket', remote: { name: 'origin' } });
    expect(chooseHost({ owner: 'acme', repo: 'mirror' }, remotes, resolve)).toMatchObject({ host: 'github', remote: { name: 'mirror' } });
    expect(() => chooseHost({}, remotes, resolve)).toThrow(/none chosen/);
  });

  it('stops with a message on a host that is neither, without running a script', () => {
    const repo = makeRepo({ name: 'elsewhere', branches: ['main'], remoteUrl: 'git@example.com:acme/widgets.git' });
    const res = spawnSync(process.execPath, [DISPATCHER, '--title', 't'], { cwd: repo, encoding: 'utf8' });
    expect(res.status).toBe(1);
    expect(res.stderr).toMatch(/neither bitbucket.org nor github.com/);
  });

  it('hands over to the host script and returns its exit code', () => {
    const repo = makeRepo({ name: 'bb', branches: ['main'] });
    const res = spawnSync(process.execPath, [DISPATCHER], { cwd: repo, encoding: 'utf8' });
    expect(res.status).toBe(1);
    expect(res.stderr).toMatch(/Missing --title/);
  });
});

describe('listRemotes', () => {
  it('returns [] outside a git repository', () => {
    expect(listRemotes(tmp)).toEqual([]);
  });

  it('falls back to the effective url when a remote has no url key', () => {
    const work = path.join(tmp, 'nokey');
    fs.mkdirSync(work);
    git(work, 'init', '-q');
    git(work, 'config', 'remote.pushonly.pushurl', REMOTE_URL);
    expect(listRemotes(work)).toEqual([{ name: 'pushonly', url: 'pushonly', rawUrl: 'pushonly' }]);
  });
});

describe('cost block', () => {
  const table = '| Agent | Model |\n|---|---|\n| run | sonnet |';

  it('writes the table under a Run cost heading, trimmed, in the marker the PR body template carries', () => {
    expect(COST_BLOCK_NAME).toBe('delegate:cost');
    expect(costContent(`\n${table}\n\n`)).toBe(`## Run cost\n\n${table}`);
  });

  it('keeps a dollar sign in the table literal', () => {
    expect(costContent('| run | $1.23 |\n| total | $& $1 |')).toContain('$& $1');
  });
});

describe('preflight permissions and limits', () => {
  function setup() {
    const session = path.join(tmp, 'session');
    const home = path.join(tmp, 'home');
    fs.mkdirSync(session);
    fs.mkdirSync(home);
    skills(session, ALWAYS);
    const repo = makeRepo({ name: 'perm', branches: ['main'] });
    const env = sessionEnv(home, { BITBUCKET_EMAIL: 'a@example.com', BITBUCKET_API_TOKEN: 'secret' });
    return { session, home, repo, env };
  }

  const roots = (session: string, home: string) => [path.join(fs.realpathSync(session), '.claude', 'skills'), path.join(home, '.claude', 'skills')];

  function writeSettings(dir: string, value: unknown) {
    fs.mkdirSync(path.join(dir, '.claude'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.claude', 'settings.json'), JSON.stringify(value));
  }

  it('fails, with a ready settings.json snippet and where to get the permissions, when the commands a delegate runs are not allowed', () => {
    const { session, repo, env } = setup();
    const res = preflight(session, ['--target', 'main', '--repo-dir', repo, '--no-api'], env);
    expect(res.code).toBe(1);
    expect(res.out).toMatch(/preflight check\(s\) failed: permissions/);
    expect(line(res.out, 'FAIL permissions')).toContain('Bash(git commit:*)');
    expect(line(res.out, 'FAIL permissions')).toMatch(/Open the project in Lantern, or run `pnpm run install-skills/);
    const snippet = /(\{\n {2}"permissions"[\s\S]*?\n\})\n/.exec(res.out)?.[1];
    const parsed = JSON.parse(snippet ?? '{}');
    expect(parsed.permissions.allow).toContain('Bash(git push origin HEAD:refs/heads/feat/*)');
    expect(parsed.permissions.deny).toContain('Bash(git push * --force*)');
  });

  it('is quiet about permissions once the snippet is in the session settings', () => {
    const { session, home, repo, env } = setup();
    writeSettings(session, JSON.parse(settingsSnippet({ skillRoots: roots(session, home), skillLinker: linkerStub })));
    const res = preflight(session, ['--target', 'main', '--repo-dir', repo, '--no-api'], env);
    expect(line(res.out, 'ok   permissions')).toBeDefined();
    expect(line(res.out, 'WARN permissions')).toBeUndefined();
  });

  it('accepts the snippet from the repo-dir or the home settings as well', () => {
    const { session, home, repo, env } = setup();
    writeSettings(repo, JSON.parse(settingsSnippet({ skillRoots: roots(session, home), skillLinker: linkerStub })));
    expect(line(preflight(session, ['--target', 'main', '--repo-dir', repo, '--no-api'], env).out, 'ok   permissions')).toBeDefined();
    fs.rmSync(path.join(repo, '.claude'), { recursive: true });
    writeSettings(home, JSON.parse(settingsSnippet({ skillRoots: roots(session, home), skillLinker: linkerStub })));
    expect(line(preflight(session, ['--target', 'main', '--repo-dir', repo, '--no-api'], env).out, 'ok   permissions')).toBeDefined();
  });

  it('states what a delegate cannot do, before dispatch', () => {
    const { session, repo, env } = setup();
    const res = preflight(session, ['--target', 'main', '--repo-dir', repo, '--no-api'], env);
    expect(line(res.out, 'note limits')).toMatch(/cannot answer a prompt.*interactive login.*npx convex dev.*dev server/);
  });

  it('ships no destructive command in the allow list', () => {
    const { allow } = JSON.parse(settingsSnippet()).permissions;
    const withoutAbsolutePaths = (rule: string) => rule.replace(/(^|[\s(])\/[^\s)]*/g, '$1');
    for (const rule of allow as string[]) expect(withoutAbsolutePaths(rule)).not.toMatch(/checkout|clean|stash|--force|push -f|branch -D| -C /);
    expect((allow as string[]).filter((rule) => /git merge[ :]/.test(rule))).toEqual(['Bash(git merge --no-edit origin/*)']);
    expect(allow).toContain('Bash(git reset --hard origin/*)');
  });

  it('pushes only to conventional branches, and denies a force flag after the refspec as well as before it', () => {
    const { allow, deny } = JSON.parse(settingsSnippet()).permissions;
    const pushes = (allow as string[]).filter((rule) => rule.startsWith('Bash(git push'));
    expect(pushes.length).toBeGreaterThan(0);
    for (const rule of pushes) expect(rule).toMatch(/^Bash\(git push origin HEAD:refs\/heads\/(feat|fix|docs|chore)\/\*\)$/);
    expect(deny).toEqual(expect.arrayContaining(['Bash(git push --force*)', 'Bash(git push -f*)', 'Bash(git push * --force*)', 'Bash(git push * -f*)', 'Bash(git push * --delete*)']));
  });

  it('lets exactly the plain push of a conventional branch through, whatever follows or precedes it', () => {
    const { allow, deny } = JSON.parse(settingsSnippet({ skillRoots: ['/Users/me/proj/.claude/skills', '/Users/me/.claude/skills'] })).permissions;
    const runs =(command: string) => (allow as string[]).some((rule) => ruleMatches(rule, command)) && !(deny as string[]).some((rule) => ruleMatches(rule, command));

    for (const command of [
      'git push origin HEAD:refs/heads/feat/lan-15',
      'git push origin HEAD:refs/heads/chore/x',
      'git reset --hard origin/main',
      'git merge --no-edit origin/main',
      'git commit -m "feat: x"',
      'git add .lantern/prs/9.pr',
      'git fetch origin',
      'git status --short',
      'node /Users/me/proj/.claude/skills/lantern-sync/scripts/sync.mjs verify --base main',
      'node /Users/me/.claude/skills/lantern-setup/scripts/validate.mjs . --settled',
      'node /Users/me/proj/.claude/skills/lantern-delegate/scripts/github/identity.mjs --exec git commit -m x',
    ]) {
      expect(runs(command), command).toBe(true);
    }
    for (const command of [
      'node /Users/me/proj/.claude/skills/../../evil.mjs',
      'node /Users/me/proj/other/evil.mjs',
      'node .claude/skills/lantern-sync/scripts/sync.mjs status',
      'git checkout main',
      'git merge feat/x',
      'git merge origin/main',
      'git merge --no-ff origin/main',
      'git -C other status',
      'git push origin HEAD:refs/heads/',
      'git push origin HEAD:refs/heads/feat',
    ]) {
      expect(runs(command), command).toBe(false);
    }
    for (const command of [
      'git merge --no-edit origin/main -s ours',
      'git merge --no-edit origin/main -X theirs',
      'git merge --no-edit origin/main origin/other',
      'git push origin HEAD:refs/heads/feat/x --force',
      'git push origin HEAD:refs/heads/feat/x --force-with-lease',
      'git push origin HEAD:refs/heads/feat/x -f',
      'git push origin HEAD:refs/heads/feat/x HEAD:refs/heads/main',
      'git push origin HEAD:refs/heads/feat/x +HEAD:refs/heads/main',
      'git push origin HEAD:refs/heads/feat/x :refs/heads/main',
      'git push origin HEAD:refs/heads/feat/x --delete main',
      'git push --force origin HEAD:refs/heads/feat/x',
      'git push origin HEAD:refs/heads/main',
      'git push origin +HEAD:refs/heads/feat/x',
      'git push origin :refs/heads/feat/x',
    ]) {
      expect(runs(command), command).toBe(false);
    }
  });

  it('matches a broader allow rule against a narrower need', () => {
    expect(covers('Bash(git:*)', 'Bash(git commit:*)')).toBe(true);
    expect(covers('Bash(git commit:*)', 'Bash(git commit:*)')).toBe(true);
    expect(covers('Bash(git status:*)', 'Bash(git commit:*)')).toBe(false);
    expect(covers('Bash(git add:*)', 'Bash(git add .lantern)')).toBe(true);
    expect(covers('Bash', 'Bash(git commit:*)')).toBe(true);
    expect(covers('Read(*)', 'Bash(git commit:*)')).toBe(false);
    expect(covers('Bash(git push origin HEAD:refs/heads/feat/:*)', 'Bash(git push origin HEAD:refs/heads/feat/*)')).toBe(false);
    expect(covers('Bash(git push origin HEAD:refs/heads/*)', 'Bash(git push origin HEAD:refs/heads/feat/*)')).toBe(true);
  });

  it('reads :* as a whole-word prefix, like the harness, and * as a wildcard', () => {
    expect(ruleMatches('Bash(git commit:*)', 'git commit -m x')).toBe(true);
    expect(ruleMatches('Bash(git commit:*)', 'git commit')).toBe(true);
    expect(ruleMatches('Bash(git commit:*)', 'git commitx')).toBe(false);
    expect(ruleMatches('Bash(git reset --hard origin/:*)', 'git reset --hard origin/main')).toBe(false);
    expect(ruleMatches('Bash(git reset --hard origin/*)', 'git reset --hard origin/main')).toBe(true);
  });

  it('prints the snippet when permissions.mjs is run on its own', () => {
    const res = spawnSync(process.execPath, [path.join(SCRIPTS, 'permissions.mjs')], { encoding: 'utf8' });
    expect(JSON.parse(res.stdout).permissions.allow).toContain('Bash(git commit:*)');
  });
});

describe('skills symlink in a worktree', () => {
  it('lists the mkdir and ln rules in the snippet', () => {
    const root = '/Users/me/proj/.claude/skills';
    const { allow } = JSON.parse(settingsSnippet({ skillRoots: [root] })).permissions;
    expect(allow).toContain('Bash(mkdir -p .claude)');
    expect(allow).toContain(`Bash(ln -s ${root} .claude/skills)`);
    const runs = (command: string) => (allow as string[]).some((rule) => ruleMatches(rule, command));
    expect(runs(`ln -s ${root} .claude/skills`)).toBe(true);
    expect(runs(`ln -s ${root}/../../x .claude/skills`)).toBe(false);
    expect(runs('mkdir -p .claude')).toBe(true);
    expect(runs('mkdir -p .claude/../x')).toBe(false);
    expect(runs('ln -s /etc/passwd .claude/skills')).toBe(false);
    expect(runs(`ln -s ${root} /tmp/x`)).toBe(false);
  });

  it('makes sync.mjs status work from a worktree through the link, and fail without it', () => {
    const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8' });
    const main = path.join(tmp, 'main');
    fs.mkdirSync(main);
    git(main, 'init', '-b', 'main');
    git(main, 'config', 'user.email', 't@t');
    git(main, 'config', 'user.name', 't');
    fs.writeFileSync(path.join(main, '.gitignore'), '.claude/*\n');
    fs.writeFileSync(path.join(main, 'a.txt'), 'a\n');
    git(main, 'add', '.');
    git(main, 'commit', '-m', 'init');
    const wt = path.join(tmp, 'wt');
    git(main, 'worktree', 'add', '--detach', wt, 'main');
    const status = () =>
      spawnSync(process.execPath, ['.claude/skills/lantern-sync/scripts/sync.mjs', 'status', '--base', 'main'], { cwd: wt, encoding: 'utf8' });

    expect(status().status).not.toBe(0);

    fs.mkdirSync(path.join(wt, '.claude'), { recursive: true });
    fs.symlinkSync(path.join(__dirname, '..', 'skills'), path.join(wt, '.claude', 'skills'));
    expect(fs.existsSync(path.join(wt, '.claude/skills/lantern-sync/scripts/sync.mjs'))).toBe(true);
    const res = status();
    expect(res.status, res.stderr).toBe(0);
    expect(git(wt, 'status', '--porcelain')).toBe('');
  });
});

describe('skill linker resolution and the required-skills lists', () => {
  const HOME_DEFAULT = (home: string) => path.join(home, 'GIT', 'skills', 'skill-linker');

  function setup() {
    const session = path.join(tmp, 'session');
    const home = path.join(tmp, 'home');
    fs.mkdirSync(session);
    fs.mkdirSync(home);
    skills(session, ALWAYS);
    const repo = makeRepo({ name: 'linker', branches: ['main'] });
    return { session, home, repo };
  }

  function run(session: string, home: string, repo: string, extra: NodeJS.ProcessEnv = {}, args: string[] = []) {
    const env = sessionEnv(home, { SKILL_LINKER: '', ...extra });
    return preflight(session, ['--target', 'main', '--repo-dir', repo, '--no-api', ...args], env);
  }

  function writeConfig(home: string, data: unknown) {
    fs.mkdirSync(path.join(home, '.claude'), { recursive: true });
    fs.writeFileSync(path.join(home, '.claude', 'lantern-extensions.json'), JSON.stringify(data));
  }

  it('prints nothing about the skill linker when none is configured, even with one on PATH or in ~/GIT/skills', () => {
    const { session, home, repo } = setup();
    const creds = { BITBUCKET_EMAIL: 'a@example.com', BITBUCKET_API_TOKEN: 'secret' };
    allowDelegate(session, home, '');
    makeSkillLinker(path.dirname(HOME_DEFAULT(home)));
    const onPath = makeSkillLinker(path.join(tmp, 'bin'));
    const res = run(session, home, repo, { ...creds, PATH: `${path.dirname(onPath)}${path.delimiter}${pathWithoutSkillLinker()}` });
    expect(res.out).not.toContain('FAIL');
    expect(res.code).toBe(0);
    expect(res.out).not.toMatch(/skill-linker/i);
  });

  it('prints a plain ok line with the path when SKILL_LINKER is set', () => {
    const { session, home, repo } = setup();
    const creds = { BITBUCKET_EMAIL: 'a@example.com', BITBUCKET_API_TOKEN: 'secret' };
    const stub = makeSkillLinker(path.join(tmp, 'ok'));
    allowDelegate(session, home, stub);
    const res = run(session, home, repo, { ...creds, SKILL_LINKER: stub });
    expect(res.code).toBe(0);
    expect(line(res.out, 'ok   skill-linker')).toBe(`ok   skill-linker: ${stub}`);
    expect(res.out).toMatch(/preflight green/);
  });

  it('prints the same ok line when only the skillLinker key of the extensions config is set', () => {
    const { session, home, repo } = setup();
    const stub = makeSkillLinker(path.join(tmp, 'cfg'));
    writeConfig(home, { skillLinker: stub });
    const res = run(session, home, repo, {});
    expect(line(res.out, 'ok   skill-linker')).toBe(`ok   skill-linker: ${stub}`);
  });

  it('passes the skill-linker check with only the Skills repo set, the script the same folder as a config path gives', () => {
    const { session, home, repo } = setup();
    const stub = makeSkillLinker(path.join(tmp, 'skills-repo'));
    const res = run(session, home, repo, { SKILLS_REPO: path.dirname(stub) });
    expect(res.out).not.toContain('FAIL skill-linker');
    expect(line(res.out, 'ok   skill-linker')).toBe(`ok   skill-linker: ${stub}`);
    expect(fs.existsSync(path.join(home, '.claude', 'lantern-extensions.json'))).toBe(false);
  });

  it('lets the config key and SKILL_LINKER win over the Skills repo, and ignores a repo with no linker', () => {
    const { session, home, repo } = setup();
    const fromRepo = makeSkillLinker(path.join(tmp, 'skills-repo'));
    const fromConfig = makeSkillLinker(path.join(tmp, 'cfg'));
    const fromEnv = makeSkillLinker(path.join(tmp, 'envdir'));
    writeConfig(home, { skillLinker: fromConfig });
    expect(line(run(session, home, repo, { SKILLS_REPO: path.dirname(fromRepo) }).out, 'ok   skill-linker')).toContain(fromConfig);
    expect(line(run(session, home, repo, { SKILLS_REPO: path.dirname(fromRepo), SKILL_LINKER: fromEnv }).out, 'ok   skill-linker')).toContain(fromEnv);
    writeConfig(home, {});
    const bare = path.join(tmp, 'bare-repo');
    fs.mkdirSync(bare);
    expect(run(session, home, repo, { SKILLS_REPO: bare }).out).not.toMatch(/skill-linker/i);
  });

  it('lets SKILL_LINKER win over the config key', () => {
    const { session, home, repo } = setup();
    const fromConfig = makeSkillLinker(path.join(tmp, 'cfg'));
    const fromEnv = makeSkillLinker(path.join(tmp, 'envdir'));
    writeConfig(home, { skillLinker: fromConfig });
    expect(line(run(session, home, repo, { SKILL_LINKER: fromEnv }).out, 'ok   skill-linker')).toContain(fromEnv);
  });

  it('refuses an invalid config key with a note and never uses it', () => {
    const { session, home, repo } = setup();
    writeConfig(home, { skillLinker: 'skill-linker' });
    const res = run(session, home, repo, {});
    expect(res.out).not.toContain('FAIL skill-linker');
    expect(line(res.out, 'ok   skill-linker')).toBeUndefined();
    expect(line(res.out, 'note skill-linker')).toContain('absolute path');
  });

  it('notes, without failing, a configured skill linker that is not executable or has no core', () => {
    const { session, home, repo } = setup();
    const missing = run(session, home, repo, { SKILL_LINKER: path.join(tmp, 'missing', 'skill-linker') });
    expect(missing.out).not.toContain('FAIL skill-linker');
    expect(line(missing.out, 'note skill-linker')).toContain('not an executable file');
    const bare = makeSkillLinker(path.join(tmp, 'nocore'), { core: false });
    const res = run(session, home, repo, { SKILL_LINKER: bare });
    expect(res.out).not.toContain('FAIL skill-linker');
    expect(line(res.out, 'note skill-linker')).toMatch(/no "core" folder/);
  });

  it('prints nothing about the skill linker in local mode either when none is configured', () => {
    const { session, home } = setup();
    const local = path.join(tmp, 'local');
    fs.mkdirSync(local);
    git(local, 'init', '-q');
    git(local, 'config', 'user.name', 'T');
    git(local, 'config', 'user.email', 't@example.com');
    fs.writeFileSync(path.join(local, 'a.txt'), 'a\n');
    git(local, 'add', 'a.txt');
    git(local, 'commit', '-q', '-m', 'init');
    const res = preflight(session, ['--target', 'main', '--repo-dir', local, '--no-api'], sessionEnv(home, { SKILL_LINKER: '' }));
    expect(res.out).not.toMatch(/skill-linker/i);
  });

  it('keeps the bundled part of the required list equal to BUNDLE_SKILLS without the planning skills', () => {
    const res = spawnSync(process.execPath, ['--input-type=module', '-e', `import { BUNDLED_SKILLS } from ${JSON.stringify(path.join(SCRIPTS, 'bundled-skills.mjs'))}; import { PLANNING_SKILL_NAMES } from ${JSON.stringify(path.join(SCRIPTS, '..', '..', 'lantern-plan', 'scripts', 'planning-skills.mjs'))}; console.log(JSON.stringify({ BUNDLED_SKILLS, PLANNING_SKILL_NAMES }));`], { encoding: 'utf8' });
    const { BUNDLED_SKILLS, PLANNING_SKILL_NAMES } = JSON.parse(res.stdout);
    const bundle = BUNDLE_SKILLS.map((s: { name: string }) => s.name);
    expect(bundle.filter((name: string) => !PLANNING_SKILL_NAMES.includes(name))).toEqual(BUNDLED_SKILLS);
    expect(bundle.filter((name: string) => PLANNING_SKILL_NAMES.includes(name))).toEqual(PLANNING_SKILL_NAMES);
  });

  it('tells the orchestrator to link a missing --skills skill with the resolved skill linker, and keeps a skill that is not bundled out of the bundled list', () => {
    const { session, home, repo } = setup();
    const res = run(session, home, repo, { SKILL_LINKER: linkerStub }, ['--skills', 'my-extra']);
    const failed = line(res.out, 'FAIL skills') ?? '';
    expect(failed).toContain('not in the registry the delegate inherits: my-extra.');
    expect(failed).toContain(`${linkerStub} . --skill my-extra`);
    expect(BUNDLE_SKILLS.map((s: { name: string }) => s.name)).not.toContain('my-extra');
  });

  it('names the installer, not the skill linker, for a missing bundled skill', () => {
    const { session, home, repo } = setup();
    fs.rmSync(path.join(session, '.claude', 'skills', 'lantern-local-loop'), { recursive: true });
    const failed = line(run(session, home, repo, { SKILL_LINKER: linkerStub }).out, 'FAIL skills') ?? '';
    expect(failed).toContain('install-skills');
    expect(failed).not.toContain('--skill lantern-local-loop');
  });

  it('puts the skill linker rule in the permissions snippet only when it resolves, limited to the . --skill form', () => {
    const stub = '/Users/me/GIT/skills/skill-linker';
    const { allow, deny } = JSON.parse(settingsSnippet({ skillRoots: ['/Users/me/p/.claude/skills'], skillLinker: stub })).permissions;
    const runs = (command: string) => (allow as string[]).some((rule) => ruleMatches(rule, command)) && !(deny as string[]).some((rule) => ruleMatches(rule, command));
    expect(allow).toContain(`Bash(${stub} . --skill:*)`);
    expect(runs(`${stub} . --skill team-conventions`)).toBe(true);
    expect(runs(`${stub} . --skill typescript`)).toBe(true);
    expect(allow).toContain(`Bash(${stub} --list)`);
    expect(runs(`${stub} --list`)).toBe(true);
    for (const command of [stub, `${stub} .`, `${stub} --global`, `${stub} . nextjs`, `${stub} --list x`, `${stub} --list --unlink`, `${stub} . --skill x --unlink`, `${stub}-evil . --skill x`, `${stub}-evil --list`, 'skill-linker . --skill x', 'skill-linker --list']) {
      expect(runs(command), command).toBe(false);
    }
    expect((allow as string[]).filter((rule) => rule.includes('skill-linker'))).toEqual([`Bash(${stub} --list)`, `Bash(${stub} . --skill:*)`]);
    expect(JSON.stringify(JSON.parse(settingsSnippet({ skillRoots: [] })).permissions)).not.toContain('skill-linker');
  });

  it('makes preflight fail on a missing skill linker permission rule, and go quiet once added', () => {
    const { session, home, repo } = setup();
    const env = { BITBUCKET_EMAIL: 'a@example.com', BITBUCKET_API_TOKEN: 'secret' };
    const rules = [path.join(fs.realpathSync(session), '.claude', 'skills'), path.join(home, '.claude', 'skills')];
    expect(line(run(session, home, repo, { ...env, SKILL_LINKER: linkerStub }).out, 'FAIL permissions')).toContain(`Bash(${linkerStub} . --skill:*)`);
    fs.mkdirSync(path.join(session, '.claude'), { recursive: true });
    fs.writeFileSync(path.join(session, '.claude', 'settings.json'), settingsSnippet({ skillRoots: rules, skillLinker: linkerStub }));
    expect(line(run(session, home, repo, { ...env, SKILL_LINKER: linkerStub }).out, 'ok   permissions')).toBeDefined();
  });
});
