// @vitest-environment jsdom
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { COMMANDS } from '../src/shared/commands';
import { SETTING_DEFAULTS } from '../src/shared/settings-registry';
import { mapOf } from './helpers/lantern-map';

const RENDERER = path.join(__dirname, '../src/renderer');
const HTML = fs.readFileSync(path.join(RENDERER, 'workspace.html'), 'utf8');
const CSS = fs.readFileSync(path.join(RENDERER, 'workspace.css'), 'utf8');

function mountPage() {
  const doc = new DOMParser().parseFromString(HTML, 'text/html');
  doc.querySelectorAll('script').forEach((s) => { s.remove(); });
  document.body.innerHTML = doc.body.innerHTML;
  document.body.className = '';
  document.head.innerHTML = '';
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);
}

function mockBridge(info: { ready: boolean; available?: boolean }) {
  const resolved = (value: unknown) => vi.fn().mockResolvedValue(value);
  const full = { languages: {}, dismissedPrs: {} };
  window.ccmws = {
    info: resolved({ port: 9888, token: 'tkn', ready: info.ready, available: info.available ?? true }),
    devInstance: resolved(null),
    diagnosticsNotice: resolved(null),
    updateNotice: resolved(null),
    onUpdateNotice: vi.fn(),
    reportRendererError: resolved({ ok: true }),
    projects: resolved([{ name: 'alpha', path: '/p/alpha', sessions: [] }]),
    settingsGet: resolved(full),
    skillsList: resolved({ installed: false, project: null }),
    explainsList: resolved([]),
    lanternCount: resolved(0),
    projectIdent: resolved({ name: 'alpha', branch: 'main', worktree: '' }),
    lanternLoad: vi.fn(async () => mapOf({ exists: false, project: 'alpha' })),
    lanternFetchPrs: vi.fn(async () => ({ ok: true })),
    agentStatus: resolved({ running: false, available: true }),
    settingsSnapshot: resolved({ values: SETTING_DEFAULTS, modified: [], problems: [], writable: true }),
    onSettingsChanged: vi.fn(),
    onCommand: vi.fn(),
    onProjects: vi.fn(),
    onInfo: vi.fn(),
    onOpen: vi.fn(),
    onShowCompare: vi.fn(),
    onAgentEvent: vi.fn(),
    settingsSetProvider: resolved({ ...full, providers: { '/p/alpha': 'codex' } }),
    opened: vi.fn(),
    needEditor: resolved({ port: 9888, token: 'tkn', ready: false, available: true }),
    addFolder: resolved({ groups: [{ name: 'alpha', path: '/p/alpha', sessions: [] }], selectedPath: null }),
  } as unknown as Window['ccmws'];
}

async function boot(search: string, info: { ready: boolean; available?: boolean } = { ready: true }) {
  vi.resetModules();
  history.replaceState({}, '', `/${search}`);
  mountPage();
  mockBridge(info);
  await import('../src/renderer/workspace');
  await vi.waitFor(() => expect(window.ccmws.settingsGet).toHaveBeenCalled());
}

function display(selector: string) {
  return getComputedStyle(document.querySelector(selector)!).display;
}

function isShown(selector: string) {
  for (let node: Element | null = document.querySelector(selector); node && node !== document.documentElement; node = node.parentElement) {
    if (getComputedStyle(node).display === 'none') return false;
  }
  return true;
}

const MAC_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Electron/33.4.11';

afterEach(() => {
  history.replaceState({}, '', '/');
  vi.restoreAllMocks();
});

vi.setConfig({ testTimeout: 20_000 });

describe('project window', () => {
  it('opens the project from ?project= and swaps the sidebar for a toolbar', async () => {
    const errors: unknown[] = [];
    const onError = (e: ErrorEvent) => errors.push(e.error);
    window.addEventListener('error', onError);
    await boot('?project=/p/alpha');
    expect(document.body.classList.contains('project-window')).toBe(true);
    expect(isShown('#projects')).toBe(false);
    expect(isShown('#sidebar')).toBe(false);
    expect(isShown('.appbar')).toBe(true);
    expect(display('#main')).not.toBe('none');
    await vi.waitFor(() => expect(window.ccmws.opened).toHaveBeenCalledWith('/p/alpha', 'alpha'));
    window.removeEventListener('error', onError);
    expect(errors).toEqual([]);
  });

  it('keeps the search field, microphone and mode switch on the toolbar, and the assistant on the bottom bar', async () => {
    await boot('?project=/p/alpha');
    for (const id of ['command-palette-btn', 'mic-btn', 'mode-btn']) expect(isShown(`#${id}`), id).toBe(true);
    expect(isShown('#provider-select')).toBe(false);
    await vi.waitFor(() => expect(isShown('.lt-statusbar .lt-provider-btn')).toBe(true));
    expect(isShown('#status')).toBe(false);
  });

  it('picks the assistant from the bottom bar menu', async () => {
    await boot('?project=/p/alpha');
    await vi.waitFor(() => expect(window.ccmws.opened).toHaveBeenCalled());
    const button = document.querySelector<HTMLButtonElement>('.lt-provider-btn')!;
    await vi.waitFor(() => expect(button.disabled).toBe(false));
    expect(button.getAttribute('aria-label')).toBe('Lantern tools assistant: Claude');
    button.click();
    const menu = document.querySelector<HTMLElement>('.lt-provider-menu')!;
    expect(menu.hidden).toBe(false);
    (document.querySelectorAll<HTMLButtonElement>('.lt-provider-item')[1]).click();
    expect(menu.hidden).toBe(true);
    await vi.waitFor(() => expect(window.ccmws.settingsSetProvider).toHaveBeenCalledWith('/p/alpha', 'codex'));
    await vi.waitFor(() => expect(button.getAttribute('aria-label')).toBe('Lantern tools assistant: Codex'));
  });

  it('moves through the assistant menu with the arrow keys and closes it when focus leaves', async () => {
    await boot('?project=/p/alpha');
    await vi.waitFor(() => expect(window.ccmws.opened).toHaveBeenCalled());
    const button = document.querySelector<HTMLButtonElement>('.lt-provider-btn')!;
    await vi.waitFor(() => expect(button.disabled).toBe(false));
    button.click();
    const items = [...document.querySelectorAll<HTMLButtonElement>('.lt-provider-item')];
    expect(document.activeElement).toBe(items[0]);
    document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    expect(document.activeElement).toBe(items[1]);
    document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    expect(document.activeElement).toBe(items[0]);
    document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }));
    expect(document.activeElement).toBe(items[1]);
    const outside = document.getElementById('command-palette-btn')!;
    outside.focus();
    expect(document.querySelector<HTMLElement>('.lt-provider-menu')!.hidden).toBe(true);
  });

  it('spans the top and bottom bars across the sidebar window only while the map is in front', () => {
    expect(CSS).toMatch(/body:not\(\.project-window\):not\(\.popout\) \.appbar \{[^}]*left: 0; right: 0/);
    expect(CSS).toMatch(/body:not\(\.project-window\):not\(\.popout\) \.lt-statusbar \{[^}]*left: 0; right: 0; bottom: 0/);
    expect(CSS).toMatch(/:has\(#lantern-tab:not\(\.hidden\) > \.lt-panel:not\(\.hidden\)\) \{ --statusbar-h: 26px; \}/);
  });

  it('drives the project from the toolbar with the sidebar handlers', async () => {
    await boot('?project=/p/alpha');
    await vi.waitFor(() => expect(window.ccmws.opened).toHaveBeenCalled());
    const select = document.querySelector<HTMLSelectElement>('#provider-select')!;
    await vi.waitFor(() => expect(select.disabled).toBe(false));
    select.value = 'codex';
    select.dispatchEvent(new Event('change'));
    await vi.waitFor(() => expect(window.ccmws.settingsSetProvider).toHaveBeenCalledWith('/p/alpha', 'codex'));
    const mode = document.querySelector<HTMLButtonElement>('#mode-btn')!;
    await vi.waitFor(() => expect(mode.getAttribute('aria-checked')).toBe('true'));
    mode.click();
    await vi.waitFor(() => expect(document.getElementById('lantern-tab')!.classList.contains('hidden')).toBe(true));
    expect(mode.getAttribute('aria-checked')).toBe('false');
  });

  it('drags the window by the toolbar on macOS only', async () => {
    expect(CSS).not.toMatch(/project-window::before/);
    expect(CSS).toMatch(/body\.mac \.appbar\s*\{[^}]*-webkit-app-region:\s*drag/);
    expect(CSS).not.toMatch(/(^|\n)\.appbar\s*\{[^}]*-webkit-app-region:\s*drag/);
    await boot('?project=/p/alpha');
    expect(document.body.classList.contains('mac')).toBe(false);
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(MAC_AGENT);
    await boot('?project=/p/alpha');
    expect(document.body.classList.contains('mac')).toBe(true);
  });

  it('opens the project in the Lantern tab at once, without starting the editor server', async () => {
    await boot('?project=/p/alpha', { ready: false });
    await vi.waitFor(() => expect(window.ccmws.opened).toHaveBeenCalledWith('/p/alpha', 'alpha'));
    expect(window.ccmws.needEditor).not.toHaveBeenCalled();
    expect(document.getElementById('mode-btn')!.getAttribute('aria-checked')).toBe('true');
    expect(document.querySelectorAll('webview')).toHaveLength(0);
    expect(document.getElementById('loading')!.classList.contains('hidden')).toBe(true);
  });

  it('asks for the editor server only when the person switches to the Editor', async () => {
    await boot('?project=/p/alpha', { ready: false });
    await vi.waitFor(() => expect(window.ccmws.opened).toHaveBeenCalled());
    expect(window.ccmws.needEditor).not.toHaveBeenCalled();
    document.querySelector<HTMLElement>('.mode-switch .mode-opt')!.click();
    expect(window.ccmws.needEditor).toHaveBeenCalledTimes(1);
    expect(document.getElementById('loading')!.classList.contains('hidden')).toBe(false);
  });

  it('keeps the Lantern view usable after a decline in a window that never asked', async () => {
    await boot('', { ready: false });
    await vi.waitFor(() => expect(window.ccmws.onInfo).toHaveBeenCalled());
    vi.mocked(window.ccmws.onOpen).mock.calls[0][0]('/p/alpha', 'alpha');
    vi.mocked(window.ccmws.onInfo).mock.calls[0][0]({ port: 9888, token: 'tkn', ready: false, available: true, phase: 'error', progress: 'declined' });
    expect(document.getElementById('loading')!.classList.contains('hidden')).toBe(true);
    expect(document.getElementById('mode-btn')!.getAttribute('aria-checked')).toBe('true');
  });

  it('shows the failure over the Editor and lets the person go back to Lantern without it', async () => {
    await boot('', { ready: false });
    await vi.waitFor(() => expect(window.ccmws.onInfo).toHaveBeenCalled());
    vi.mocked(window.ccmws.onOpen).mock.calls[0][0]('/p/alpha', 'alpha');
    const mode = document.getElementById('mode-btn')!;
    const loading = document.getElementById('loading')!;
    mode.click();
    expect(mode.getAttribute('aria-checked')).toBe('false');
    expect(loading.classList.contains('hidden')).toBe(false);
    vi.mocked(window.ccmws.onInfo).mock.calls[0][0]({ port: 9888, token: 'tkn', ready: false, available: true, phase: 'error', progress: 'declined' });
    expect(loading.classList.contains('hidden')).toBe(false);
    mode.click();
    expect(mode.getAttribute('aria-checked')).toBe('true');
    expect(loading.classList.contains('hidden')).toBe(true);
    vi.mocked(window.ccmws.onInfo).mock.calls[0][0]({ port: 9888, token: 'tkn', ready: true, available: true });
    expect(document.querySelectorAll('webview')).toHaveLength(0);
    expect(mode.getAttribute('aria-checked')).toBe('true');
  });

  it('covers the Editor again when the server drops after the Editor was opened on a ready server', async () => {
    await boot('', { ready: true });
    await vi.waitFor(() => expect(window.ccmws.onInfo).toHaveBeenCalled());
    vi.mocked(window.ccmws.onOpen).mock.calls[0][0]('/p/alpha', 'alpha');
    const mode = document.getElementById('mode-btn')!;
    mode.click();
    expect(mode.getAttribute('aria-checked')).toBe('false');
    expect(document.getElementById('loading')!.classList.contains('hidden')).toBe(true);
    vi.mocked(window.ccmws.onInfo).mock.calls[0][0]({ port: 9888, token: 'tkn', ready: false, available: true, phase: 'probe' });
    expect(document.getElementById('loading')!.classList.contains('hidden')).toBe(false);
    mode.click();
    expect(document.getElementById('loading')!.classList.contains('hidden')).toBe(true);
  });

  it('still covers a dead Editor after visiting another project and coming back', async () => {
    await boot('', { ready: true });
    await vi.waitFor(() => expect(window.ccmws.onInfo).toHaveBeenCalled());
    const onOpen = vi.mocked(window.ccmws.onOpen).mock.calls[0][0];
    onOpen('/p/alpha', 'alpha');
    document.getElementById('mode-btn')!.click();
    onOpen('/p/beta', 'beta');
    expect(document.getElementById('mode-btn')!.getAttribute('aria-checked')).toBe('true');
    onOpen('/p/alpha', 'alpha');
    expect(document.getElementById('mode-btn')!.getAttribute('aria-checked')).toBe('false');
    vi.mocked(window.ccmws.onInfo).mock.calls[0][0]({ port: 9888, token: 'tkn', ready: false, available: true, phase: 'probe' });
    expect(document.getElementById('loading')!.classList.contains('hidden')).toBe(false);
  });

  it('covers a dead Editor tab opened again from another project while the server is down', async () => {
    await boot('', { ready: true });
    await vi.waitFor(() => expect(window.ccmws.onInfo).toHaveBeenCalled());
    const onOpen = vi.mocked(window.ccmws.onOpen).mock.calls[0][0];
    const onInfo = vi.mocked(window.ccmws.onInfo).mock.calls[0][0];
    onOpen('/p/alpha', 'alpha');
    document.getElementById('mode-btn')!.click();
    onInfo({ port: 9888, token: 'tkn', ready: false, available: true, phase: 'probe' });
    onOpen('/p/beta', 'beta');
    expect(document.getElementById('loading')!.classList.contains('hidden')).toBe(true);
    onOpen('/p/alpha', 'alpha');
    expect(document.getElementById('mode-btn')!.getAttribute('aria-checked')).toBe('false');
    expect(document.getElementById('loading')!.classList.contains('hidden')).toBe(false);
  });

  it('drops the queued Editor when the person goes to the map by another way', async () => {
    await boot('', { ready: false });
    await vi.waitFor(() => expect(window.ccmws.onInfo).toHaveBeenCalled());
    vi.mocked(window.ccmws.onOpen).mock.calls[0][0]('/p/alpha', 'alpha');
    const mode = document.getElementById('mode-btn')!;
    mode.click();
    expect(mode.getAttribute('aria-checked')).toBe('false');
    vi.mocked(window.ccmws.onOpen).mock.calls[0][0]('/p/alpha', 'alpha');
    vi.mocked(window.ccmws.onInfo).mock.calls[0][0]({ port: 9888, token: 'tkn', ready: true, available: true });
    expect(mode.getAttribute('aria-checked')).toBe('true');
  });

  it('claims its project when the VS Code CLI is unavailable', async () => {
    await boot('?project=/p/alpha', { ready: false, available: false });
    await vi.waitFor(() => expect(window.ccmws.opened).toHaveBeenCalledWith('/p/alpha', 'alpha'));
    const { app } = await import('../src/renderer/state');
    expect(app.activeKey).toBe('/p/alpha');
    expect(document.getElementById('lantern-tab')!.classList.contains('hidden')).toBe(false);
    expect(document.getElementById('mode-btn')!.getAttribute('aria-checked')).toBe('true');
  });

  it('names the project with its worktree and branch in the top bar', async () => {
    await boot('?project=/p/alpha');
    vi.mocked(window.ccmws.projectIdent).mockResolvedValue({ name: 'alpha', branch: 'feat/x', worktree: 'wt-1' });
    window.dispatchEvent(new Event('focus'));
    await vi.waitFor(() => expect(document.getElementById('pi-worktree')!.textContent).toBe('wt-1'));
    expect(document.getElementById('project-ident')!.hidden).toBe(false);
    expect(document.getElementById('pi-worktree-item')!.hidden).toBe(false);
    expect(document.getElementById('pi-branch')!.textContent).toBe('feat/x');
  });

  it('shows only the branch for the main checkout', async () => {
    await boot('?project=/p/alpha');
    await vi.waitFor(() => expect(document.getElementById('pi-name')!.textContent).toBe('alpha'));
    expect(document.getElementById('pi-worktree-item')!.hidden).toBe(true);
    expect(document.getElementById('pi-branch')!.textContent).toBe('main');
  });

  it('names the active project in the sidebar window and hides the name when it fails to load', async () => {
    await boot('');
    vi.mocked(window.ccmws.onOpen).mock.calls[0][0]('/p/alpha', 'alpha');
    await vi.waitFor(() => expect(document.getElementById('project-ident')!.hidden).toBe(false));
    expect(window.ccmws.projectIdent).toHaveBeenCalledWith('/p/alpha');
    vi.mocked(window.ccmws.projectIdent).mockRejectedValue(new Error('gone'));
    window.dispatchEvent(new Event('focus'));
    await vi.waitFor(() => expect(document.getElementById('project-ident')!.hidden).toBe(true));
  });

  it('hides the palette field with the sidebar in a pop-out', async () => {
    await boot('?popout=explain&project=/p/alpha');
    expect(document.body.classList.contains('popout')).toBe(true);
    expect(document.getElementById('command-palette-btn')).not.toBeNull();
    expect(isShown('#command-palette-btn')).toBe(false);
  });

  it('leaves out the project filter, which a project window never shows', async () => {
    await boot('?project=/p/alpha');
    const { availableCommands } = await import('../src/renderer/commands');
    expect(availableCommands()).not.toContain('project.filter');
    expect(availableCommands()).toContain('lantern.open');
  });

  it('registers no commands in an explainer pop-out', async () => {
    await boot('?popout=explain&project=/p/alpha');
    const { availableCommands } = await import('../src/renderer/commands');
    expect(document.querySelector('#explain-modal')!.classList.contains('hidden')).toBe(false);
    expect(availableCommands()).toEqual([]);
  });

  it('keeps the sidebar in a normal workspace window', async () => {
    await boot('');
    await new Promise((r) => setTimeout(r));
    expect(document.body.classList.contains('project-window')).toBe(false);
    expect(display('#sidebar')).not.toBe('none');
    expect(display('#projects')).not.toBe('none');
    expect(window.ccmws.opened).not.toHaveBeenCalled();
  });
});

describe('always-on commands', () => {
  const REGISTERED_ON_DEMAND = ['explain.popout'];
  const commands = () => import('../src/renderer/commands');

  it('add folder runs the same bridge call from the button and the command', async () => {
    await boot('');
    const { runCommand } = await commands();
    document.querySelector<HTMLButtonElement>('#addFolder')!.click();
    expect(runCommand('project.addFolder')).toBe(true);
    await vi.waitFor(() => expect(window.ccmws.addFolder).toHaveBeenCalledTimes(2));
  });

  it('filter projects focuses the filter input', async () => {
    await boot('');
    const { runCommand } = await commands();
    runCommand('project.filter');
    expect(document.activeElement).toBe(document.querySelector('#project-filter'));
  });

  it('opens a project without the editor server and asks for it only when the editor is asked for', async () => {
    await boot('', { ready: false });
    await vi.waitFor(() => expect(window.ccmws.onInfo).toHaveBeenCalled());
    vi.mocked(window.ccmws.onOpen).mock.calls[0][0]('/p/alpha', 'alpha');
    expect(window.ccmws.opened).toHaveBeenCalledWith('/p/alpha', 'alpha');
    expect(window.ccmws.needEditor).not.toHaveBeenCalled();
    const { runCommand } = await commands();
    runCommand('editor.show');
    expect(window.ccmws.needEditor).toHaveBeenCalledTimes(1);
  });

  it('registers every command of the registry except the ones a feature registers on demand', async () => {
    await boot('');
    const { availableCommands } = await commands();
    const alwaysOn = COMMANDS.map((c) => c.id as string).filter((id) => !REGISTERED_ON_DEMAND.includes(id));
    expect(alwaysOn.length).toBeGreaterThan(0);
    expect([...availableCommands()].sort()).toEqual([...alwaysOn].sort());
  });
});

describe('the editor webview', () => {
  it('allows popups so the main process can send sign-in links to the browser', async () => {
    await boot('?project=/p/alpha');
    await vi.waitFor(() => expect(document.querySelector('webview')).not.toBeNull());
    const webview = document.querySelector('webview')!;
    expect(webview.hasAttribute('allowpopups')).toBe(true);
    expect(webview.getAttribute('partition')).toBe('persist:ccm');
  });
});
