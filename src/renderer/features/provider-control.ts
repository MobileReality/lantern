import { app } from '../state';
import { providerForProject, providerLabel, setProvider, setProviders } from '../lib/providers';
import type { ToolsProvider } from '../lib/providers';
import claude from '@renderer/assets/logos/claude.svg';
import codex from '@renderer/assets/logos/codex.svg';
import type { Provider } from '@main/provider';
import { mountPopover, rovingFocus } from '@renderer/popover';

const LOGOS: Record<Provider, string> = { claude, codex };

// The Claude/Codex choice for Lantern tools. Absent controls or bridge calls (older pages,
// test fixtures) leave everything on Claude, exactly as before the choice existed.
const providerSelect = document.getElementById('provider-select') as HTMLSelectElement | null;
const codexHooksControl = document.getElementById('codex-hooks-control');
const codexHooksStatus = document.getElementById('codex-hooks-status');
const codexHooksInstall = document.getElementById('codex-hooks-install') as HTMLButtonElement | null;
const codexHooksUninstall = document.getElementById('codex-hooks-uninstall') as HTMLButtonElement | null;
let agentBusy = false;
let hooksLoaded = false;
let hooksBusy = false;

function showHookStatus(result: { ok: boolean; configured: boolean; error?: string }) {
  if (!codexHooksStatus || !codexHooksInstall) return;
  hooksLoaded = true;
  hooksBusy = false;
  codexHooksInstall.disabled = false;
  if (codexHooksUninstall) codexHooksUninstall.disabled = false;
  codexHooksUninstall?.classList.toggle('hidden', !(result.ok && result.configured));
  if (!result.ok) {
    codexHooksStatus.textContent = result.error || 'Could not read activity hooks';
    codexHooksInstall.textContent = 'Try again';
  } else if (result.configured) {
    codexHooksStatus.textContent = 'Configured · review trust in Codex /hooks';
    codexHooksInstall.textContent = 'Refresh';
  } else {
    codexHooksStatus.textContent = 'Activity hooks are not configured';
    codexHooksInstall.textContent = 'Set up';
  }
}

async function refreshHookStatus() {
  if (!codexHooksInstall || !window.ccmws.codexHooksStatus) return;
  hooksBusy = true;
  codexHooksInstall.disabled = true;
  try {
    showHookStatus(await window.ccmws.codexHooksStatus());
  } catch (error) {
    showHookStatus({ ok: false, configured: false, error: String(error) });
  }
}

function activeProject() {
  return app.activeKey && !app.activeKey.startsWith('blank:') ? app.activeKey : null;
}

function syncProvider() {
  if (!providerSelect) return;
  const project = activeProject();
  providerSelect.value = providerForProject(project);
  providerSelect.disabled = !project || agentBusy;
  providerSelect.dataset.tip = !project ? 'Open a project to choose its Lantern tools assistant' : agentBusy ? 'The assistant cannot change while a Lantern tool is running' : 'Assistant used by Lantern tools; the embedded editor is unchanged';
  const codex = providerSelect.value === 'codex';
  codexHooksControl?.classList.toggle('hidden', !codex);
  if (codex && !hooksLoaded && !hooksBusy) void refreshHookStatus();
  for (const paint of providerButtons) paint();
}

function initProviders(providers: Record<string, ToolsProvider> | undefined, project: string | null) {
  setProviders(providers);
  syncProvider();
  void window.ccmws.agentStatus?.(project)?.then?.((status) => {
    agentBusy = !!status?.running;
    syncProvider();
  });
}

providerSelect?.addEventListener('change', async () => {
  const project = activeProject();
  if (!project || agentBusy) return syncProvider();
  const next = await window.ccmws.settingsSetProvider(project, providerSelect.value as ToolsProvider);
  setProviders(next.providers);
  syncProvider();
  window.dispatchEvent(new Event('mr:provider-changed'));
});

async function changeHooks(label: string, change: () => Promise<{ ok: boolean; configured: boolean; error?: string }>) {
  if (hooksBusy || !codexHooksStatus || !codexHooksInstall) return;
  hooksBusy = true;
  codexHooksInstall.disabled = true;
  if (codexHooksUninstall) codexHooksUninstall.disabled = true;
  codexHooksStatus.textContent = label;
  try {
    showHookStatus(await change());
  } catch (error) {
    showHookStatus({ ok: false, configured: false, error: String(error) });
  }
}

codexHooksInstall?.addEventListener('click', () => changeHooks('Setting up activity hooks…', () => window.ccmws.codexHooksInstall()));
codexHooksUninstall?.addEventListener('click', () => {
  if (window.ccmws.codexHooksUninstall) void changeHooks('Removing activity hooks…', window.ccmws.codexHooksUninstall);
});

window.ccmws.onAgentStatus?.((status) => {
  agentBusy = status.running;
  syncProvider();
});
window.ccmws.onProvider?.(({ project, provider }) => {
  setProvider(project, provider);
  syncProvider();
  window.dispatchEvent(new Event('mr:provider-changed'));
});
window.addEventListener('mr:agent-busy', (event) => {
  agentBusy = !!(event as CustomEvent).detail;
  syncProvider();
});

const providerButtons = new Set<() => void>();

function mountProviderButton(host: HTMLElement) {
  host.className = 'lt-provider';
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'lt-provider-btn';
  button.setAttribute('aria-haspopup', 'menu');
  const menu = document.createElement('ul');
  menu.className = 'lt-provider-menu';
  menu.setAttribute('role', 'menu');
  menu.setAttribute('aria-label', 'Lantern tools assistant');
  host.append(button, menu);

  function paint() {
    const current = providerForProject(activeProject());
    button.innerHTML = `${LOGOS[current]}<span>${providerLabel(current)}</span>`;
    button.disabled = !!providerSelect?.disabled;
    button.dataset.tip = providerSelect?.dataset.tip ?? '';
    button.setAttribute('aria-label', `Lantern tools assistant: ${providerLabel(current)}`);
    if (!menu.hidden) return;
    menu.textContent = '';
    for (const provider of ['claude', 'codex'] as const) {
      const li = document.createElement('li');
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'lt-provider-item';
      item.setAttribute('role', 'menuitemradio');
      item.setAttribute('aria-checked', String(provider === current));
      item.innerHTML = `${LOGOS[provider]}<span>${providerLabel(provider)}</span>`;
      item.addEventListener('click', () => {
        popover.close(true);
        if (!providerSelect || provider === current) return;
        providerSelect.value = provider;
        providerSelect.dispatchEvent(new Event('change'));
      });
      li.append(item);
      menu.append(li);
    }
  }
  const popover = mountPopover(button, menu, {
    placement: 'top-end',
    inside: host,
    focus: () => menu.querySelector<HTMLElement>('[aria-checked="true"]'),
    onClose: paint,
  });
  rovingFocus(menu, () => [...menu.querySelectorAll<HTMLButtonElement>('.lt-provider-item')]);
  providerButtons.add(paint);
  paint();
  return () => {
    popover.dispose();
    providerButtons.delete(paint);
  };
}

export { initProviders, mountProviderButton, syncProvider };
