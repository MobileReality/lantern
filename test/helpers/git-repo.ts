import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const IDENTITY = ['-c', 'user.name=Tester', '-c', 'user.email=tester@example.com', '-c', 'commit.gpgsign=false', '-c', 'init.defaultBranch=main'];

function git(cwd: string, args: string[], date?: string): string {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const name of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE']) delete env[name];
  if (date) Object.assign(env, { GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date });
  return execFileSync('git', [...IDENTITY, ...args], { cwd, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function write(root: string, rel: string, text: string) {
  const file = path.join(root, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}

function commitFile(root: string, rel: string, text: string, message: string, date?: string) {
  write(root, rel, text);
  git(root, ['add', '--', rel]);
  git(root, ['commit', '-q', '-m', message], date);
  return git(root, ['rev-parse', 'HEAD']);
}

interface PrRecordInput {
  id: number | string;
  branch: string;
  head: string;
  base?: string;
  title?: string;
  opened?: string;
  url?: string;
  files?: string[];
}

function prRecord(p: PrRecordInput) {
  const lines = [
    'lantern-pr 1',
    `# ${p.id}`,
    `#title ${p.title ?? `pr ${p.id}`}`,
    `#url ${p.url ?? `https://example.test/pull-requests/${p.id}`}`,
    `#branch ${p.branch}`,
    `#base ${p.base ?? 'main'}`,
    `#opened ${p.opened ?? '2026-09-30'}`,
    `#head ${p.head}`,
    ...(p.files ?? ['~ src/app.ts']),
  ];
  return `${lines.join('\n')}\n`;
}

function commitRecord(root: string, p: PrRecordInput, date?: string) {
  return commitFile(root, `.lantern/prs/${p.id}.pr`, prRecord(p), `record ${p.id}`, date);
}

function makeTmp(prefix: string) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

interface World {
  dir: string;
  origin: string;
  project: string;
}

function makeWorld(): World {
  const dir = makeTmp('ccm-lantern-prs-');
  const origin = path.join(dir, 'origin.git');
  const project = path.join(dir, 'project');
  fs.mkdirSync(origin);
  fs.mkdirSync(project);
  git(origin, ['init', '-q', '--bare', '-b', 'main']);
  git(project, ['init', '-q', '-b', 'main']);
  git(project, ['remote', 'add', 'origin', origin]);
  commitFile(project, 'src/app.ts', 'export {};\n', 'init');
  commitFile(project, '.lantern/map/src.lantern', 'lantern 1\n# src\n\nsrc/app.ts . service 000000000000 | app entry\n', 'map');
  git(project, ['push', '-q', '-u', 'origin', 'main']);
  return { dir, origin, project };
}

function branchOff(root: string, name: string, from = 'main') {
  git(root, ['checkout', '-q', '-b', name, from]);
}

function mergeNoFf(root: string, branch: string, id: number) {
  git(root, ['checkout', '-q', 'main']);
  git(root, ['merge', '-q', '--no-ff', '-m', `Merged in ${branch} (pull request #${id})`, branch]);
}

function squashMerge(root: string, branch: string, id: number) {
  git(root, ['checkout', '-q', 'main']);
  git(root, ['merge', '-q', '--squash', branch]);
  git(root, ['commit', '-q', '-m', `feat: work ${id} (#${id})`]);
}

export { git, write, commitFile, commitRecord, prRecord, makeTmp, makeWorld, branchOff, mergeNoFf, squashMerge };
export type { World, PrRecordInput };
