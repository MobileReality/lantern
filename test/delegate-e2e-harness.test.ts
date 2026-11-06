import { execFile, spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as checks from '../scripts/e2e-delegate/checks.mjs';
import { stopChild } from '../scripts/e2e-delegate/child.mjs';
import { executeAll } from '../scripts/e2e-delegate/execute.mjs';
import { main, runLive } from '../scripts/e2e-delegate/run.mjs';
import { parseArgs, renderPlan, selectProjects } from '../scripts/e2e-delegate/plan.mjs';
import { createProject, EXTRA_SKILL, extrasOf, GITIGNORE, offOf, ORCH_EXTRA_SKILL, orchestratorExtrasOf, PROJECTS, remoteUrl, writeExtraSkills } from '../scripts/e2e-delegate/projects.mjs';
import { startMock } from '../scripts/e2e-delegate/mock-bitbucket.mjs';
import { readExtensions, readSkillLinker, readSwitchedOff } from '../skills/lantern-delegate/scripts/extensions.mjs';
import { defaultSkillRoots, missingPermissions, requiredAllow, settingsFiles } from '../skills/lantern-delegate/scripts/permissions.mjs';
import * as report from '../scripts/e2e-delegate/report.mjs';
import { claudeArgs, claudeEnv, runClaude, sessionEnv } from '../scripts/e2e-delegate/session.mjs';
import { createIsolatedHome, createWorkspace, disposeWorkspace, removeTranscripts, transcriptsHome } from '../scripts/e2e-delegate/workspace.mjs';

const run = promisify(execFile);
const HARNESS = path.join(__dirname, '..', 'scripts', 'e2e-delegate');
const FAKE_SSH = path.join(HARNESS, 'fake-ssh.sh');
const REDIRECT = path.join(HARNESS, 'redirect-fetch.mjs');

const dirs: string[] = [];
const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const fn of cleanups.splice(0)) await fn();
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

function tmp(prefix = 'e2e-harness-') {
  const d = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), prefix));
  dirs.push(d);
  return d;
}

async function mock() {
  const m = await startMock(0);
  cleanups.push(() => m.close());
  return { ...m, url: `http://127.0.0.1:${m.port}` };
}

const json = (url: string, init?: RequestInit) => fetch(url, init).then(async (r) => ({ status: r.status, headers: r.headers, body: await r.json() }));
const post = (url: string, body: unknown) => json(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const PR_BODY = { title: 'feat: x', description: 'd', source: { branch: { name: 'feat/x' } }, destination: { branch: { name: 'main' } } };

describe('mock Bitbucket', () => {
  it('serves the repo with the oauth scopes header', async () => {
    const m = await mock();
    const r = await json(`${m.url}/2.0/repositories/e2e/app`);
    expect(r.status).toBe(200);
    expect(r.body.full_name).toBe('e2e/app');
    expect(r.headers.get('x-oauth-scopes')).toContain('write:pullrequest:bitbucket');
  });

  it('creates, lists, gets and updates a pull request', async () => {
    const m = await mock();
    const base = `${m.url}/2.0/repositories/e2e/app/pullrequests`;
    const created = await post(base, PR_BODY);
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ id: 1, state: 'OPEN', links: { html: { href: 'https://bitbucket.org/e2e/app/pull-requests/1' } } });
    expect((await post(base, { ...PR_BODY, source: { branch: { name: 'feat/y' } } })).body.id).toBe(2);
    expect((await json(base)).body.values).toHaveLength(2);
    const filtered = await json(`${base}?q=${encodeURIComponent('source.branch.name="feat/y"')}`);
    expect(filtered.body.values.map((p: { id: number }) => p.id)).toEqual([2]);
    expect((await json(`${base}/1`)).body.title).toBe('feat: x');
    const put = await json(`${base}/1`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: 'new', description: 'more' }) });
    expect(put.body).toMatchObject({ title: 'new', description: 'more' });
  });

  it('keeps pull requests apart per repository', async () => {
    const m = await mock();
    await post(`${m.url}/2.0/repositories/e2e/a/pullrequests`, PR_BODY);
    expect((await json(`${m.url}/2.0/repositories/e2e/b/pullrequests`)).body.values).toEqual([]);
    expect((await json(`${m.url}/__prs`)).body.values).toHaveLength(1);
  });

  it('answers 404 for an unknown route and an unknown pull request, 400 for bad JSON', async () => {
    const m = await mock();
    expect((await json(`${m.url}/nope`)).status).toBe(404);
    expect((await json(`${m.url}/2.0/repositories/e2e/app/pullrequests/9`)).status).toBe(404);
    const bad = await json(`${m.url}/2.0/repositories/e2e/app/pullrequests`, { method: 'POST', body: '{nope' });
    expect(bad.status).toBe(400);
  });

  it('runs as its own child process and prints its port', async () => {
    const child = spawn(process.execPath, [path.join(HARNESS, 'mock-bitbucket.mjs')], { env: { ...process.env, MOCK_BB_PORT: '0' }, stdio: ['ignore', 'pipe', 'inherit'] });
    cleanups.push(() => stopChild(child));
    const line: string = await new Promise((resolve) => child.stdout.once('data', (d) => resolve(String(d))));
    const port = Number(line.match(/listening on (\d+)/)?.[1]);
    expect(port).toBeGreaterThan(0);
    expect((await json(`http://127.0.0.1:${port}/2.0/repositories/e2e/app`)).status).toBe(200);
  });
});

describe('redirect-fetch hook', () => {
  const script = (url: string) => `fetch(${JSON.stringify(url)}).then((r) => r.json()).then((j) => console.log(JSON.stringify(j)))`;

  it('sends api.bitbucket.org requests to the mock', async () => {
    const m = await mock();
    const { stdout } = await run(process.execPath, ['--import', REDIRECT, '-e', script('https://api.bitbucket.org/2.0/repositories/e2e/app')], {
      env: { ...process.env, MOCK_BB_PORT: String(m.port) },
    });
    expect(JSON.parse(stdout)).toMatchObject({ full_name: 'e2e/app' });
  });

  it('leaves other hosts alone', async () => {
    const m = await mock();
    const { stdout } = await run(process.execPath, ['--import', REDIRECT, '-e', script(`${m.url}/2.0/repositories/e2e/other`)], {
      env: { ...process.env, MOCK_BB_PORT: '1' },
    });
    expect(JSON.parse(stdout)).toMatchObject({ full_name: 'e2e/other' });
  });

  it('does nothing without MOCK_BB_PORT', async () => {
    const { stdout } = await run(process.execPath, ['--import', REDIRECT, '-e', 'console.log(String(globalThis.fetch).includes("realFetch"))'], {
      env: { ...process.env, MOCK_BB_PORT: '' },
    });
    expect(stdout.trim()).toBe('false');
  });
});

describe('fake ssh and the project fixtures', () => {
  function setup(project = PROJECTS[0]) {
    const root = tmp();
    const remotesDir = path.join(root, 'remotes');
    fs.mkdirSync(remotesDir);
    const made = createProject({ root, project, remotesDir, fakeSsh: FAKE_SSH });
    return { root, remotesDir, ...made, project };
  }
  const sshEnv = (remotesDir: string) => ({ ...process.env, GIT_SSH_COMMAND: FAKE_SSH, E2E_REMOTES: remotesDir });

  it('maps git@bitbucket.org:e2e/<name>.git to the local bare repo for ls-remote and push', () => {
    const { dir, remotesDir, bare } = setup();
    const env = sshEnv(remotesDir);
    const ls = spawnSync('git', ['ls-remote', remoteUrl('todo-cli')], { cwd: dir, env, encoding: 'utf8' });
    expect(ls.status).toBe(0);
    expect(ls.stdout).toContain('refs/heads/main');
    spawnSync('git', ['checkout', '-q', '-b', 'feat/x'], { cwd: dir });
    fs.writeFileSync(path.join(dir, 'x.txt'), 'x');
    spawnSync('git', ['add', 'x.txt'], { cwd: dir });
    spawnSync('git', ['commit', '-q', '-m', 'feat: x'], { cwd: dir });
    const push = spawnSync('git', ['push', '-q', 'origin', 'HEAD:refs/heads/feat/x'], { cwd: dir, env, encoding: 'utf8' });
    expect(push.status).toBe(0);
    expect(spawnSync('git', ['branch', '--list'], { cwd: bare, encoding: 'utf8' }).stdout).toContain('feat/x');
  });

  it('refuses to run without E2E_REMOTES', () => {
    const env = { ...process.env, GIT_SSH_COMMAND: FAKE_SSH };
    delete (env as Record<string, string | undefined>).E2E_REMOTES;
    const res = spawnSync(FAKE_SSH, ['git@bitbucket.org', "git-upload-pack 'e2e/a.git'"], { env, encoding: 'utf8' });
    expect(res.status).not.toBe(0);
    expect(res.stderr).toContain('E2E_REMOTES');
  });

  it('keeps the origin a real-looking Bitbucket URL and holds no secret file: the account is on the fake Lantern socket', () => {
    const { dir } = setup();
    const git = (...args: string[]) => spawnSync('git', args, { cwd: dir, encoding: 'utf8' }).stdout.trim();
    expect(git('remote', 'get-url', 'origin')).toBe('git@bitbucket.org:e2e/todo-cli.git');
    expect(git('ls-files')).not.toContain('.ai/.env');
    expect(fs.existsSync(path.join(dir, '.ai', '.env'))).toBe(false);
    expect(fs.readFileSync(path.join(dir, '.gitignore'), 'utf8').split('\n').filter(Boolean)).toEqual(GITIGNORE);
    expect(git('config', 'user.email')).toBe('e2e@example.test');
  });

  it('defines the four projects with a task and a verify command each', () => {
    expect(PROJECTS.map((p: { name: string }) => p.name)).toEqual(['todo-cli', 'tiny-api', 'pyutil', 'rubyutil']);
    for (const p of PROJECTS) {
      expect(p.task).toContain(p.taskTestCommand);
      expect(Object.keys(p.files).length).toBeGreaterThan(2);
    }
  });

  for (const project of PROJECTS) {
    const available = spawnSync(project.runtime, ['--version']).status === 0;
    it.skipIf(!available)(`${project.name}: the generated project passes its own tests with ${project.runtime}`, () => {
      const { dir } = setup(project);
      const [cmd, ...args] = project.testCommand;
      const res = spawnSync(cmd, args, { cwd: dir, encoding: 'utf8' });
      expect(res.status, res.stdout + res.stderr).toBe(0);
    });
  }
});

const fakePr = (over: object = {}) => ({
  id: 1,
  key: 'e2e/app',
  state: 'OPEN',
  source: { branch: { name: 'feat/x' } },
  destination: { branch: { name: 'main' } },
  ...over,
});

describe('checks: mock PR, scripts and panel', () => {
  it('map-pushed', () => {
    expect(checks.checkMapPushed(['README.md', '.lantern/map']).ok).toBe(true);
    expect(checks.checkMapPushed(['README.md', '.lantern/map/src.lantern']).ok).toBe(true);
    expect(checks.checkMapPushed(['README.md', '.lantern/mapping.txt']).ok).toBe(false);
    expect(checks.checkMapPushed(['README.md']).ok).toBe(false);
  });

  it('one-open-pr passes for one open PR from a feature branch into main', () => {
    expect(checks.checkOnePr([fakePr()], 'e2e/app', 'main')).toMatchObject({ ok: true, hard: true });
    expect(checks.featureBranch([fakePr()], 'e2e/app')).toBe('feat/x');
  });

  it.each([
    ['no PR', []],
    ['a PR in the wrong state', [fakePr({ state: 'MERGED' })]],
    ['two open PRs', [fakePr(), fakePr({ id: 2 })]],
    ['the wrong destination', [fakePr({ destination: { branch: { name: 'develop' } } })]],
    ['main as source', [fakePr({ source: { branch: { name: 'main' } } })]],
    ['another repo only', [fakePr({ key: 'e2e/other' })]],
  ])('one-open-pr fails for %s', (_label, prs) => {
    expect(checks.checkOnePr(prs, 'e2e/app', 'main').ok).toBe(false);
  });

  it('sync-verify-green and validate-settled judge exit code and output', () => {
    expect(checks.checkSyncVerify({ status: 0, stdout: 'lantern-sync verify (base main): GREEN', stderr: '' }).ok).toBe(true);
    expect(checks.checkSyncVerify({ status: 1, stdout: 'verify (base main): RED, 2 problem(s)', stderr: '' })).toMatchObject({ ok: false, reason: expect.stringContaining('RED') });
    expect(checks.checkSyncVerify({ status: 0, stdout: 'nothing', stderr: '' }).ok).toBe(false);
    expect(checks.checkValidate({ status: 0, stdout: 'prs 1 record(s), OK\nOK\n', stderr: '' }).ok).toBe(true);
    expect(checks.checkValidate({ status: 1, stdout: 'in progress (not allowed with --settled): x\n', stderr: '' }).ok).toBe(false);
  });

  it('runNodeScript captures status and output', () => {
    const dir = tmp();
    fs.writeFileSync(path.join(dir, 's.mjs'), 'console.log("OK"); process.exit(3);');
    expect(checks.runNodeScript([path.join(dir, 's.mjs')], dir)).toMatchObject({ status: 3, stdout: 'OK\n' });
  });

  const load = (over: object = {}) => ({ prs: [{ id: '5', state: 'open', files: [{ path: 'a.ts' }, { path: 'b.ts' }] }], warnings: [], ...over });

  it('panel-sees-pr passes for an open PR covering every changed file', () => {
    expect(checks.checkPanel({ load: load(), changedFiles: ['a.ts', 'b.ts'] }).ok).toBe(true);
  });

  it.each([
    ['a merged PR', load({ prs: [{ id: '5', state: 'merged', files: [{ path: 'a.ts' }] }] }), ['a.ts']],
    ['a warning', load({ warnings: ['.lantern/prs/5.pr: bad'] }), ['a.ts']],
    ['no PR', load({ prs: [] }), ['a.ts']],
    ['a missing file', load(), ['a.ts', 'c.ts']],
    ['no changed files', load(), []],
  ])('panel-sees-pr fails for %s', (_label, l, changed) => {
    expect(checks.checkPanel({ load: l, changedFiles: changed }).ok).toBe(false);
  });
});

describe('panel check against a real git remote', () => {
  function pushFeature() {
    const root = tmp();
    const remotesDir = path.join(root, 'remotes');
    fs.mkdirSync(remotesDir);
    const { dir, bare } = createProject({ root, project: PROJECTS[0], remotesDir, fakeSsh: FAKE_SSH });
    const env = { ...process.env, GIT_SSH_COMMAND: FAKE_SSH, E2E_REMOTES: remotesDir };
    const git = (cwd: string, ...args: string[]) => {
      const res = spawnSync('git', args, { cwd, env, encoding: 'utf8' });
      expect(res.status, res.stderr).toBe(0);
      return res.stdout.trim();
    };
    git(dir, 'checkout', '-q', '-b', 'feat/x');
    fs.writeFileSync(path.join(dir, 'x.txt'), 'x');
    git(dir, 'add', 'x.txt');
    git(dir, 'commit', '-q', '-m', 'feat: x');
    const head = git(dir, 'rev-parse', 'HEAD');
    fs.mkdirSync(path.join(dir, '.lantern', 'prs'), { recursive: true });
    fs.writeFileSync(
      path.join(dir, '.lantern', 'prs', '1.pr'),
      `lantern-pr 1\n# 1\n#title feat: x\n#url https://bitbucket.org/e2e/todo-cli/pull-requests/1\n#branch feat/x\n#base main\n#opened 2026-10-09\n#head ${head}\n+ x.txt\n#order x.txt\n#reason x.txt Adds the file the panel must list.\n`,
    );
    git(dir, 'add', '.lantern');
    git(dir, 'commit', '-q', '-m', 'chore: record pull request #1 in the Lantern map');
    git(dir, 'push', '-q', 'origin', 'HEAD:refs/heads/feat/x');
    const tip = git(dir, 'rev-parse', 'HEAD');
    const clone = () => {
      const target = path.join(root, `clone-${fs.readdirSync(root).length}`);
      git(root, 'clone', '-q', '--branch', 'feat/x', bare, target);
      git(target, 'branch', '-q', 'main', 'origin/main');
      return target;
    };
    return { bare, tip, git, clone, root };
  }

  it('reads the pushed branch as an open PR and fails once the branch is merged into main', async () => {
    const { bundlePanel, changedFilesOf, readPanel } = await import('../scripts/e2e-delegate/panel.mjs');
    const { bare, tip, git, clone, root } = pushFeature();
    const panel = await bundlePanel(path.join(__dirname, '..'), root);
    expect(typeof panel.fetchPrs).toBe('function');

    const open = clone();
    expect(changedFilesOf(open, 'main')).toEqual(['x.txt']);
    const loadOpen = await readPanel(panel, open);
    expect(loadOpen.warnings).toEqual([]);
    expect(checks.checkPanel({ load: loadOpen, changedFiles: ['x.txt'] })).toMatchObject({ ok: true });

    git(bare, 'update-ref', 'refs/heads/main', tip);
    const merged = await readPanel(panel, clone());
    expect(merged.prs[0].state).toBe('merged');
    expect(checks.checkPanel({ load: merged, changedFiles: ['x.txt'] })).toMatchObject({ ok: false, reason: expect.stringContaining('merged') });
  }, 60000);
});

describe('checks: skills directory', () => {
  const bundled = ['lantern-setup', 'lantern-sync', 'lantern-delegate', 'lantern-commit', 'lantern-no-comments', 'lantern-local-loop'].map((name) => ({ name, kind: 'dir' }));

  it('passes real bundled folders plus generic convention symlinks', () => {
    const entries = [...bundled, { name: 'biome', kind: 'symlink' }, { name: 'typescript', kind: 'symlink' }];
    expect(checks.checkSkillsDir(entries).ok).toBe(true);
  });

  it.each([
    ['a foreign skill', [...bundled, { name: 'delegate', kind: 'symlink' }], 'delegate'],
    ['wayfinder', [...bundled, { name: 'wayfinder', kind: 'symlink' }], 'wayfinder'],
    ['a bundled skill as a symlink', [...bundled.slice(1), { name: 'lantern-setup', kind: 'symlink' }], 'lantern-setup'],
    ['a missing bundled skill', bundled.slice(1), 'lantern-setup is missing'],
    ['a real folder for a convention', [...bundled, { name: 'typescript', kind: 'dir' }], 'typescript'],
  ])('fails for %s', (_label, entries, fragment) => {
    const r = checks.checkSkillsDir(entries);
    expect(r.ok).toBe(false);
    expect(r.reason).toContain(fragment);
  });

  it('does not expect a skill switched off for the delegate to be installed, and flags it when it is', () => {
    const without = bundled.filter((e) => e.name !== 'lantern-local-loop');
    expect(checks.checkSkillsDir(without, [], ['lantern-local-loop']).ok).toBe(true);
    expect(checks.checkSkillsDir(without).reason).toContain('lantern-local-loop is missing');
    expect(checks.checkSkillsDir(without.filter((e) => e.name !== 'lantern-commit'), [], ['lantern-local-loop']).reason).toContain('lantern-commit is missing');
    expect(checks.checkSkillsDir(bundled, [], ['lantern-local-loop']).reason).toContain('lantern-local-loop is switched off and still installed');
  });

  it('reads a skills folder from disk', () => {
    const root = tmp();
    fs.mkdirSync(path.join(root, 'real'));
    fs.mkdirSync(path.join(root, 'target'));
    fs.symlinkSync(path.join(root, 'target'), path.join(root, 'linked'));
    fs.mkdirSync(path.join(root, '.hidden'));
    const entries = checks.readSkillsDir(root).sort((a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name));
    expect(entries).toEqual([
      { name: 'linked', kind: 'symlink' },
      { name: 'real', kind: 'dir' },
      { name: 'target', kind: 'dir' },
    ]);
    expect(checks.readSkillsDir(path.join(root, 'nope'))).toEqual([]);
  });
});

const line = (...blocks: object[]) => JSON.stringify({ message: { content: blocks } });
const assistant = (text: string) => JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text }] } });
const toolUse = (id: string, name: string, input: object) => ({ type: 'tool_use', id, name, input });
const toolResult = (id: string, content: string, is_error = false) => ({ type: 'tool_result', tool_use_id: id, content, is_error });
const skillFile = (name: string) => `/wt/.claude/skills/${name}/SKILL.md`;
const passingReads = () => [
  line(toolUse('r1', 'Read', { file_path: skillFile('lantern-commit') })),
  line(toolUse('r2', 'Read', { file_path: skillFile('lantern-no-comments') })),
  line(toolUse('r4', 'Read', { file_path: skillFile('lantern-local-loop') })),
  line(toolUse('r5', 'Bash', { command: '/x/skills/skill-linker . --skill team-conventions' })),
  line(toolUse('r6', 'Read', { file_path: skillFile('team-conventions') })),
];
const reviewCall = (type: string) => line(toolUse('rv', 'Agent', { subagent_type: type, description: 'Review the branch', prompt: 'Run lantern-code-reviewer against HEAD' }));

function writeTranscripts(specs: Array<{ id: string; type: string; lines: string[] }>) {
  const home = tmp('claude-home-');
  const cwd = path.join(tmp('lantern-e2e-'), 'projects', 'app');
  const key = cwd.replace(/[^a-zA-Z0-9]/g, '-');
  const sub = path.join(home, key, 'session-1', 'subagents');
  fs.mkdirSync(sub, { recursive: true });
  for (const s of specs) {
    fs.writeFileSync(path.join(sub, `agent-${s.id}.jsonl`), `${s.lines.join('\n')}\n`);
    fs.writeFileSync(path.join(sub, `agent-${s.id}.meta.json`), JSON.stringify({ agentType: s.type }));
  }
  return { home, cwd, transcripts: checks.loadTranscripts(home, cwd, 0) };
}

describe('checks: transcripts', () => {
  const delegate = (lines: string[]) => ({ id: 'd1', type: 'lantern-delegate-medium', lines });

  it('loadTranscripts finds subagent transcripts by project folder, agent type and age', () => {
    const { home, cwd, transcripts } = writeTranscripts([delegate(passingReads()), { id: 'r1', type: 'reviewer', lines: [assistant('x')] }]);
    expect(transcripts.map((t: { agentType: string }) => t.agentType).sort()).toEqual(['lantern-delegate-medium', 'reviewer']);
    expect(transcripts.find((t: { agentId: string }) => t.agentId === 'd1')).toBeTruthy();
    expect(checks.loadTranscripts(home, cwd, Date.now() + 60000)).toEqual([]);
    expect(checks.loadTranscripts(home, path.join(cwd, 'other'), 0)).toEqual([]);
  });

  it('no-transcript-errors passes clean transcripts and a protocol text that merely mentions the errors', () => {
    const { transcripts } = writeTranscripts([delegate([line(toolResult('a', 'Unknown skill is never a reason to skip it. ERR_MODULE_NOT_FOUND'))])]);
    expect(checks.checkTranscriptErrors(transcripts).ok).toBe(true);
  });

  it.each([
    ['Unknown skill', toolResult('a', 'Unknown skill: lantern-sync', true)],
    ['ERR_MODULE_NOT_FOUND', toolResult('a', "Error [ERR_MODULE_NOT_FOUND]: Cannot find module 'x'", true)],
    ['agent type not found', toolResult('a', "Agent type 'reviewer' not found. Available agents: Explore")],
  ])('no-transcript-errors fails on %s', (label, block) => {
    const { transcripts } = writeTranscripts([delegate([line(block)])]);
    const r = checks.checkTranscriptErrors(transcripts);
    expect(r.ok).toBe(false);
    expect(r.reason).toContain(label);
  });

  it('no-transcript-errors fails when there are no transcripts at all', () => {
    expect(checks.checkTranscriptErrors([])).toMatchObject({ ok: false, hard: true });
  });

  it('reviews-by-reviewer passes a review by reviewer and fails a general-purpose one or none', () => {
    expect(checks.checkReviewsByReviewer(writeTranscripts([delegate([reviewCall('reviewer')])]).transcripts).ok).toBe(true);
    const wrong = checks.checkReviewsByReviewer(writeTranscripts([delegate([reviewCall('general-purpose')])]).transcripts);
    expect(wrong).toMatchObject({ ok: false, reason: expect.stringContaining('review-not-by-reviewer general-purpose') });
    expect(checks.checkReviewsByReviewer(writeTranscripts([delegate([passingReads()[0]])]).transcripts).ok).toBe(false);
    expect(checks.checkReviewsByReviewer(writeTranscripts([{ id: 'r1', type: 'reviewer', lines: [] }]).transcripts).reason).toContain('delegate never ran');
  });

  it('skill-use-gate passes when the required skills were read in full and fails on a missing one', () => {
    expect(checks.checkSkillUseGate(writeTranscripts([delegate(passingReads())]).transcripts).ok).toBe(true);
    const missing = checks.checkSkillUseGate(writeTranscripts([delegate(passingReads().slice(1))]).transcripts);
    expect(missing).toMatchObject({ ok: false, reason: expect.stringContaining('skill-not-read lantern-commit') });
    const partial = passingReads();
    partial[0] = line(toolUse('r1', 'Read', { file_path: skillFile('lantern-commit'), limit: 20 }));
    expect(checks.checkSkillUseGate(writeTranscripts([delegate(partial)]).transcripts).reason).toContain('skill-partly-read lantern-commit');
  });

  it('reviewer-skill-use passes a reviewer that read its required skills in full and fails a partial read, a missing skill or no reviewer', () => {
    const reviewerReads = () => [
      line(toolUse('v1', 'Read', { file_path: skillFile('lantern-no-comments') })),
      line(toolUse('v2', 'Read', { file_path: skillFile('lantern-code-reviewer') })),
    ];
    const reviewer = (lines: string[]) => ({ id: 'r1', type: 'reviewer', lines });
    expect(checks.checkReviewerSkillUse(writeTranscripts([reviewer(reviewerReads())]).transcripts).ok).toBe(true);
    const missing = checks.checkReviewerSkillUse(writeTranscripts([reviewer(reviewerReads().slice(1))]).transcripts);
    expect(missing).toMatchObject({ ok: false, reason: 'skill-not-read lantern-no-comments' });
    const partial = [reviewerReads()[0], line(toolUse('v3', 'Read', { file_path: skillFile('lantern-code-reviewer'), limit: 30 }))];
    expect(checks.checkReviewerSkillUse(writeTranscripts([reviewer(partial)]).transcripts).reason).toBe('skill-partly-read lantern-code-reviewer');
    expect(checks.checkReviewerSkillUse(writeTranscripts([delegate(passingReads())]).transcripts)).toMatchObject({ ok: false, reason: 'no reviewer transcript found' });
  });

  describe('delegate and orchestrator extras', () => {
    const brief = (text: string) => JSON.stringify({ type: 'user', message: { role: 'user', content: text } });
    const EXTRA = EXTRA_SKILL.name;
    const ORCH = ORCH_EXTRA_SKILL.name;
    const withBrief = (text: string, reads: string[] = passingReads()) => delegate([brief(text), ...reads]);
    const extraRead = line(toolUse('x1', 'Read', { file_path: skillFile(EXTRA) }));
    const orchRead = (input: object = {}) => line(toolUse('o1', 'Read', { file_path: skillFile(ORCH), ...input }));
    const orchestrator = (lines: string[]) => ({ id: 'o1', type: 'orchestrator', lines });

    it('extra-read-in-full passes a full read and fails a partial one or none', () => {
      const full = writeTranscripts([withBrief('Task\nVerify: npm test', [...passingReads(), extraRead])]).transcripts;
      expect(checks.checkExtraReadInFull(full, [EXTRA])).toMatchObject({ ok: true, hard: true });
      const partial = line(toolUse('x1', 'Read', { file_path: skillFile(EXTRA), limit: 5 }));
      const part = checks.checkExtraReadInFull(writeTranscripts([withBrief('Task\nVerify: npm test', [...passingReads(), partial])]).transcripts, [EXTRA]);
      expect(part).toMatchObject({ ok: false, reason: `skill-partly-read ${EXTRA}` });
      const none = checks.checkExtraReadInFull(writeTranscripts([withBrief('Task\nVerify: npm test')]).transcripts, [EXTRA]);
      expect(none).toMatchObject({ ok: false, reason: `skill-not-read ${EXTRA}` });
    });

    it('extra-read-in-full does not blame the extra for a missing required skill', () => {
      const t = writeTranscripts([withBrief('Task\nVerify: npm test', [extraRead])]).transcripts;
      expect(checks.checkExtraReadInFull(t, [EXTRA]).ok).toBe(true);
    });

    it('orch-extra-read-in-full passes the orchestrator full read and fails a partial read, none, or no orchestrator', () => {
      const pass = writeTranscripts([orchestrator([orchRead()]), withBrief('x')]).transcripts;
      expect(checks.checkOrchExtraReadInFull(pass, [ORCH])).toMatchObject({ ok: true, hard: true, name: 'orch-extra-read-in-full' });
      const partial = checks.checkOrchExtraReadInFull(writeTranscripts([orchestrator([orchRead({ offset: 3 })])]).transcripts, [ORCH]);
      expect(partial).toMatchObject({ ok: false, reason: `skill-partly-read ${ORCH}` });
      const none = checks.checkOrchExtraReadInFull(writeTranscripts([orchestrator([line(toolUse('b', 'Bash', { command: 'ls' }))])]).transcripts, [ORCH]);
      expect(none).toMatchObject({ ok: false, reason: `skill-not-read ${ORCH}` });
      expect(checks.checkOrchExtraReadInFull(writeTranscripts([withBrief('x')]).transcripts, [ORCH]).reason).toContain('no orchestrator');
    });

    it('orch-extra-read-in-full accepts a full cat and ignores a delegate read', () => {
      const cat = line(toolUse('c', 'Bash', { command: `cat .claude/skills/${ORCH}/SKILL.md` }));
      expect(checks.checkOrchExtraReadInFull(writeTranscripts([orchestrator([cat])]).transcripts, [ORCH]).ok).toBe(true);
      const delegateRead = delegate([line(toolUse('d', 'Read', { file_path: skillFile(ORCH) }))]);
      expect(checks.checkOrchExtraReadInFull(writeTranscripts([orchestrator([]), delegateRead]).transcripts, [ORCH]).ok).toBe(false);
    });

    it('orch-extra-not-in-brief passes a brief that leaves the orchestrator extra out and fails one that names it', () => {
      const clean = writeTranscripts([withBrief(`Task\nVerify: npm test`)]).transcripts;
      expect(checks.checkOrchExtraNotInBrief(clean, [ORCH])).toMatchObject({ ok: true, hard: true, name: 'orch-extra-not-in-brief' });
      const leaked = checks.checkOrchExtraNotInBrief(writeTranscripts([withBrief(`Task\nUse ${ORCH}`)]).transcripts, [ORCH]);
      expect(leaked).toMatchObject({ ok: false, reason: expect.stringContaining(ORCH) });
      const skillsLine = checks.checkOrchExtraNotInBrief(writeTranscripts([withBrief(`Skills: /x/${ORCH}`)]).transcripts, [ORCH]);
      expect(skillsLine.ok).toBe(false);
      expect(checks.checkOrchExtraNotInBrief(writeTranscripts([orchestrator([])]).transcripts, [ORCH]).reason).toContain('delegate never ran');
    });

    it('skill-use-gate with the project extras is green when the delegate read them with no line in the brief, red when it did not', () => {
      const read = writeTranscripts([withBrief('no line here', [...passingReads(), extraRead])]).transcripts;
      expect(checks.checkSkillUseGate(read, [EXTRA]).ok).toBe(true);
      const unread = writeTranscripts([withBrief('no line here')]).transcripts;
      expect(checks.checkSkillUseGate(unread, [EXTRA])).toMatchObject({ ok: false, reason: `skill-not-read ${EXTRA}` });
    });

    it('skill-use-gate with a switched-off skill does not demand it, and still demands the others', () => {
      const withoutCommit = writeTranscripts([withBrief('x', passingReads().slice(1))]).transcripts;
      expect(checks.checkSkillUseGate(withoutCommit, [], ['lantern-commit']).ok).toBe(true);
      expect(checks.checkSkillUseGate(withoutCommit, []).ok).toBe(false);
      const withoutBoth = writeTranscripts([withBrief('x', passingReads().slice(2))]).transcripts;
      expect(checks.checkSkillUseGate(withoutBoth, [], ['lantern-commit'])).toMatchObject({ ok: false, reason: 'skill-not-read lantern-no-comments' });
    });

    it('off-skill-not-read is informational: green when the delegate left the switched-off skill alone, red-but-soft when it read it in full', () => {
      const left = writeTranscripts([withBrief('x', passingReads().slice(1))]).transcripts;
      expect(checks.checkOffSkillNotRead(left, ['lantern-commit'])).toMatchObject({ ok: true, hard: false, name: 'off-skill-not-read' });
      const read = writeTranscripts([withBrief('x', passingReads())]).transcripts;
      expect(checks.checkOffSkillNotRead(read, ['lantern-commit'])).toMatchObject({ ok: false, hard: false, reason: expect.stringContaining('lantern-commit') });
      expect(checks.checkOffSkillNotRead(writeTranscripts([orchestrator([])]).transcripts, ['lantern-commit'])).toMatchObject({ ok: false, hard: false });
    });

    it('skills-dir-clean accepts the project extras as folders and fails when one is missing', () => {
      const bundled = ['lantern-setup', 'lantern-sync', 'lantern-delegate', 'lantern-commit', 'lantern-no-comments', 'lantern-local-loop'].map((name) => ({ name, kind: 'dir' }));
      const entries = [...bundled, { name: EXTRA, kind: 'dir' }, { name: ORCH, kind: 'dir' }];
      expect(checks.checkSkillsDir(entries, [EXTRA, ORCH]).ok).toBe(true);
      expect(checks.checkSkillsDir(entries).ok).toBe(false);
      expect(checks.checkSkillsDir(bundled, [EXTRA]).reason).toContain(`${EXTRA} is missing`);
    });
  });

  it('command-lint-ratio is informational and compares the violation share to the limit', () => {
    const clean = [line(toolUse('b1', 'Bash', { command: 'git status' })), line(toolUse('b2', 'Bash', { command: 'ls' }))];
    const okRes = checks.checkCommandLint(writeTranscripts([delegate(clean)]).transcripts);
    expect(okRes).toMatchObject({ ok: true, hard: false });
    const bad = [line(toolUse('b1', 'Bash', { command: 'git status && git log' })), line(toolUse('b2', 'Bash', { command: 'ls; ls' }))];
    expect(checks.checkCommandLint(writeTranscripts([delegate(bad)]).transcripts)).toMatchObject({ ok: false, hard: false });
  });

  describe('reviewer-unavailable', () => {
    const verdict = (text: string) => ({ id: 'r1', type: 'reviewer', lines: [assistant(text)] });
    const python = { language: 'Python' };

    it('passes a verdict that says UNAVAILABLE with no Python convention and cites no other rules', () => {
      const text = 'UNAVAILABLE: no Python convention available (not applying TypeScript rules)\nVERDICT: merge\nBLOCKING: 0';
      expect(checks.checkReviewerUnavailable(writeTranscripts([verdict(text)]).transcripts, python)).toMatchObject({ ok: true, hard: true });
    });

    it('fails a verdict without UNAVAILABLE, with another language cited, or with no reviewer at all', () => {
      const missing = checks.checkReviewerUnavailable(writeTranscripts([verdict('VERDICT: merge')]).transcripts, python);
      expect(missing.ok).toBe(false);
      const cited = 'UNAVAILABLE: no Python convention available\nBlocking: violates the Biome rule noExplicitAny and the Zod schema naming\nVERDICT: merge';
      expect(checks.checkReviewerUnavailable(writeTranscripts([verdict(cited)]).transcripts, python).reason).toContain('cites');
      expect(checks.checkReviewerUnavailable(writeTranscripts([delegate(passingReads())]).transcripts, python).reason).toContain('no reviewer transcript');
    });

    it('judges the latest reviewer round and is informational for plain JavaScript', () => {
      const first = verdict('VERDICT: merge');
      const last = { id: 'r2', type: 'reviewer', lines: [assistant('UNAVAILABLE: no JavaScript convention available\nVERDICT: merge')] };
      const { transcripts } = writeTranscripts([first, last]);
      transcripts.find((t: { agentId: string }) => t.agentId === 'r2').mtimeMs += 1000;
      expect(checks.checkReviewerUnavailable(transcripts, { language: 'JavaScript' })).toMatchObject({ ok: true, hard: false });
      expect(checks.checkReviewerUnavailable(writeTranscripts([first]).transcripts, { language: 'JavaScript' })).toMatchObject({ ok: false, hard: false });
    });

    it('reads a verdict delivered through SubagentHandback instead of a final text block', () => {
      const handback = (message: string) => JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [toolUse('h1', 'SubagentHandback', { message })] } });
      const text = 'VERDICT: merge\nBLOCKING: 0\nUNAVAILABLE: no Python convention available';
      const reviewer = { id: 'r1', type: 'reviewer', lines: [assistant('Reading the diff.'), handback(text)] };
      expect(checks.checkReviewerUnavailable(writeTranscripts([reviewer]).transcripts, python)).toMatchObject({ ok: true, hard: true });
    });

    it('finds the last assistant text and foreign-convention citations', () => {
      expect(checks.finalAssistantText([assistant('one'), assistant('two'), line(toolUse('x', 'Bash', {}))].join('\n'))).toBe('two');
      expect(checks.citesForeignConvention('uses Biome formatting\nno TypeScript rules apply')).toEqual(['uses Biome formatting']);
      const listed = 'CONVENTIONS: team-conventions, lantern-no-comments, typescript, biome, lantern-commit';
      expect(checks.citesForeignConvention(listed)).toEqual([listed]);
      expect(checks.citesForeignConvention("I didn't apply TypeScript rules")).toEqual([]);
      expect(checks.citesForeignConvention('CONVENTIONS: team-conventions, lantern-no-comments, lantern-commit')).toEqual([]);
    });
  });

  it('session-finished and no-permission-denials judge the orchestrator result', () => {
    const good = { type: 'result', subtype: 'success', is_error: false, permission_denials: [], num_turns: 4 };
    expect(checks.checkSessionFinished(good).ok).toBe(true);
    expect(checks.checkSessionFinished({ ...good, is_error: true }).ok).toBe(false);
    expect(checks.checkSessionFinished({ ...good, subtype: 'error_max_budget_usd' }).ok).toBe(false);
    expect(checks.checkSessionFinished(null).ok).toBe(false);
    expect(checks.checkNoPermissionDenials(good).ok).toBe(true);
    expect(checks.checkNoPermissionDenials({ ...good, permission_denials: [{ tool_name: 'Bash' }] })).toMatchObject({ ok: false, reason: expect.stringContaining('Bash') });
    expect(checks.checkNoPermissionDenials({}).ok).toBe(false);
  });
});

describe('isolated home and the extras variant', () => {
  const realHomeWith = (config: object | null) => {
    const home = tmp('real-home-');
    fs.mkdirSync(path.join(home, 'Library'));
    if (config) {
      fs.mkdirSync(path.join(home, '.claude'));
      fs.writeFileSync(path.join(home, '.claude', 'lantern-extensions.json'), JSON.stringify(config));
    }
    return home;
  };
  const extrasProject = PROJECTS.find((p: { name: string }) => extrasOf(p).length > 0)!;
  const plainProject = PROJECTS.find((p: { name: string }) => extrasOf(p).length === 0)!;

  it('gives exactly one project a delegate extra and an orchestrator extra, and the rest none', () => {
    expect(PROJECTS.filter((p: object) => extrasOf(p).length > 0)).toHaveLength(1);
    expect(extrasOf(extrasProject)).toEqual([EXTRA_SKILL.name]);
    expect(orchestratorExtrasOf(extrasProject)).toEqual([ORCH_EXTRA_SKILL.name]);
    expect(PROJECTS.filter((p: object) => orchestratorExtrasOf(p).length > 0)).toHaveLength(1);
  });

  it('switches one built-in skill off for the delegate of exactly one project and writes it to that isolated home only', () => {
    const offProjects = PROJECTS.filter((p: object) => offOf(p).length > 0);
    expect(offProjects).toHaveLength(1);
    expect(offOf(offProjects[0])).toEqual(['lantern-local-loop']);
    const realHome = realHomeWith(null);
    const home = createIsolatedHome({ root: tmp(), project: offProjects[0], dir: tmp(), realHome });
    expect(readSwitchedOff(home)).toEqual({ delegate: ['lantern-local-loop'], orchestrator: [], reviewer: [] });
    const untouched = PROJECTS.find((p: object) => offOf(p).length === 0 && extrasOf(p).length === 0)!;
    const other = createIsolatedHome({ root: tmp(), project: untouched, dir: tmp(), realHome });
    expect(readSwitchedOff(other)).toEqual({ delegate: [], orchestrator: [], reviewer: [] });
  });

  it('writes the neutral skills into the project skills folder', () => {
    const dir = tmp();
    writeExtraSkills(dir, [EXTRA_SKILL.name, ORCH_EXTRA_SKILL.name]);
    for (const skill of [EXTRA_SKILL, ORCH_EXTRA_SKILL]) {
      const text = fs.readFileSync(path.join(dir, '.claude', 'skills', skill.name, 'SKILL.md'), 'utf8');
      expect(text).toContain(`name: ${skill.name}`);
    }
    expect(() => writeExtraSkills(dir, ['nope'])).toThrow('unknown extra skill');
  });

  it('builds a home whose config holds the extras and the real linker, with the real config untouched', () => {
    const realHome = realHomeWith({ skillLinker: '/somewhere/linker', delegate: ['real-one'], orchestrator: ['real-two'] });
    const realFile = path.join(realHome, '.claude', 'lantern-extensions.json');
    const before = fs.readFileSync(realFile, 'utf8');
    const home = createIsolatedHome({ root: tmp(), project: extrasProject, dir: tmp(), realHome });
    expect(home).not.toContain(realHome);
    expect(readExtensions(home)).toEqual({ delegate: [EXTRA_SKILL.name], orchestrator: [ORCH_EXTRA_SKILL.name], reviewer: [] });
    expect(readSkillLinker(home)).toBe('/somewhere/linker');
    expect(fs.readFileSync(realFile, 'utf8')).toBe(before);
    expect(fs.lstatSync(path.join(home, 'Library')).isSymbolicLink()).toBe(true);
    expect(fs.existsSync(path.join(home, '.claude', 'skills'))).toBe(false);
  });

  it('gives a project without extras empty slots, and survives a missing or damaged real config', () => {
    for (const realHome of [realHomeWith(null), realHomeWith({ delegate: 'not a list' })]) {
      const home = createIsolatedHome({ root: tmp(), project: plainProject, dir: tmp(), realHome });
      expect(readExtensions(home)).toEqual({ delegate: [], orchestrator: [], reviewer: [] });
      expect(readSkillLinker(home)).toBeNull();
    }
  });

  it('gives the home the delegate permissions the preflight gate reads from the home settings, which the real home no longer supplies', () => {
    const realHome = realHomeWith(null);
    const dir = tmp();
    const home = createIsolatedHome({ root: tmp(), project: plainProject, dir, realHome });
    const files = settingsFiles([dir], home);
    expect(missingPermissions(files, requiredAllow(defaultSkillRoots(dir, home)))).toEqual([]);
    expect(missingPermissions(settingsFiles([dir], realHome), requiredAllow(defaultSkillRoots(dir, realHome))).length).toBeGreaterThan(0);
  });

  it('puts the isolated HOME in the session environment and finds the transcripts there', () => {
    expect(sessionEnv({ HOME: '/real', PATH: '/bin', CLAUDECODE: '1' }, '/iso')).toEqual({ HOME: '/iso', PATH: '/bin' });
    expect(sessionEnv({ HOME: '/real' }, undefined)).toEqual({ HOME: '/real' });
    expect(transcriptsHome({ home: '/iso' }, '/fallback')).toBe(path.join('/iso', '.claude', 'projects'));
    expect(transcriptsHome({}, '/fallback')).toBe('/fallback');
  });

  it('creates a workspace where every project has its own home and only the variant project has extras', async () => {
    const realHome = realHomeWith({ delegate: ['real-one'] });
    const installed: [string, string][] = [];
    const ws = await createWorkspace(PROJECTS, { install: (dir: string, home: string) => installed.push([dir, home]), projectsHome: tmp('claude-home-'), realHome });
    cleanups.push(() => disposeWorkspace(ws, { keep: false, projectsHome: tmp('claude-home-') }));
    expect(new Set(ws.projects.map((p: { home: string }) => p.home)).size).toBe(PROJECTS.length);
    for (const p of ws.projects) {
      const skills = fs.existsSync(path.join(p.dir, '.claude', 'skills')) ? fs.readdirSync(path.join(p.dir, '.claude', 'skills')) : [];
      expect(skills.includes(EXTRA_SKILL.name)).toBe(extrasOf(p).length > 0);
      expect(readExtensions(p.home).delegate).toEqual(extrasOf(p));
      expect(readExtensions(p.home).orchestrator).toEqual(orchestratorExtrasOf(p));
    }
    expect(installed).toEqual(ws.projects.map((p: { dir: string; home: string }) => [p.dir, p.home]));
  }, 60000);

  it('fingerprints the real config and fails the report when it changed', () => {
    const file = path.join(tmp(), 'cfg.json');
    expect(report.fingerprintFile(file)).toBe('absent');
    fs.writeFileSync(file, 'a');
    const before = report.fingerprintFile(file);
    expect(before).toMatch(/^[0-9a-f]{40}$/);
    const rows = report.buildReport({ startedAt: 't', capUsd: 12, projects: [{ name: 'p', checks: [], setupCostUsd: 0, runCostUsd: 0 }], aborted: null });
    expect(rows.passed).toBe(true);
    const same = report.withConfigGuard(rows, { file, before, after: report.fingerprintFile(file) });
    expect(same).toMatchObject({ passed: true, realConfig: { unchanged: true } });
    expect(report.renderReport(same)).toContain(`sha1 before ${before}, after ${before}: unchanged`);
    fs.writeFileSync(file, 'b');
    const changed = report.withConfigGuard(rows, { file, before, after: report.fingerprintFile(file) });
    expect(changed).toMatchObject({ passed: false, realConfig: { unchanged: false } });
    expect(report.renderReport(changed)).toContain('real extensions config changed');
  });

  it('lists the variant and the checks in the plan', () => {
    const { text } = renderPlan({ env: {}, projects: selectProjects(null), claudeBin: 'claude' });
    for (const name of ['extra-read-in-full', 'orch-extra-read-in-full', 'orch-extra-not-in-brief', 'off-skill-not-read', 'delegate off: lantern-local-loop', EXTRA_SKILL.name, ORCH_EXTRA_SKILL.name]) expect(text).toContain(name);
  });
});

describe('transcript cleanup', () => {
  it('removes only the folders of the temp project and nothing else', () => {
    const home = tmp('claude-home-');
    const root = path.join(fs.realpathSync(os.tmpdir()), 'lantern-e2e-AbC123');
    const projectDir = path.join(root, 'projects', 'todo-cli');
    const key = projectDir.replace(/[^a-zA-Z0-9]/g, '-');
    const mk = (name: string) => fs.mkdirSync(path.join(home, name), { recursive: true });
    ['-Users-me-GIT-app', `${key}`, `${key}--claude-worktrees-agent-1`, `${key}x-unrelated`, key.replace('todo-cli', 'tiny-api')].forEach(mk);
    const removed = removeTranscripts(home, projectDir, root).map((d: string) => path.basename(d)).sort();
    expect(removed).toEqual([key, `${key}--claude-worktrees-agent-1`].sort());
    expect(fs.readdirSync(home).sort()).toEqual(['-Users-me-GIT-app', key.replace('todo-cli', 'tiny-api'), `${key}x-unrelated`].sort());
  });

  it('never removes anything for a root that does not appear in the folder name', () => {
    const home = tmp('claude-home-');
    const projectDir = '/Users/me/GIT/app';
    fs.mkdirSync(path.join(home, '-Users-me-GIT-app'));
    expect(removeTranscripts(home, projectDir, '/tmp/lantern-e2e-ZZZ')).toEqual([]);
    expect(fs.existsSync(path.join(home, '-Users-me-GIT-app'))).toBe(true);
  });
});

describe('child process safety', () => {
  it('stops a real child by its own pid', async () => {
    const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], { stdio: 'ignore' });
    const exited = new Promise((resolve) => child.once('exit', resolve));
    expect(child.pid).toBeGreaterThan(1);
    expect(stopChild(child)).toBe(true);
    await exited;
    expect(stopChild(child)).toBe(false);
  });

  it.each([1, 0, -1, undefined, 1.5])('never signals pid %s', (pid) => {
    const kill = vi.fn();
    expect(stopChild({ pid, kill, exitCode: null, signalCode: null })).toBe(false);
    expect(kill).not.toHaveBeenCalled();
  });
});

describe('cost accounting and the cap', () => {
  const resultLine = (cost: number | null, extra: object = {}) => JSON.stringify({ type: 'result', subtype: 'success', is_error: false, ...(cost === null ? {} : { total_cost_usd: cost }), ...extra });
  const stream = [JSON.stringify({ type: 'system' }), JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: '"result"' }] } }), resultLine(1.25), 'not json "result"', resultLine(0.75)].join('\n');

  it('parses only result lines and sums total_cost_usd, ignoring a missing figure', () => {
    const results = report.parseResultLines(stream);
    expect(results).toHaveLength(2);
    expect(report.sumCost(results)).toBeCloseTo(2);
    expect(report.sumCost(report.parseResultLines(resultLine(null)))).toBe(0);
  });

  it('reads the cap from E2E_MAX_USD and rejects nonsense', () => {
    expect(report.resolveCap({})).toBe(12);
    expect(report.resolveCap({ E2E_MAX_USD: '5.5' })).toBe(5.5);
    for (const bad of ['abc', '0', '-3']) expect(() => report.resolveCap({ E2E_MAX_USD: bad })).toThrow(/E2E_MAX_USD/);
  });

  it('derives per-call budgets whose worst case never passes the cap', () => {
    for (const cap of [3, 7.5, 12, 40]) {
      const b = report.planBudgets(cap, 4);
      expect(b.setup).toBeGreaterThan(0);
      expect(4 * (b.setup + b.run)).toBeLessThanOrEqual(cap + 1e-9);
    }
  });

  it('flags a spend over the cap and equal to the cap is fine', () => {
    expect(report.capExceeded(12.01, 12)).toBe(true);
    expect(report.capExceeded(12, 12)).toBe(false);
  });

  const passing = { name: 'a', setupCostUsd: 0.5, runCostUsd: 1.5, checks: [checks.result('x', true, 'fine')] };
  const failing = { name: 'b', setupCostUsd: 0.5, runCostUsd: 1, checks: [checks.result('one-open-pr', false, '0 open PR(s)'), checks.result('soft', false, 'meh', false)] };

  it('builds a passing report only when every hard check passes and the cost is under the cap', () => {
    const ok = report.buildReport({ startedAt: 't', capUsd: 12, projects: [passing] });
    expect(ok).toMatchObject({ passed: true, totalUsd: 2, overCap: false });
    expect(report.exitCodeFor(ok)).toBe(0);
  });

  it('fails on a failed hard check, naming it, but not on a failed informational one', () => {
    const bad = report.buildReport({ startedAt: 't', capUsd: 12, projects: [passing, failing] });
    expect(bad.passed).toBe(false);
    expect(bad.projects[1]).toMatchObject({ passed: false, failed: ['one-open-pr'], costUsd: 1.5 });
    expect(report.exitCodeFor(bad)).toBe(1);
    const softOnly = report.buildReport({ startedAt: 't', capUsd: 12, projects: [{ ...failing, checks: [checks.result('soft', false, 'meh', false)] }] });
    expect(softOnly.passed).toBe(true);
  });

  it('fails when the cost is over the cap or the run was aborted, though every check passed', () => {
    const over = report.buildReport({ startedAt: 't', capUsd: 1, projects: [passing] });
    expect(over).toMatchObject({ passed: false, overCap: true });
    expect(report.renderReport(over)).toContain('CAP EXCEEDED');
    const aborted = report.buildReport({ startedAt: 't', capUsd: 12, projects: [passing], aborted: 'cap' });
    expect(aborted.passed).toBe(false);
    expect(report.buildReport({ startedAt: 't', capUsd: 12, projects: [] }).passed).toBe(false);
  });

  it('renders a table with every check, its verdict and the cost', () => {
    const text = report.renderReport(report.buildReport({ startedAt: 't', capUsd: 12, projects: [passing, failing] }));
    expect(text).toContain('PASS a ($2.00');
    expect(text).toContain('FAIL b ($1.50');
    expect(text).toMatch(/FAIL\s+one-open-pr\s+0 open PR\(s\)/);
    expect(text).toMatch(/WARN\s+soft/);
    expect(text).toContain('total cost $3.50 of cap $12.00');
    expect(text).toContain('RESULT: FAIL (b: one-open-pr)');
  });
});

describe('claude invocation and the runner entry', () => {
  it('builds the headless flags and drops CLAUDECODE from the environment', () => {
    const args = claudeArgs({ prompt: 'p', budgetUsd: 1.5 });
    expect(args).toEqual(expect.arrayContaining(['-p', 'p', '--permission-mode', 'auto', '--setting-sources', 'project,local', '--model', 'sonnet', '--max-budget-usd', '1.5', '--verbose']));
    expect(args[args.indexOf('--output-format') + 1]).toBe('stream-json');
    expect(claudeEnv({ CLAUDECODE: '1', KEEP: 'y' })).toEqual({ KEEP: 'y' });
  });

  it('strips every credential and identity variable of the caller from the session environment', () => {
    const parent = {
      PATH: '/bin',
      HOME: '/h',
      BITBUCKET_API_TOKEN: 'real',
      BITBUCKET_EMAIL: 'me@real',
      GITHUB_TOKEN: 'real',
      GH_TOKEN: 'real',
      ATLASSIAN_EMAIL: 'me@real',
      ATLASSIAN_BASE_URL: 'https://real.atlassian.net',
      GLOBAL_ATLASSIAN_TOKEN: 'real',
      LANTERN_CREDENTIAL_SOURCE: 'lantern',
      LANTERN_CREDENTIAL_PROVIDERS: 'github,jira',
      AGENT_USAGE_REPO: '/real/repo',
      GIT_COMMIT_NAME: 'Me',
      GIT_COMMIT_EMAIL: 'me@real',
      GIT_AUTHOR_NAME: 'Me',
      GIT_COMMITTER_EMAIL: 'me@real',
    };
    expect(claudeEnv(parent)).toEqual({ PATH: '/bin', HOME: '/h' });
  });

  it('answers a timeout with SIGTERM then SIGKILL on its own child and reports an unknown cost', async () => {
    const dir = tmp('fake-claude-');
    const bin = path.join(dir, 'claude');
    fs.writeFileSync(bin, "#!/usr/bin/env node\nprocess.on('SIGTERM', () => {});\nsetInterval(() => {}, 1000);\n", { mode: 0o755 });
    const started = Date.now();
    const session = await runClaude({ bin, cwd: dir, prompt: 'p', budgetUsd: 1, logFile: path.join(dir, 'log.jsonl'), timeoutMs: 300, killGraceMs: 300, children: new Set() });
    expect(session).toMatchObject({ timedOut: true, result: null, costKnown: false });
    expect(Date.now() - started).toBeLessThan(10000);
  }, 20000);

  it('knows the cost of a session that printed its result line', async () => {
    const dir = tmp('fake-claude-');
    const bin = path.join(dir, 'claude');
    fs.writeFileSync(bin, `#!/usr/bin/env node\nconsole.log(JSON.stringify({ type: 'result', total_cost_usd: 0.5 }));\n`, { mode: 0o755 });
    const session = await runClaude({ bin, cwd: dir, prompt: 'p', budgetUsd: 1, logFile: path.join(dir, 'log.jsonl'), timeoutMs: 10000, children: new Set() });
    expect(session).toMatchObject({ timedOut: false, costKnown: true });
  });

  it('reports a lower bound, never an exact figure, when a session gave no result line', () => {
    const ok = { name: 'a', setupCostUsd: 0.5, runCostUsd: 1.5, checks: [checks.result('x', true, 'fine')] };
    const rep = report.buildReport({ startedAt: 't', capUsd: 12, projects: [{ ...ok, costUnknown: true }] });
    expect(rep.costLowerBound).toBe(true);
    const text = report.renderReport(rep);
    expect(text).toContain('>= $2.00');
    expect(text).toContain('real cost is unknown');
    expect(report.buildReport({ startedAt: 't', capUsd: 12, projects: [ok] }).costLowerBound).toBe(false);
  });

  it('parses arguments and rejects unknown ones and unknown project names', () => {
    expect(parseArgs(['--', '--yes', '--keep', '--only', 'pyutil,rubyutil'], {})).toMatchObject({ yes: true, keep: true, only: ['pyutil', 'rubyutil'] });
    expect(parseArgs([], { E2E_YES: '1' }).yes).toBe(true);
    expect(parseArgs([], {}).yes).toBe(false);
    expect(() => parseArgs(['--nope'], {})).toThrow(/unknown argument/);
    expect(selectProjects(null)).toHaveLength(4);
    expect(() => selectProjects(['nope'])).toThrow(/--only/);
  });

  it('prints the plan with projects, checks, the estimate and the cap', () => {
    const { text, cap } = renderPlan({ env: { E2E_MAX_USD: '9' }, projects: selectProjects(null), claudeBin: 'claude' });
    expect(cap).toBe(9);
    for (const p of PROJECTS) expect(text).toContain(p.name);
    for (const name of ['one-open-pr', 'sync-verify-green', 'skill-use-gate']) expect(text).toContain(name);
    expect(text).toContain('estimated cost');
    expect(text).toContain('cost cap: $9.00');
  });

  const capture = () => {
    const out: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...a) => void out.push(a.join(' ')));
    vi.spyOn(console, 'error').mockImplementation((...a) => void out.push(a.join(' ')));
    return out;
  };

  it('dry run exits 0 without spawning claude', async () => {
    const out = capture();
    expect(await main(['--dry-run'], { CLAUDE_BIN: '/definitely/not/claude' })).toBe(0);
    expect(out.join('\n')).toContain('no claude session was started');
  });

  it('refuses to start without --yes and spends nothing', async () => {
    const out = capture();
    expect(await main([], { CLAUDE_BIN: '/definitely/not/claude' })).toBe(2);
    expect(out.join('\n')).toContain('Pass --yes');
  });

  it('exits 2 on a bad argument and when the claude binary cannot run', async () => {
    capture();
    expect(await main(['--nope'], {})).toBe(2);
    expect(await main(['--yes'], { CLAUDE_BIN: '/definitely/not/claude' })).toBe(2);
  });
});

describe('a failing workspace setup', () => {
  const alive = (pid: number) => {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  };

  it('stops the mock child and removes the temp root when a later step throws', async () => {
    const holder: { ws?: { root: string; mock: { child: { pid: number } } } } = {};
    const install = () => {
      throw new Error('install exploded');
    };
    await expect(createWorkspace([PROJECTS[0]], { holder, install, projectsHome: tmp('claude-home-'), realHome: tmp('real-home-') })).rejects.toThrow('install exploded');
    const ws = holder.ws!;
    expect(fs.existsSync(ws.root)).toBe(false);
    const pid = ws.mock.child.pid;
    await vi.waitFor(() => expect(alive(pid)).toBe(false), { timeout: 5000 });
  });

  it('runLive cleans up, rethrows and leaves no signal handlers behind', async () => {
    const before = [process.listenerCount('SIGINT'), process.listenerCount('SIGTERM')];
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const install = () => {
      throw new Error('boom');
    };
    const plan = { cap: 12, budgets: { setup: 1, run: 2 } };
    await expect(runLive({ opts: { keep: false }, projects: [PROJECTS[0]], bin: 'claude', plan, workspaceOptions: { install, projectsHome: tmp('claude-home-'), realHome: tmp('real-home-') } })).rejects.toThrow('boom');
    expect(spy).toHaveBeenCalled();
    expect([process.listenerCount('SIGINT'), process.listenerCount('SIGTERM')]).toEqual(before);
  });
});

describe('the runner against a fake claude', () => {
  function fakeClaude(costUsd: number) {
    const file = path.join(tmp('fake-claude-'), 'claude');
    fs.writeFileSync(
      file,
      `#!/usr/bin/env node\nconsole.log(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, total_cost_usd: ${costUsd}, permission_denials: [], result: 'done' }));\n`,
      { mode: 0o755 },
    );
    return file;
  }

  async function execute(costUsd: number, cap: number) {
    const ws = await createWorkspace([PROJECTS[0]], { realHome: tmp('real-home-') });
    cleanups.push(() => disposeWorkspace(ws, { keep: false, projectsHome: tmp('claude-home-') }));
    const budgets = report.planBudgets(cap, 1);
    const log = vi.fn();
    const rep = await executeAll({ ws, cap, budgets, bin: fakeClaude(costUsd), children: new Set(), sinceMs: Date.now(), startedAt: 't', projectsHome: tmp('claude-home-'), log });
    return { rep, ws, log };
  }

  it('stops before the orchestrator phase and fails when the map builds already pass the cap', async () => {
    const { rep, log } = await execute(20, 12);
    expect(rep).toMatchObject({ passed: false, overCap: true, totalUsd: 20 });
    expect(rep.aborted).toContain('cost cap exceeded');
    const names = rep.projects[0].checks.map((c: { name: string }) => c.name);
    expect(names).toEqual(['map-build-session', 'session-finished']);
    expect(log.mock.calls.flat().join('\n')).not.toContain('phase 2');
  }, 60000);

  it('runs both phases and reports the failed checks when nothing opened a pull request', async () => {
    const { rep, log } = await execute(0.01, 12);
    expect(log.mock.calls.flat().join('\n')).toContain('phase 2');
    expect(rep.passed).toBe(false);
    expect(rep.totalUsd).toBeCloseTo(0.02);
    const failed = rep.projects[0].failed;
    expect(failed).toEqual(expect.arrayContaining(['map-pushed', 'one-open-pr', 'sync-verify-green', 'panel-sees-pr', 'reviews-by-reviewer']));
    expect(rep.projects[0].checks.find((c: { name: string }) => c.name === 'map-build-session').ok).toBe(true);
  }, 60000);
});
