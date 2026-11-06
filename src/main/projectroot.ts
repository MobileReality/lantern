import fs from 'node:fs';
import path from 'node:path';
import { isSubagentCwd } from './subagent';

const CLAUDE_WORKTREE = /^(.*?)[\\/]\.claude[\\/]worktrees[\\/][^\\/]+(?:[\\/].*)?$/;
const GIT_WORKTREE_DIR = /^(.*?)[\\/]\.git[\\/]worktrees[\\/]([^\\/]+)[\\/]?$/;

const checkoutCache = new Map<string, string>();

function trimSep(p: string) {
  return p.length > 1 ? p.replace(/[\\/]+$/, '') : p;
}

function isWithin(child: string, parent: string) {
  const c = trimSep(child);
  const p = trimSep(parent);
  return c === p || c.startsWith(`${p}/`) || c.startsWith(`${p}\\`);
}

function closest(roots: string[], cwd: string) {
  return roots.filter((r) => isWithin(cwd, r)).sort((a, b) => b.length - a.length)[0] || '';
}

function gitDirOf(root: string): string {
  try {
    const gitDir = path.join(root, '.git');
    if (!fs.statSync(gitDir).isFile()) return gitDir;
    const pointer = fs.readFileSync(gitDir, 'utf8').match(/^gitdir:\s*(.+)$/m);
    return pointer ? path.resolve(root, pointer[1].trim()) : '';
  } catch {
    return '';
  }
}

function worktreeOwner(root: string) {
  return GIT_WORKTREE_DIR.exec(gitDirOf(root))?.[1] ?? '';
}

function linkedWorktreeName(root: string) {
  return GIT_WORKTREE_DIR.exec(gitDirOf(root))?.[2] ?? '';
}

function readBranch(root: string): string {
  try {
    const gitDir = gitDirOf(root);
    if (!gitDir) return '';
    const head = fs.readFileSync(path.join(gitDir, 'HEAD'), 'utf8').trim();
    if (head.startsWith('ref: refs/heads/')) return head.slice('ref: refs/heads/'.length);
    return head.startsWith('ref: ') ? '' : head.slice(0, 7);
  } catch {
    return '';
  }
}

function nearestGit(cwd: string) {
  let dir = cwd;
  while (!fs.existsSync(path.join(dir, '.git'))) {
    const parent = path.dirname(dir);
    if (parent === dir) return '';
    dir = parent;
  }
  return dir;
}

// A linked worktree's `.git` is a file pointing into `<main>/.git/worktrees/`, so
// it resolves to the main checkout; a submodule's `.git` file stays its own root.
function gitTop(cwd: string) {
  const dir = nearestGit(cwd);
  return dir && (worktreeOwner(dir) || dir);
}

// Unlike checkoutRoot, a linked worktree stays itself: the user named this checkout.
function checkoutTop(cwd: string) {
  return nearestGit(cwd) || cwd;
}

function checkoutRoot(cwd: string) {
  if (!cwd) return cwd;
  const cached = checkoutCache.get(cwd);
  if (cached !== undefined) return cached;
  const claude = CLAUDE_WORKTREE.exec(cwd);
  const resolved = claude ? claude[1] : gitTop(cwd) || cwd;
  checkoutCache.set(cwd, resolved);
  return resolved;
}

// A folder the user opened wins (closest match, so an opened worktree or nested
// project stays itself); subagent worktrees saved by older builds never match.
function resolveRoot(cwd: string, opened: string[]) {
  if (!cwd) return cwd;
  const direct = closest(opened.filter((r) => !isSubagentCwd(r)), cwd);
  if (direct) return direct;
  const base = checkoutRoot(cwd);
  return closest(opened, base) || base;
}

export { checkoutRoot, checkoutTop, gitDirOf, linkedWorktreeName, readBranch, resolveRoot, isWithin };
