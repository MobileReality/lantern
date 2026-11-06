import path from 'node:path';
import type { ProjectIdent } from '@shared/project-ident';
import { checkoutRoot, linkedWorktreeName, readBranch } from '../projectroot';

function projectIdent(root: unknown): ProjectIdent {
  if (typeof root !== 'string' || !root) return { name: '', branch: '', worktree: '' };
  const branch = readBranch(root);
  return { name: path.basename(checkoutRoot(root)), branch, worktree: branch ? linkedWorktreeName(root) : '' };
}

export { projectIdent };
