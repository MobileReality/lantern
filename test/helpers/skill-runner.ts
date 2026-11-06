import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { branchOff, commitFile, git as runGit, makeTmp } from './git-repo';

interface SkillDeps {
  env?: Record<string, string>;
  fetch?: typeof fetch;
  cwd?: string;
  git?: (...args: string[]) => string;
  lantern?: { paths?: string[]; platform?: string; home?: string; username?: string; timeoutMs?: number };
}

interface SkillResult {
  code: number;
  out: string;
  err: string;
}

const SKILLS_ROOT = path.join(__dirname, '..', '..', 'skills');

function sink() {
  let text = '';
  return {
    write(chunk: string) {
      text += chunk;
      return true;
    },
    text: () => text,
  };
}

async function runSkill(skill: string, argv: string[], deps: SkillDeps = {}, root = SKILLS_ROOT): Promise<SkillResult> {
  const cli = await import(pathToFileURL(path.join(root, skill, 'scripts', 'cli.mjs')).href);
  const stdout = sink();
  const stderr = sink();
  const code: number = await cli.run(argv, { env: {}, lantern: { paths: [] }, ...deps, stdout, stderr });
  return { code, out: stdout.text(), err: stderr.text() };
}

const git = (cwd: string, ...args: string[]): string => runGit(cwd, args);

interface HostedRepo {
  dir: string;
  project: string;
  bare: string;
}

function makeHostedRepo(originUrl: string, branch = 'feat/work'): HostedRepo {
  const dir = makeTmp('lantern-hosted-');
  const bare = path.join(dir, 'origin.git');
  const project = path.join(dir, 'project');
  fs.mkdirSync(bare);
  fs.mkdirSync(project);
  git(bare, 'init', '-q', '--bare', '-b', 'main');
  git(project, 'init', '-q', '-b', 'main');
  git(project, 'remote', 'add', 'origin', originUrl);
  git(project, 'config', `url.${bare}.insteadOf`, originUrl);
  commitFile(project, 'a.txt', 'a\n', 'init');
  git(project, 'push', '-q', 'origin', 'main');
  branchOff(project, branch);
  commitFile(project, 'b.txt', 'b\n', 'work');
  return { dir, project, bare };
}

export { SKILLS_ROOT, git, makeHostedRepo, runSkill };
export type { HostedRepo, SkillDeps, SkillResult };
