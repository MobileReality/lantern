import { execFileSync } from 'node:child_process';
import { SkillError } from './http.mjs';
import { message } from './messages.mjs';

const GIT_TIMEOUT_MS = 120_000;
const DEFAULT_BRANCH = /ref: refs\/heads\/(\S+)\s+HEAD/;

export function createGit(cwd) {
  return (...args) => {
    try {
      return execFileSync('git', args, {
        cwd,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: GIT_TIMEOUT_MS,
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
      }).trim();
    } catch (cause) {
      const said = String(cause.stderr ?? '')
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .join('; ');
      throw new SkillError(message('git.failed', { command: `git ${args[0]}`, said: said || cause.message }));
    }
  };
}

export function currentBranch(git) {
  const branch = git('branch', '--show-current');
  if (!branch) throw new SkillError(message('git.detachedHead'));
  return branch;
}

export function defaultBranch(git, remoteName) {
  const target = DEFAULT_BRANCH.exec(git('ls-remote', '--symref', remoteName, 'HEAD'))?.[1];
  if (!target) throw new SkillError(message('git.noDefaultBranch'));
  return target;
}

export function assertReadyToPublish(git, remoteName, source, target) {
  if (source === target) throw new SkillError(message('git.sameBranch', { branch: source }));
  if (git('status', '--porcelain', '--untracked-files=no')) throw new SkillError(message('git.dirtyTree'));
  if (!git('ls-remote', '--heads', remoteName, `refs/heads/${target}`)) throw new SkillError(message('git.targetMissing', { target, remote: remoteName }));
}

export const pushBranch = (git, remoteName, source) => git('push', remoteName, `HEAD:refs/heads/${source}`);
