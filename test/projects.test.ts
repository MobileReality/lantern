import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { git } from './helpers/git-repo';

const userData = vi.hoisted(() => {
  const o = require('node:os');
  const p = require('node:path');
  const f = require('node:fs');
  return f.mkdtempSync(p.join(o.tmpdir(), 'ccm-ud-'));
});
vi.mock('electron', () => ({ app: { getPath: () => userData } }));

let state: typeof import('../src/main/state');
let projects: typeof import('../src/main/projects');
let settings: typeof import('../src/main/settings');
let tmp: string;

beforeEach(async () => {
  vi.resetModules();
  snapshots.clear();
  state = await import('../src/main/state');
  projects = await import('../src/main/projects');
  settings = await import('../src/main/settings');
  fs.rmSync(path.join(userData, 'ccm-projects.json'), { force: true });
  fs.rmSync(path.join(userData, 'ccm-settings.json'), { force: true });
  projects.load();
  settings.load();
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ccm-proj-'));
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

const snapshots = new Map<string, { id: string; provider: 'claude'; sessionId: string; cwd: string; kind: 'interactive'; state: 'running'; startedAt: number; waitingFor: string }>();
const startIn = (id: string, cwd: string) => {
  snapshots.set(id, { id, provider: 'claude', sessionId: id, cwd, kind: 'interactive', state: 'running', startedAt: Date.now(), waitingFor: '' });
  state.reconcile([...snapshots.values()]);
};

function gitRepo(name: string) {
  const dir = path.join(tmp, name);
  fs.mkdirSync(path.join(dir, '.git'), { recursive: true });
  return dir;
}

describe('aggregateState', () => {
  const g = (states: string[]) => ({
    name: 'x',
    path: '/x',
    sessions: states.map((s, i) => ({ id: `${i}`, state: s, updatedAt: 0, lastMessage: '', createdAt: 0 })),
  });

  it('prefers the most actionable state by priority', () => {
    expect(projects.aggregateState(g(['running', 'permission', 'done']))).toBe('permission');
    expect(projects.aggregateState(g(['running', 'done']))).toBe('done');
    expect(projects.aggregateState(g(['running']))).toBe('running');
  });

  it('reports open when there are no sessions', () => {
    expect(projects.aggregateState(g([]))).toBe('open');
  });
});

describe('groups', () => {
  it('lists manual and session-derived projects, sorted by name', () => {
    projects.add('/Users/me/alpha');
    startIn('s1', '/Users/me/beta');
    expect(projects.groups().map((x) => x.name)).toEqual(['alpha', 'beta']);
  });

  it('groups subdir and worktree sessions under the opened project', () => {
    projects.add('/Users/me/repo');
    startIn('s1', '/Users/me/repo');
    startIn('s2', '/Users/me/repo/src');
    startIn('s3', '/Users/me/repo/.claude/worktrees/feature');
    const list = projects.groups();
    expect(list.map((x) => x.path)).toEqual(['/Users/me/repo']);
    expect(list[0].sessions).toHaveLength(3);
  });

  it('collapses a subdir session of an unopened repo into its checkout', () => {
    const repo = gitRepo('app');
    startIn('s1', path.join(repo, 'src'));
    startIn('s2', repo);
    const list = projects.groups();
    expect(list.map((x) => x.path)).toEqual([repo]);
    expect(list[0].sessions).toHaveLength(2);
  });

  it('does not pull unopened projects into a session running in an ancestor folder', () => {
    const foo = path.join(tmp, 'foo');
    fs.mkdirSync(foo);
    startIn('home', tmp);
    startIn('s1', foo);
    expect(projects.groups().map((x) => x.path).sort()).toEqual([foo, tmp].sort());
  });

  it('keeps unrelated folders that share a name apart', () => {
    startIn('s1', '/work/app');
    startIn('s2', '/other/app');
    expect(projects.groups().map((x) => x.path)).toEqual(['/other/app', '/work/app']);
  });

  it('omits a project the user has hidden', () => {
    projects.add('/Users/me/alpha');
    projects.hide('/Users/me/alpha');
    expect(projects.groups()).toHaveLength(0);
  });
});

describe('groups — status placeholder', () => {
  const pollRows = (project: string) => projects.groups().find((group) => group.path === project)?.sessions.map((row) => [row.id, row.state]);

  it('shows a status unavailable row for an empty Claude project until a poll succeeds', () => {
    projects.add('/Users/me/claude-app');
    expect(pollRows('/Users/me/claude-app')).toEqual([['__poll__', 'unavailable']]);
    state.reconcile([]);
    expect(pollRows('/Users/me/claude-app')).toEqual([]);
    state.unavailable();
    expect(pollRows('/Users/me/claude-app')).toEqual([['__poll__', 'unavailable']]);
  });

  it('never shows the row for a project set to Codex, even while the Claude poll is unavailable', () => {
    projects.add('/Users/me/codex-app');
    settings.setProvider('/Users/me/codex-app', 'codex');
    expect(state.isAvailable()).toBe(false);
    expect(pollRows('/Users/me/codex-app')).toEqual([]);
  });

  it('keeps Codex sessions listed while the Claude poll is unavailable', () => {
    projects.add('/Users/me/codex-app');
    settings.setProvider('/Users/me/codex-app', 'codex');
    state.mergeDiscovered([{ id: 'thr_12345678', provider: 'codex', cwd: '/Users/me/codex-app', project: 'codex-app', state: 'running', updatedAt: 1 }]);
    state.unavailable();
    expect(pollRows('/Users/me/codex-app')).toEqual([['thr_12345678', 'running']]);
  });

  it('shows the status row for a windowed empty Claude project while the poll is unavailable', () => {
    projects.attach('/Users/me/claude-app');
    expect(pollRows('/Users/me/claude-app')).toEqual([['__poll__', 'unavailable']]);
    projects.detach('/Users/me/claude-app');
  });
});

describe('a project with its own window', () => {
  const saved = () => fs.existsSync(path.join(userData, 'ccm-projects.json')) ? fs.readFileSync(path.join(userData, 'ccm-projects.json'), 'utf8') : '';

  it('is listed while the window is open and gone after it closes, without being saved', () => {
    projects.attach('/Users/me/alpha');
    expect(projects.groups().map((g) => g.path)).toEqual(['/Users/me/alpha']);
    expect(saved()).not.toContain('alpha');
    projects.detach('/Users/me/alpha');
    expect(projects.groups()).toHaveLength(0);
    projects.load();
    expect(projects.groups()).toHaveLength(0);
  });

  it('stays listed even when the user once hid the project', () => {
    projects.add('/Users/me/alpha');
    projects.hide('/Users/me/alpha');
    projects.attach('/Users/me/alpha');
    expect(projects.groups().map((g) => g.path)).toEqual(['/Users/me/alpha']);
    projects.detach('/Users/me/alpha');
    expect(projects.groups()).toHaveLength(0);
  });

  it('collects the sessions started below it', () => {
    projects.attach(tmp);
    startIn('s1', path.join(tmp, 'sub'));
    expect(projects.groups()[0].sessions.map((s) => s.id)).toEqual(['s1']);
    expect(projects.rootForCwd(path.join(tmp, 'sub'))).toBe(tmp);
    projects.detach(tmp);
  });
});

describe('rootForCwd', () => {
  const groupKeys = () => projects.groups().map((g) => g.path);

  it('targets the existing project row for subdir and worktree cwds', () => {
    projects.add('/Users/me/repo');
    for (const cwd of ['/Users/me/repo', '/Users/me/repo/src/lib', '/Users/me/repo/.claude/worktrees/agent-x']) {
      startIn(cwd, cwd);
      expect(projects.rootForCwd(cwd)).toBe('/Users/me/repo');
    }
    expect(groupKeys()).toEqual(['/Users/me/repo']);
  });

  it('matches the sidebar key for a session-only project', () => {
    const repo = gitRepo('app');
    fs.mkdirSync(path.join(repo, 'pkg'));
    startIn('s1', repo);
    startIn('s2', path.join(repo, '.claude', 'worktrees', 'feature'));
    expect(groupKeys()).toEqual([repo]);
    expect(projects.rootForCwd(path.join(repo, '.claude', 'worktrees', 'agent-y'))).toBe(repo);
    expect(projects.rootForCwd(path.join(repo, 'pkg'))).toBe(repo);
  });

  it('does not borrow a same-named project elsewhere', () => {
    startIn('s1', '/work/app');
    expect(projects.rootForCwd('/elsewhere/app')).toBe('/elsewhere/app');
  });

  it('returns the cwd unchanged when no project matches', () => {
    expect(projects.rootForCwd('/unknown/dir')).toBe('/unknown/dir');
  });
});

describe('markOpened', () => {
  it('writes the project meta record', () => {
    projects.markOpened(tmp, 'My Project');
    const meta = JSON.parse(fs.readFileSync(path.join(tmp, '.lantern', '.project', 'project.json'), 'utf8'));
    expect(meta).toMatchObject({ name: 'My Project', path: tmp, managedBy: 'Lantern' });
  });

  it('keeps the record out of git through the folder own ignore file, leaving .gitignore and the exclude alone', () => {
    git(tmp, ['init', '-q', '-b', 'main']);
    projects.markOpened(tmp);
    expect(fs.readFileSync(path.join(tmp, '.lantern', '.project', '.gitignore'), 'utf8')).toBe('*\n');
    expect(git(tmp, ['status', '--porcelain', '--untracked-files=all'])).toBe('');
    expect(fs.existsSync(path.join(tmp, '.gitignore'))).toBe(false);
    expect(fs.existsSync(path.join(tmp, '.git', 'info', 'exclude')) ? fs.readFileSync(path.join(tmp, '.git', 'info', 'exclude'), 'utf8') : '').not.toContain('.lantern');
  });

  it('opens a project a second time without changing the ignore file', () => {
    projects.markOpened(tmp);
    projects.markOpened(tmp);
    expect(fs.readdirSync(path.join(tmp, '.lantern', '.project')).sort()).toEqual(['.gitignore', 'project.json']);
  });
});
