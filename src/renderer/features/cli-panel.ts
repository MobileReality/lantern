import type { SettingsPanel } from '../lib/settings-editor';
import type { CliStatus } from '../../main/cli';
import { shellQuote } from '../../shared/shell-quote';
import { el } from '../lib/util';

const REMOTE_ERROR_PREFIX = /^Error invoking remote method '[^']+': (Error: )?/;

function errorMessage(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).replace(REMOTE_ERROR_PREFIX, '');
}

const USAGE_LINES = ['Use:', '  lantern              open Lantern', '  lantern .            open the current folder in its own window', '  lantern ~/code/app   open a folder in its own window'];

function statusText(status: CliStatus | null): string {
  if (!status) return 'The lantern command cannot be installed from a development run or on this system.';
  if (status.state === 'installed') return `Installed — ${status.link}`;
  if (status.state === 'missing') return 'Not installed';
  return `${status.link} points somewhere else: ${status.target ?? 'not a link'}`;
}

function userGuideText({ state, link, script, platform }: CliStatus): string {
  const windows = platform === 'win32';
  const target = shellQuote(link);
  const remove = windows ? `  del "${link}"` : `  rm ${target}`;
  if (state === 'other') return [`Lantern won't replace a command it didn't install. To replace it yourself:`, remove, windows ? `  (then reinstall from here)` : `  ln -s ${shellQuote(script)} ${target}`].join('\n');
  const install = windows ? 'Click Install: it writes the shim and adds its folder to your user PATH.' : `Install by hand:\n  mkdir -p ~/.local/bin\n  ln -sf ${shellQuote(script)} ${target}`;
  return [install, '', ...USAGE_LINES, '', 'Remove:', remove].join('\n');
}

function guideText(status: CliStatus): string {
  const { state, link, script, platform } = status;
  if (platform === 'linux' || platform === 'win32') return userGuideText(status);
  if (state === 'other') {
    return ["Lantern won't replace a command it didn't install. To replace it yourself:",`  sudo rm ${link}`, `  sudo ln -s ${shellQuote(script)} ${link}`].join('\n');
  }
  return [
    'Install by hand:',
    `  sudo ln -sf ${shellQuote(script)} ${link}`,
    '',
    ...USAGE_LINES,
    '',
    'Remove:',
    `  sudo rm ${link}`,
  ].join('\n');
}

function mountCliPanel(section: HTMLElement): void {
  const desc = el('p', 'st-desc', 'Open Lantern from a terminal. Each folder you open gets its own window.');
  const state = el('p', 'cli-state');
  state.setAttribute('role', 'status');
  const note = el('p', 'cli-note');
  note.style.whiteSpace = 'pre-line';
  const install = el('button', 'st-edit cli-install');
  install.type = 'button';
  install.hidden = true;
  const error = el('p', 'cli-error');
  error.setAttribute('role', 'alert');
  const guide = el('pre', 'cli-guide');
  guide.hidden = true;
  section.append(desc, state, note, install, error, guide);

  function show(status: CliStatus | null): void {
    state.textContent = statusText(status);
    note.textContent = status?.note ?? '';
    note.hidden = !status?.note;
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
