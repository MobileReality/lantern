import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { git, makeTmp, write } from './git-repo';

const REPO = path.join(__dirname, '..', '..');
const SKILLS = path.join(REPO, 'skills');
const FIXTURES = path.join(REPO, 'test', 'fixtures', 'lantern-plans');
const PLAN_SCRIPTS = path.join(SKILLS, 'lantern-plan', 'scripts');
const SYNC_SCRIPT = path.join(SKILLS, 'lantern-sync', 'scripts', 'sync.mjs');
const PLAN_SCRIPT = path.join(PLAN_SCRIPTS, 'plan.mjs');
const EXAMPLE = 'plan-on-the-map';
const DRAFT = 'draft-reader';

const ENV = {
  ...process.env,
  LANTERN_LANG: 'en',
  LANTERN_PROFILE: '',
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_SYSTEM: '/dev/null',
  GIT_AUTHOR_NAME: 'Tester',
  GIT_AUTHOR_EMAIL: 'tester@example.com',
  GIT_COMMITTER_NAME: 'Tester',
  GIT_COMMITTER_EMAIL: 'tester@example.com',
};

interface Run {
  status: number | null;
  stdout: string;
  stderr: string;
}

function runNode(script: string, args: string[], cwd: string): Run {
  const result = spawnSync(process.execPath, [script, ...args], { cwd, env: ENV, encoding: 'utf8' });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

const runPlan = (root: string, ...args: string[]) => runNode(PLAN_SCRIPT, [...args, '--root', root], root);
const runSync = (root: string, ...args: string[]) => runNode(SYNC_SCRIPT, [...args, '--root', root], root);

function planJson<T = unknown>(root: string, ...args: string[]): T {
  const run = runPlan(root, ...args, '--json');
  return JSON.parse(run.stdout) as T;
}

function fixtureText(name: string) {
  return fs.readFileSync(path.join(FIXTURES, `${name}.plan`), 'utf8');
}

function copyDir(from: string, to: string) {
  fs.cpSync(from, to, { recursive: true });
}

function makeProject(plans: string[] = [EXAMPLE]) {
  const root = makeTmp('lantern-plan-');
  copyDir(path.join(FIXTURES, 'project', '.lantern'), path.join(root, '.lantern'));
  for (const name of plans) write(root, `.lantern/plans/${name}.plan`, fixtureText(name));
  git(root, ['init', '-q', '-b', 'main']);
  git(root, ['add', '.']);
  git(root, ['commit', '-q', '-m', 'init']);
  return root;
}

interface RemoteWorld {
  origin: string;
  root: string;
  dir: string;
}

function makeRemoteProject(plans: string[] = [EXAMPLE]): RemoteWorld {
  const dir = makeTmp('lantern-plan-remote-');
  const origin = path.join(dir, 'origin.git');
  const root = path.join(dir, 'project');
  fs.mkdirSync(origin);
  fs.mkdirSync(root);
  git(origin, ['init', '-q', '--bare', '-b', 'main']);
  git(root, ['init', '-q', '-b', 'main']);
  git(root, ['remote', 'add', 'origin', origin]);
  copyDir(path.join(FIXTURES, 'project', '.lantern'), path.join(root, '.lantern'));
  for (const name of plans) write(root, `.lantern/plans/${name}.plan`, fixtureText(name));
  write(root, 'src/main/lantern-prs.ts', 'export {};\n');
  git(root, ['add', '.']);
  git(root, ['commit', '-q', '-m', 'init']);
  git(root, ['push', '-q', '-u', 'origin', 'main']);
  return { origin, root, dir };
}

async function importScript<T = Record<string, unknown>>(name: string): Promise<T> {
  return (await import(pathToFileURL(path.join(PLAN_SCRIPTS, name)).href)) as T;
}

function removeDir(dir: string) {
  fs.rmSync(dir, { recursive: true, force: true });
}

export { DRAFT, EXAMPLE, FIXTURES, PLAN_SCRIPT, PLAN_SCRIPTS, REPO, SKILLS, SYNC_SCRIPT, fixtureText, importScript, makeProject, makeRemoteProject, planJson, removeDir, runNode, runPlan, runSync };
export type { RemoteWorld, Run };
