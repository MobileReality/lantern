import type { SettingsPanel } from '../lib/settings-editor';
import type { RtkStatus } from '../../shared/rtk';
import { activeProjectPath } from '../state';
import { el } from '../lib/util';

const REMOTE_ERROR_PREFIX = /^Error invoking remote method '[^']+': (Error: )?/;

function errorMessage(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).replace(REMOTE_ERROR_PREFIX, '');
}

function statusText(status: RtkStatus): string {
  if (status.found) return `Found — ${status.path} · ${status.version} · ${status.edition} edition`;
  if (status.reason === 'not-rtk') return `${status.path} is not RTK (Rust Token Killer), so Lantern ignores it.`;
  if (status.reason === 'probe-failed') return `${status.path} did not answer the check, so Lantern ignores it.`;
  return 'Not installed. Lantern works the same without it.';
}

function hookText(status: RtkStatus): string {
  if (!status.hookFound) return '';
  return `An RTK hook is set in ${status.hookFiles.join(', ')}. Claude Code refuses the git commands it rewrites inside a delegate's worktree. Lantern changes nothing: exclude git in your RTK config, or run rtk init -g --uninstall yourself.`;
}

function mountRtkPanel(section: HTMLElement): void {
  const desc = el('p', 'st-desc', 'RTK shortens command output for coding agents. Lantern only looks for it: it never installs RTK or edits its settings.');
  const state = el('p', 'rtk-state', 'Checking…');
  state.setAttribute('role', 'status');
  const hook = el('p', 'rtk-hook');
  const error = el('p', 'rtk-error');
  error.setAttribute('role', 'alert');
  section.append(desc, state, hook, error);

  function show(status: RtkStatus): void {
    state.textContent = statusText(status);
    hook.textContent = hookText(status);
  }

  window.ccmws.rtkStatus(activeProjectPath()).then(show, (err: unknown) => {
    state.textContent = '';
    error.textContent = `Couldn't check for RTK: ${errorMessage(err)}`;
  });
}

export const rtkPanel: SettingsPanel = {
  id: 'rtk',
  title: 'RTK',
  keywords: ['rtk', 'rust token killer', 'tokens', 'output', 'hook', 'agent', 'optional'],
  mount: mountRtkPanel,
};
