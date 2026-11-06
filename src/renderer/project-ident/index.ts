import type { ProjectIdent } from '@shared/project-ident';
import { byId } from '@renderer/lib/util';

const REFRESH_MS = 15_000;

function mountProjectIdent() {
  const box = byId('project-ident');
  const name = byId('pi-name');
  const git = byId('pi-git');
  const worktree = byId('pi-worktree');
  const worktreeItem = byId('pi-worktree-item');
  const branch = byId('pi-branch');
  let root: string | null = null;
  let token = 0;
  let watching = false;
  async function refresh() {
    const mine = ++token;
    if (!root) {
      box.hidden = true;
      return;
    }
    let ident: ProjectIdent;
    try {
      ident = await window.ccmws.projectIdent(root);
    } catch {
      if (mine === token) box.hidden = true;
      return;
    }
    if (mine !== token) return;
    name.textContent = ident.name;
    git.hidden = !ident.branch;
    worktreeItem.hidden = !ident.worktree;
    worktree.textContent = ident.worktree;
    worktree.dataset.tip = `Worktree: ${ident.worktree}`;
    branch.textContent = ident.branch;
    branch.dataset.tip = `Branch: ${ident.branch}`;
    box.hidden = !ident.name;
  }
  function watch() {
    if (watching) return;
    watching = true;
    window.addEventListener('focus', () => void refresh());
    window.addEventListener('mr:files-changed', () => void refresh());
    setInterval(() => void refresh(), REFRESH_MS);
  }
  return {
    show(next: string | null) {
      if (next === root) return;
      root = next;
      if (root) watch();
      void refresh();
    },
  };
}

export { mountProjectIdent };
