import type { SettingsPanel } from '../lib/settings-editor';
import type { CliStatus } from '../../main/cli';
import { shellQuote } from '../../shared/shell-quote';
import { el } from '../lib/util';

const REMOTE_ERROR_PREFIX = /^Error invoking remote method '[^']+': (Error: )?/;

function errorMessage(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).replace(REMOTE_ERROR_PREFIX, '');
}

function statusText(status: CliStatus | null): string {
  if (!status) return 'The lantern command is available on macOS only.';
  if (status.state === 'installed') return `Installed — ${status.link}`;
  if (status.state === 'missing') return 'Not installed';
  return `${status.link} points somewhere else: ${status.target ?? 'not a link'}`;
}

function guideText({ state, link, script }: CliStatus): string {
  if (state === 'other') {
    return ["Lantern won't replace a command it didn't install. To replace it yourself:",`  sudo rm ${link}`, `  sudo ln -s ${shellQuote(script)} ${link}`].join('\n');
  }
  return [
    'Install by hand:',
    `  sudo ln -sf ${shellQuote(script)} ${link}`,
    '',
    'Use:',
    '  lantern              open Lantern',
    '  lantern .            open the current folder in its own window',
    '  lantern ~/code/app   open a folder in its own window',
    '',
    'Remove:',
    `  sudo rm ${link}`,
  ].join('\n');
}

function mountCliPanel(section: HTMLElement): void {
  const desc = el('p', 'st-desc', 'Open Lantern from a terminal. Each folder you open gets its own window.');
  const state = el('p', 'cli-state');
  state.setAttribute('role', 'status');
  const install = el('button', 'st-edit cli-install');
  install.type = 'button';
  install.hidden = true;
  const error = el('p', 'cli-error');
  error.setAttribute('role', 'alert');
  const guide = el('pre', 'cli-guide');
  guide.hidden = true;
  section.append(desc, state, install, error, guide);

  function show(status: CliStatus | null): void {
    state.textContent = statusText(status);
    install.hidden = !status || status.state === 'other';
    install.textContent = status?.state === 'missing' ? 'Install' : 'Reinstall';
    guide.hidden = !status;
    if (status) guide.textContent = guideText(status);
  }

  install.addEventListener('click', async () => {
    install.disabled = true;
    error.textContent = '';
    try {
      show(await window.ccmws.cliInstall());
    } catch (err) {
      error.textContent = `Couldn't install: ${errorMessage(err)}`;
    } finally {
      install.disabled = false;
    }
  });

  window.ccmws.cliStatus().then(show, (err: unknown) => {
    error.textContent = `Couldn't check the command: ${errorMessage(err)}`;
  });
}

export const cliPanel: SettingsPanel = {
  id: 'cli',
  title: 'Command line',
  keywords: ['cli', 'terminal', 'shell', 'lantern', 'path', 'install', 'command'],
  mount: mountCliPanel,
};
