// @vitest-environment jsdom
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SETTING_DEFAULTS } from '../src/shared/settings-registry';
import { mapOf } from './helpers/lantern-map';

const RENDERER = path.join(__dirname, '../src/renderer');
const HTML = fs.readFileSync(path.join(RENDERER, 'workspace.html'), 'utf8');
const CSS = fs.readFileSync(path.join(RENDERER, 'workspace.css'), 'utf8');

const REMOVED = ['flow-btn', 'explain-btn', 'review-btn', 'skills-btn', 'memory-btn', 'lantern-btn'];
const KEPT = ['mic-btn', 'mode-btn'];

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

function accessibleName(el: Element) {
  return el.getAttribute('aria-label') || el.textContent!.replace(/\s+/g, ' ').trim();
}

function display(id: string) {
  return getComputedStyle(document.getElementById(id)!).display;
}

let pushAgentStatus: ((status: { running: boolean }) => void) | undefined;
let pushProvider: ((value: { project: string; provider: 'claude' | 'codex' }) => void) | undefined;

type TestProject = { name: string; path: string; sessions: { state: string }[] };
type BootSettings = { providers?: Record<string, 'claude' | 'codex'>; projects?: TestProject[] };

function mockBridge(settings: BootSettings) {
  const projects = settings.projects ?? [{ name: 'alpha', path: '/p/alpha', sessions: [] }, { name: 'beta', path: '/p/beta', sessions: [] }];
  const resolved = (value: unknown) => vi.fn().mockResolvedValue(value);
  const full = { languages: {}, providers: { ...(settings.providers || {}) }, dismissedPrs: {} };
  window.ccmws = {
    info: resolved({ port: 9888, token: 'tkn', ready: true, available: true }),
    devInstance: resolved(null),
    diagnosticsNotice: resolved(null),
    updateNotice: resolved(null),
    onUpdateNotice: vi.fn(),
    reportRendererError: resolved({ ok: true }),
    projects: resolved(projects),
    addFolder: resolved({ groups: [{ name: 'alpha', path: '/p/alpha', sessions: [] }], selectedPath: null }),
    settingsGet: resolved(full),
    settingsSetProvider: vi.fn(async (project: string, provider: 'claude' | 'codex') => {
      full.providers[project] = provider;
      return full;
    }),
    codexHooksStatus: resolved({ ok: true, configured: false }),
    codexHooksInstall: resolved({ ok: true, configured: true, changed: true }),
    skillsList: resolved({ installed: false, project: null }),
    fixMic: resolved(true),
    explainsList: resolved([]),
    lanternCount: resolved(0),
    lanternLoad: vi.fn(async () => mapOf({ exists: false, project: 'alpha' })),
    lanternFetchPrs: vi.fn(async () => ({ ok: true })),
    agentStatus: resolved({ running: false, available: true, provider: 'claude' }),
    settingsSnapshot: resolved({ values: SETTING_DEFAULTS, modified: [], problems: [], writable: true }),
    settingsUpdate: resolved({ ok: true, snapshot: { values: SETTING_DEFAULTS, modified: [], problems: [], writable: true } }),
    settingsOpenFile: resolved(''),
    onSettingsChanged: vi.fn(),
    onCommand: vi.fn(),
    cliStatus: resolved(null),
    rtkStatus: resolved({ found: false, path: null, version: null, edition: null, hookFound: false, hookFiles: [], reason: 'not-installed' }),
    onProjects: vi.fn(),
    onInfo: vi.fn(),
    onOpen: vi.fn(),
    onShowCompare: vi.fn(),
    onAgentEvent: vi.fn(),
    onAgentStatus: vi.fn((cb) => (pushAgentStatus = cb)),
    onProvider: vi.fn((cb) => (pushProvider = cb)),
    opened: vi.fn(),
    hide: resolved(projects),
    freeProjectMemory: resolved({ ok: true, terminated: { 'extension-host': 1, tsserver: 1, claude: 1 } }),
  } as unknown as Window['ccmws'];
}

async function bootWorkspace(settings: BootSettings = {}, query = '') {
  vi.resetModules();
  mountPage();
  history.replaceState({}, '', `/${query}`);
  mockBridge(settings);
  const { app } = await import('../src/renderer/state');
  await import('../src/renderer/workspace');
  await vi.waitFor(() => expect(window.ccmws.settingsGet).toHaveBeenCalled());
  await vi.waitFor(() => expect(document.body.classList.contains('popout') || document.getElementById('status')!.textContent === 'VS Code server ready').toBe(true));
  return app;
}

const MANY_PROJECTS = [
  { name: 'api', path: '/Users/name/work/clients/acme/api', sessions: [{ state: 'running' }] },
  { name: 'api', path: '/Users/name/work/clients/orbit/api', sessions: [] },
  { name: 'api', path: '/Users/name/archive/clients/acme/api', sessions: [] },
  { name: 'Billing portal with an unusually long project name', path: '/work/customer-platform/billing-portal-with-an-unusually-long-directory-name', sessions: [] },
  { name: 'Design System', path: '/work/shared/design-system', sessions: [{ state: 'idle' }] },
  { name: 'Docs', path: '/work/docs', sessions: [] },
  { name: 'Identity', path: '/work/services/identity', sessions: [] },
  { name: 'Lantern', path: '/work/lantern', sessions: [] },
  { name: 'Mobile', path: '/work/apps/mobile', sessions: [] },
  { name: 'Observability', path: '/work/platform/observability', sessions: [] },
  { name: 'Payments', path: '/work/services/payments', sessions: [] },
  { name: 'Storefront', path: '/work/apps/storefront', sessions: [] },
  { name: 'Support tools', path: '/work/internal/support-tools', sessions: [] },
];

describe('sidebar markup', () => {
  beforeEach(mountPage);

  it.each(REMOVED)('has no #%s', (id) => {
    expect(document.getElementById(id)).toBeNull();
  });

  it('has no Explain or Review control anywhere in the aside', () => {
    const labels = [...document.querySelectorAll('#sidebar button')].map(accessibleName).join('|');
    expect(labels).not.toMatch(/explain|review/i);
  });

  it.each(KEPT)('keeps #%s with an accessible name', (id) => {
    const el = document.getElementById(id)!;
    expect(el).not.toBeNull();
    expect(accessibleName(el).length).toBeGreaterThan(0);
  });

  it('names the Enable microphone control', () => {
    expect(accessibleName(document.getElementById('mic-btn')!)).toBe('Enable microphone');
  });

  it('keeps a tooltip on Enable microphone', () => {
    expect(document.getElementById('mic-btn')!.getAttribute('data-tip')).toBeTruthy();
  });

  it('draws every icon as inline SVG, without emoji', () => {
    const sidebar = document.getElementById('sidebar')!;
    expect(document.querySelectorAll('#mode-btn svg').length).toBeGreaterThanOrEqual(1);
    expect(document.querySelectorAll('#mic-btn svg').length).toBe(1);
    expect(sidebar.textContent).not.toMatch(/\p{Extended_Pictographic}/u);
  });

  it('exposes the mode switch as a switch with a name', () => {
    const mode = document.getElementById('mode-btn')!;
    expect(mode.getAttribute('role')).toBe('switch');
    expect(accessibleName(mode)).toBe('Show the Lantern map');
  });

  it('labels the per-project assistant as Lantern tools', () => {
    expect(document.querySelector('#provider-control span')?.textContent).toBe('Lantern tools');
    expect(document.getElementById('provider-select')?.getAttribute('aria-label')).toBe('Lantern tools assistant');
  });

  it('keeps the Explain modal in the page, with no review or flow modal', () => {
    expect(document.getElementById('flow-modal')).toBeNull();
    expect(document.getElementById('review-modal')).toBeNull();
    expect(document.getElementById('explain-modal')).not.toBeNull();
  });
});

afterEach(() => history.replaceState({}, '', '/'));

describe('mode-dependent visibility', () => {
  beforeEach(mountPage);

  it('shows Enable microphone over an open editor', () => {
    document.getElementById('empty')!.classList.add('hidden');
    for (const id of ['mic-btn', 'mode-btn']) expect(display(id)).not.toBe('none');
  });

  it('keeps Enable microphone away from the empty panel', () => {
    expect(display('mic-btn')).toBe('none');
  });

});

describe('workspace.ts without the removed buttons', () => {
  it('draws the Lantern option of the mode switch with the shared lantern mark', async () => {
    const shared = fs.readFileSync(path.join(RENDERER, 'assets/icons/lantern-mark.svg'), 'utf8');
    await bootWorkspace();
    const mark = document.querySelector('.mode-opt[data-mode="lantern"] .mode-mark')!;
    const expected = document.createElement('span');
    expected.innerHTML = shared;
    expect(mark.innerHTML).toBe(expected.innerHTML);
    expect(document.querySelectorAll('#mode-btn svg').length).toBe(2);
    expect(HTML).not.toMatch(/data-mode="lantern">\s*<svg/);
  });

  it('drops the status line once the VS Code server is ready, and shows it while it starts', async () => {
    await bootWorkspace();
    const status = document.getElementById('status')!;
    expect(status.hidden).toBe(true);
    expect(getComputedStyle(document.querySelector('.foot')!).display).toBe('none');
    const onInfo = vi.mocked(window.ccmws.onInfo).mock.calls[0][0];
    onInfo({ port: 9888, token: 'tkn', ready: false, available: true, progress: 'Starting VS Code server…' });
    expect(status.hidden).toBe(true);
    onInfo({ port: 9888, token: 'tkn', ready: false, available: true, phase: 'probe', progress: 'Starting VS Code server…' });
    expect(status.hidden).toBe(false);
    expect(status.textContent).toBe('Starting VS Code server…');
  });

  it('loads in VS Code mode and shows Enable microphone once a project is open', async () => {
    await bootWorkspace();
    expect(display('mic-btn')).toBe('none');
    vi.mocked(window.ccmws.onOpen).mock.calls[0][0]('/p/alpha', 'alpha');
    expect(display('mic-btn')).not.toBe('none');
    expect(document.getElementById('mode-btn')!.getAttribute('aria-checked')).toBe('true');
  });

  it('hydrates and switches the saved provider with the active project', async () => {
    await bootWorkspace({ providers: { '/p/alpha': 'codex' } });
    const rows = [...document.querySelectorAll('.project-row .project-select')] as HTMLElement[];
    rows[0].click();
    const select = document.getElementById('provider-select') as HTMLSelectElement;
    expect(select.value).toBe('codex');
    expect(select.disabled).toBe(false);
    rows[1].click();
    expect(select.value).toBe('claude');
    rows[0].click();
    expect(select.value).toBe('codex');
  });

  it('persists provider changes and disables selection during a global run', async () => {
    await bootWorkspace();
    (document.querySelector('.project-row .project-select') as HTMLElement).click();
    const select = document.getElementById('provider-select') as HTMLSelectElement;
    select.value = 'codex';
    select.dispatchEvent(new Event('change'));
    await vi.waitFor(() => expect(window.ccmws.settingsSetProvider).toHaveBeenCalledWith('/p/alpha', 'codex'));
    expect(select.value).toBe('codex');
    pushAgentStatus?.({ running: true });
    expect(select.disabled).toBe(true);
    pushAgentStatus?.({ running: false });
    expect(select.disabled).toBe(false);
  });

  it('offers explicit Codex activity-hook setup without installing on selection', async () => {
    await bootWorkspace({ providers: { '/p/alpha': 'codex' } });
    (document.querySelector('.project-row .project-select') as HTMLElement).click();
    const control = document.getElementById('codex-hooks-control')!;
    await vi.waitFor(() => expect(window.ccmws.codexHooksStatus).toHaveBeenCalledOnce());
    expect(control.classList.contains('hidden')).toBe(false);
    expect(window.ccmws.codexHooksInstall).not.toHaveBeenCalled();
    (document.getElementById('codex-hooks-install') as HTMLButtonElement).click();
    await vi.waitFor(() => expect(window.ccmws.codexHooksInstall).toHaveBeenCalledOnce());
    expect(document.getElementById('codex-hooks-status')!.textContent).toContain('/hooks');
    const rows = [...document.querySelectorAll('.project-row .project-select')] as HTMLElement[];
    rows[1].click();
    expect(control.classList.contains('hidden')).toBe(true);
  });

  it('keeps a settings push that arrives while the startup requests are pending', async () => {
    const FOLD = 'graph.foldFilesWhenZoomedOut';
    vi.resetModules();
    mountPage();
    history.replaceState({}, '', '/');
    mockBridge({});
    let releaseInfo: (info: unknown) => void = () => {};
    let pushSettings: ((change: unknown) => void) | undefined;
    const bridge = window.ccmws as unknown as Record<string, unknown>;
    bridge.info = vi.fn(() => new Promise((resolve) => (releaseInfo = resolve)));
    bridge.onSettingsChanged = vi.fn((cb) => (pushSettings = cb));
    await import('../src/renderer/workspace');
    await vi.waitFor(() => expect(window.ccmws.settingsSnapshot).toHaveBeenCalled());
    const pushed = { values: { ...SETTING_DEFAULTS, [FOLD]: false }, modified: [FOLD], problems: [], writable: true };
    pushSettings!({ snapshot: pushed, changed: [FOLD] });
    releaseInfo({ port: 9888, token: 'tkn', ready: true, available: true });
    await vi.waitFor(() => expect(document.getElementById('status')!.textContent).toBe('VS Code server ready'));
    const { settingValue } = await import('../src/renderer/lib/settings-state');
    expect(settingValue(FOLD)).toBe(false);
  });

  it('hydrates provider settings in a pop-out', async () => {
    const app = await bootWorkspace({ providers: { '/p/alpha': 'codex' } }, '?popout=explain&project=/p/alpha');
    const { providerForProject } = await import('../src/renderer/lib/providers');
    await vi.waitFor(() => expect(providerForProject('/p/alpha')).toBe('codex'));
    expect((document.getElementById('provider-select') as HTMLSelectElement).value).toBe('codex');
    expect(document.body.classList.contains('popout')).toBe(true);
    pushProvider?.({ project: '/p/alpha', provider: 'claude' });
    expect(providerForProject('/p/alpha')).toBe('claude');
    expect((document.getElementById('provider-select') as HTMLSelectElement).value).toBe('claude');
  });

  it('switches between the editor and the Lantern map from the top-bar switch', async () => {
    const app = await bootWorkspace();
    vi.mocked(window.ccmws.onOpen).mock.calls[0][0]('/p/alpha', 'alpha');
    const mode = document.getElementById('mode-btn')!;
    const lantern = document.getElementById('lantern-tab')!;
    expect(app.activeKey).toBe('/p/alpha');
    expect(mode.getAttribute('aria-checked')).toBe('true');
    expect(lantern.classList.contains('hidden')).toBe(false);
    mode.click();
    await vi.waitFor(() => expect(mode.getAttribute('aria-checked')).toBe('false'));
    expect(lantern.classList.contains('hidden')).toBe(true);
    mode.click();
    expect(mode.getAttribute('aria-checked')).toBe('true');
    expect(lantern.classList.contains('hidden')).toBe(false);
  });

  it('boots without any flow panel, flow modal or review resizer', async () => {
    await bootWorkspace();
    for (const id of REMOVED) expect(document.getElementById(id)).toBeNull();
    for (const id of ['flow-modal', 'rv-flow-wrap', 'rv-resizer']) expect(document.getElementById(id)).toBeNull();
  });

  it('opens the Lantern map when a project is first opened', async () => {
    await bootWorkspace();
    vi.mocked(window.ccmws.onOpen).mock.calls[0][0]('/p/alpha', 'alpha');
    expect(document.getElementById('hub')).toBeNull();
    expect(document.getElementById('lantern-tab')!.classList.contains('hidden')).toBe(false);
    expect(document.getElementById('mode-btn')!.getAttribute('aria-checked')).toBe('true');
    expect(document.getElementById('empty')!.classList.contains('hidden')).toBe(true);
  });

  it('the integrations.open command opens Integrations', async () => {
    await bootWorkspace();
    expect(document.getElementById('profile')).toBeNull();
    vi.mocked(window.ccmws.onCommand).mock.calls[0][0]('integrations.open');
    await vi.waitFor(() => expect(document.querySelector('.int-modal')).not.toBeNull());
    document.querySelector<HTMLButtonElement>('.int-modal .modal-close')!.click();
    await vi.waitFor(() => expect(document.querySelector('.int-modal')).toBeNull());
  });

  it('the skills.open command still opens the Skills modal', async () => {
    await bootWorkspace();
    vi.mocked(window.ccmws.onCommand).mock.calls[0][0]('skills.open');
    expect(document.getElementById('skills-modal')!.classList.contains('hidden')).toBe(false);
    expect(window.ccmws.skillsList).toHaveBeenCalled();
  });

  it('the settings.open command opens the Settings dialog', async () => {
    await bootWorkspace();
    vi.mocked(window.ccmws.onCommand).mock.calls[0][0]('settings.open');
    const dialog = document.querySelector('[role="dialog"].st-modal')!;
    expect(dialog.querySelector('.st-row[data-key="graph.foldFilesWhenZoomedOut"]')).not.toBeNull();
    dialog.querySelector<HTMLButtonElement>('.modal-close')!.click();
  });

  it('a command opening a static modal closes Settings first instead of opening underneath it', async () => {
    await bootWorkspace();
    const run = vi.mocked(window.ccmws.onCommand).mock.calls[0][0];
    run('settings.open');
    expect(document.querySelector('.st-modal')).not.toBeNull();
    run('skills.open');
    expect(document.querySelector('.st-modal')).toBeNull();
    expect(document.getElementById('skills-modal')!.classList.contains('hidden')).toBe(false);
  });

  it('Enable microphone still runs the patch and reports through its label', async () => {
    await bootWorkspace();
    const mic = document.getElementById('mic-btn') as HTMLButtonElement;
    mic.click();
    expect(mic.disabled).toBe(true);
    await vi.waitFor(() => expect(mic.querySelector('.mic-fix-label')!.textContent).toMatch(/Enabled/));
    expect(window.ccmws.fixMic).toHaveBeenCalledOnce();
    expect(mic.querySelector('svg')).not.toBeNull();
  });

  it('Enable microphone leaves the button as it was when the warning is cancelled', async () => {
    await bootWorkspace();
    vi.mocked(window.ccmws.fixMic).mockResolvedValue(false);
    const mic = document.getElementById('mic-btn') as HTMLButtonElement;
    const label = mic.querySelector('.mic-fix-label')!.textContent;
    mic.click();
    await vi.waitFor(() => expect(window.ccmws.fixMic).toHaveBeenCalledOnce());
    await vi.waitFor(() => expect(mic.disabled).toBe(false));
    expect(mic.querySelector('.mic-fix-label')!.textContent).toBe(label);
  });

  it('the lantern.open command still opens the Lantern map', async () => {
    const app = await bootWorkspace();
    app.activeKey = '/p/alpha';
    vi.mocked(window.ccmws.onCommand).mock.calls[0][0]('lantern.open');
    expect(document.getElementById('lantern-tab')!.classList.contains('hidden')).toBe(false);
  });
});

describe('project navigation', () => {
  it('renders a stable filter, total count and all projects in the supplied order', async () => {
    await bootWorkspace({ projects: MANY_PROJECTS });
    expect(document.querySelector('#project-filter')).toBeInstanceOf(HTMLInputElement);
    expect(document.getElementById('project-count')!.textContent).toBe('13 projects');
    expect([...document.querySelectorAll('.project-row .name')].map((node) => node.textContent)).toEqual(MANY_PROJECTS.map((project) => project.name));
  });

  it('shows paths so duplicate and long project names remain identifiable', async () => {
    await bootWorkspace({ projects: MANY_PROJECTS });
    const rows = [...document.querySelectorAll('.project-row')];
    expect(rows.slice(0, 3).map((row) => row.querySelector('.state')!.textContent)).toEqual(['work/clients/acme/api', 'orbit/api', 'archive/clients/acme/api']);
    expect(rows[3].querySelector('.name')!.textContent).toBe('Billing portal with an unusually long project name');
    expect(rows[3].querySelector('.state')!.textContent).toContain('unusually-long-directory-name');
    expect(rows[0].querySelector('.project-select')!.getAttribute('aria-label')).toContain('/Users/name/work/clients/acme/api');
  });

  it('filters case-insensitively by name and path and reports the matching count', async () => {
    await bootWorkspace({ projects: MANY_PROJECTS });
    const filter = document.getElementById('project-filter') as HTMLInputElement;
    filter.value = 'API';
    filter.dispatchEvent(new Event('input', { bubbles: true }));
    expect(document.querySelectorAll('.project-row')).toHaveLength(3);
    expect(document.getElementById('project-count')!.textContent).toBe('3 of 13 projects');
    filter.value = 'platform/observability';
    filter.dispatchEvent(new Event('input', { bubbles: true }));
    expect(document.querySelector('.project-row .name')!.textContent).toBe('Observability');
  });

  it('shows recoverable no-results copy and restores all rows when cleared', async () => {
    await bootWorkspace({ projects: MANY_PROJECTS });
    const filter = document.getElementById('project-filter') as HTMLInputElement;
    filter.value = 'not-a-real-project';
    filter.dispatchEvent(new Event('input', { bubbles: true }));
    expect(document.querySelectorAll('.project-row')).toHaveLength(0);
    expect(document.querySelector('.project-no-results')!.textContent).toMatch(/Clear the filter/);
    filter.value = '';
    filter.dispatchEvent(new Event('input', { bubbles: true }));
    expect(document.querySelectorAll('.project-row')).toHaveLength(13);
  });

  it('uses native buttons for selection and independent hide actions', async () => {
    await bootWorkspace({ projects: MANY_PROJECTS });
    const first = document.querySelector('.project-row')!;
    expect(first.querySelector('.project-select')).toBeInstanceOf(HTMLButtonElement);
    expect(first.querySelector('.close')).toBeInstanceOf(HTMLButtonElement);
    expect(first.querySelector('.close')!.getAttribute('aria-label')).toBe('Remove api from sidebar, /Users/name/work/clients/acme/api');
    const apiLabels = [...document.querySelectorAll('.project-row .close')].slice(0, 3).map((button) => button.getAttribute('aria-label'));
    expect(new Set(apiLabels).size).toBe(3);
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    (first.querySelector('.close') as HTMLButtonElement).click();
    expect(window.ccmws.hide).toHaveBeenCalledWith('/Users/name/work/clients/acme/api');
    expect(window.ccmws.opened).not.toHaveBeenCalled();
    expect(window.ccmws.freeProjectMemory).not.toHaveBeenCalled();
    expect(window.confirm).not.toHaveBeenCalled();
  });

  it('switches projects from the selection button and marks the current page', async () => {
    const app = await bootWorkspace({ projects: MANY_PROJECTS });
    const target = [...document.querySelectorAll<HTMLButtonElement>('.project-select')].find((button) => button.textContent!.includes('Payments'))!;
    target.click();
    expect(app.activeKey).toBe('/work/services/payments');
    expect(window.ccmws.opened).toHaveBeenCalledWith('/work/services/payments', 'Payments');
    expect(document.querySelector('.project-select[aria-current="page"]')!.textContent).toContain('Payments');
  });

  it('finds a project by typing, switches to it and marks it as the only active one', async () => {
    const app = await bootWorkspace({ projects: MANY_PROJECTS });
    const filter = document.getElementById('project-filter') as HTMLInputElement;
    filter.value = 'payments';
    filter.dispatchEvent(new Event('input', { bubbles: true }));
    const rows = document.querySelectorAll('.project-row');
    expect(rows).toHaveLength(1);
    rows[0].querySelector<HTMLButtonElement>('.project-select')!.click();
    expect(app.activeKey).toBe('/work/services/payments');
    expect(document.querySelectorAll('.proj.active')).toHaveLength(1);
    expect(document.querySelector('.proj.active .name')!.textContent).toBe('Payments');
    expect(document.querySelectorAll('[aria-current="page"]')).toHaveLength(1);
  });

  it('opens the first match when Enter is pressed in the filter', async () => {
    const app = await bootWorkspace({ projects: MANY_PROJECTS });
    const filter = document.getElementById('project-filter') as HTMLInputElement;
    filter.value = 'storefront';
    filter.dispatchEvent(new Event('input', { bubbles: true }));
    filter.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    expect(app.activeKey).toBe('/work/apps/storefront');
    expect(document.querySelector('.project-select[aria-current="page"]')!.textContent).toContain('Storefront');
  });

  it('clears the filter with Escape and moves between projects with the arrow keys', async () => {
    await bootWorkspace({ projects: MANY_PROJECTS });
    const filter = document.getElementById('project-filter') as HTMLInputElement;
    filter.value = 'api';
    filter.dispatchEvent(new Event('input', { bubbles: true }));
    filter.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
    const selects = [...document.querySelectorAll<HTMLButtonElement>('.project-select')];
    expect(document.activeElement).toBe(selects[0]);
    selects[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
    expect(document.activeElement).toBe(selects[1]);
    selects[1].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true, cancelable: true }));
    selects[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true, cancelable: true }));
    expect(document.activeElement).toBe(filter);
    filter.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    expect(filter.value).toBe('');
    expect(document.querySelectorAll('.project-row')).toHaveLength(13);
  });

  it('keeps session status dots on the rows', async () => {
    await bootWorkspace({ projects: MANY_PROJECTS });
    const dots = [...document.querySelectorAll('.project-row .badge')].map((badge) => badge.className);
    expect(dots[0]).toContain('running');
    expect(dots[4]).toContain('attention');
    expect(dots[1]).toContain('none');
  });

  it('hides the filter in a project window, which has no project list', async () => {
    await bootWorkspace({ projects: MANY_PROJECTS }, '?project=%2Fwork%2Fdocs');
    expect(getComputedStyle(document.getElementById('sidebar')!).display).toBe('none');
  });

  it('keeps the query and selection focus through incoming project updates', async () => {
    await bootWorkspace({ projects: MANY_PROJECTS });
    const filter = document.getElementById('project-filter') as HTMLInputElement;
    filter.value = 'api';
    filter.dispatchEvent(new Event('input', { bubbles: true }));
    const orbit = [...document.querySelectorAll<HTMLButtonElement>('.project-select')].find((button) => button.textContent!.includes('orbit/api'))!;
    orbit.focus();
    const onProjects = vi.mocked(window.ccmws.onProjects).mock.calls[0][0];
    onProjects([...MANY_PROJECTS, { name: 'API playground', path: '/labs/api-playground', sessions: [] }]);
    expect(filter.value).toBe('api');
    expect(document.activeElement?.textContent).toContain('orbit/api');
    expect(document.querySelectorAll('.project-row')).toHaveLength(4);
  });

  it('keeps selection focus after activation rerenders the rows', async () => {
    await bootWorkspace({ projects: MANY_PROJECTS });
    const payments = [...document.querySelectorAll<HTMLButtonElement>('.project-select')].find((button) => button.textContent!.includes('Payments'))!;
    payments.focus();
    payments.click();
    expect(document.activeElement).toBe(document.querySelector('.project-select[aria-current="page"]'));
  });

});

describe('project row memory actions', () => {
  const PROJECTS = [
    { name: 'Docs', path: '/work/docs', sessions: [] as { state: string }[] },
    { name: 'Payments', path: '/work/payments', sessions: [{ state: 'running' }] },
    { name: 'Mobile', path: '/work/mobile', sessions: [{ state: 'done' }] },
  ];

  afterEach(() => vi.restoreAllMocks());

  async function bootOpen(openKeys: string[] = ['/work/docs'], projects = PROJECTS) {
    const app = await bootWorkspace({ projects });
    const disposers = new Map<string, ReturnType<typeof vi.fn>>();
    for (const key of openKeys) {
      const dispose = vi.fn();
      disposers.set(key, dispose);
      const webview = Object.assign(document.createElement('div'), { remove: vi.fn() });
      app.opened.set(key, { webview, watch: { cover: document.createElement('div'), phase: () => 'ready', dispose }, path: key, label: key });
    }
    vi.mocked(window.ccmws.onProjects).mock.calls[0][0](projects);
    return { app, disposers };
  }

  const freeButton = (key: string) => document.querySelector<HTMLButtonElement>(`[data-project-focus="free:${key}"]`);
  const removeButton = (key: string) => document.querySelector<HTMLButtonElement>(`[data-project-focus="close:${key}"]`)!;
  const statusText = () => document.getElementById('status')!.textContent;

  it('gives an open project two different buttons with their own labels, tooltips and icons', async () => {
    await bootOpen();
    const free = freeButton('/work/docs')!;
    const remove = removeButton('/work/docs');
    expect(free).toBeInstanceOf(HTMLButtonElement);
    expect(free.getAttribute('aria-label')).toBe('Free memory of Docs, /work/docs');
    expect(remove.getAttribute('aria-label')).toBe('Remove Docs from sidebar, /work/docs');
    expect(free.dataset.tip).toBe('Free memory: close Docs and stop its editor processes');
    expect(remove.dataset.tip).toBe('Remove Docs from sidebar and free its memory');
    expect(free.querySelector('svg')).not.toBeNull();
    expect(remove.querySelector('svg')).not.toBeNull();
    expect(free.innerHTML).not.toBe(remove.innerHTML);
    expect(free.className).not.toBe(remove.className);
    expect(`${free.textContent}${remove.textContent}`).not.toContain('×');
  });

  it('shows no Free memory button for a project that is not open, and Remove says it only hides', async () => {
    await bootOpen();
    expect(freeButton('/work/payments')).toBeNull();
    expect(freeButton('/work/mobile')).toBeNull();
    expect(removeButton('/work/payments').dataset.tip).toBe('Remove Payments from sidebar');
    expect(document.querySelectorAll('.project-row .free')).toHaveLength(1);
  });

  it('puts both buttons after the selection button in the tab order, as native buttons', async () => {
    await bootOpen();
    const row = document.querySelector('.project-row')!;
    expect([...row.children].map((child) => child.className)).toEqual(['project-select', 'free', 'close']);
    for (const child of row.children) {
      expect(child).toBeInstanceOf(HTMLButtonElement);
      expect((child as HTMLButtonElement).type).toBe('button');
      expect((child as HTMLElement).tabIndex).toBe(0);
    }
  });

  it('Free memory closes the tab, frees the project on the main side and keeps the row', async () => {
    const { app, disposers } = await bootOpen();
    freeButton('/work/docs')!.click();
    expect(disposers.get('/work/docs')).toHaveBeenCalledOnce();
    expect(app.opened.has('/work/docs')).toBe(false);
    expect(window.ccmws.freeProjectMemory).toHaveBeenCalledExactlyOnceWith('/work/docs');
    expect(window.ccmws.hide).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(statusText()).toMatch(/^Freed memory: stopped 3 processes of Docs \(1 extension host, 1 TypeScript server, 1 agent\)\.$/));
    expect([...document.querySelectorAll('.project-row .name')].map((node) => node.textContent)).toEqual(['Docs', 'Payments', 'Mobile']);
    expect(freeButton('/work/docs')).toBeNull();
  });

  it('opens the project fresh when its row is clicked after Free memory', async () => {
    const { app } = await bootOpen();
    freeButton('/work/docs')!.click();
    await vi.waitFor(() => expect(statusText()).toMatch(/^Freed memory/));
    document.querySelector<HTMLButtonElement>('.project-row .project-select')!.click();
    expect(app.activeKey).toBe('/work/docs');
    expect(app.opened.get('/work/docs')!.webview.src).toBe(`http://127.0.0.1:9888/?tkn=tkn&folder=${encodeURIComponent('/work/docs')}`);
    expect(freeButton('/work/docs')).not.toBeNull();
  });

  it('Remove from sidebar closes the tab, frees the project and hides it in one action', async () => {
    const { disposers } = await bootOpen();
    window.ccmws.hide = vi.fn().mockResolvedValue(PROJECTS.slice(1));
    removeButton('/work/docs').click();
    expect(disposers.get('/work/docs')).toHaveBeenCalledOnce();
    expect(window.ccmws.freeProjectMemory).toHaveBeenCalledExactlyOnceWith('/work/docs');
    await vi.waitFor(() => expect(window.ccmws.hide).toHaveBeenCalledExactlyOnceWith('/work/docs'));
    await vi.waitFor(() => expect([...document.querySelectorAll('.project-row .name')].map((node) => node.textContent)).toEqual(['Payments', 'Mobile']));
    expect(statusText()).toMatch(/and removed it from the sidebar/);
  });

  it('Remove from sidebar on a project that is not open only hides it', async () => {
    await bootOpen();
    removeButton('/work/mobile').click();
    await vi.waitFor(() => expect(window.ccmws.hide).toHaveBeenCalledExactlyOnceWith('/work/mobile'));
    expect(window.ccmws.freeProjectMemory).not.toHaveBeenCalled();
  });

  describe.each([
    ['Free memory', (key: string) => freeButton(key)!],
    ['Remove from sidebar', (key: string) => removeButton(key)],
  ])('%s on a project with a running agent', (_label, button) => {
    it('asks first and does nothing when the answer is no', async () => {
      const { app, disposers } = await bootOpen(['/work/payments']);
      const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
      button('/work/payments').click();
      expect(confirm).toHaveBeenCalledOnce();
      expect(confirm.mock.calls[0][0]).toContain('Payments');
      expect(disposers.get('/work/payments')).not.toHaveBeenCalled();
      expect(app.opened.has('/work/payments')).toBe(true);
      expect(window.ccmws.freeProjectMemory).not.toHaveBeenCalled();
      expect(window.ccmws.hide).not.toHaveBeenCalled();
    });

    it('goes ahead when the answer is yes', async () => {
      const { app } = await bootOpen(['/work/payments']);
      vi.spyOn(window, 'confirm').mockReturnValue(true);
      button('/work/payments').click();
      expect(app.opened.has('/work/payments')).toBe(false);
      expect(window.ccmws.freeProjectMemory).toHaveBeenCalledExactlyOnceWith('/work/payments');
    });
  });

  it('does not ask when the only session has finished', async () => {
    await bootOpen(['/work/mobile']);
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    freeButton('/work/mobile')!.click();
    expect(confirm).not.toHaveBeenCalled();
    expect(window.ccmws.freeProjectMemory).toHaveBeenCalledOnce();
  });

  it('closes the tab and says so when the editor host cannot be identified', async () => {
    const { app } = await bootOpen();
    vi.mocked(window.ccmws.freeProjectMemory).mockResolvedValue({ ok: false, reason: 'no-host' });
    freeButton('/work/docs')!.click();
    expect(app.opened.has('/work/docs')).toBe(false);
    await vi.waitFor(() => expect(statusText()).toMatch(/^Closed Docs, but its editor processes were not stopped: its extension host was not found\. The editor server frees them after its reconnection grace time\.$/));
    expect(document.getElementById('status')!.dataset.tip).toBe(statusText());
  });

  it('closes the tab and says so when the request itself fails', async () => {
    const { app } = await bootOpen();
    vi.mocked(window.ccmws.freeProjectMemory).mockRejectedValue(new Error('ipc gone'));
    freeButton('/work/docs')!.click();
    expect(app.opened.has('/work/docs')).toBe(false);
    await vi.waitFor(() => expect(statusText()).toMatch(/^Closed Docs, but its editor processes were not stopped/));
  });

  it('still hides the project on Remove when the host cannot be identified', async () => {
    await bootOpen();
    vi.mocked(window.ccmws.freeProjectMemory).mockResolvedValue({ ok: false, reason: 'no-server' });
    removeButton('/work/docs').click();
    await vi.waitFor(() => expect(window.ccmws.hide).toHaveBeenCalledExactlyOnceWith('/work/docs'));
    await vi.waitFor(() => expect(statusText()).toMatch(/Closed Docs and removed it from the sidebar, but/));
  });

  it('keeps the note on the status line when the server pushes its info again', async () => {
    await bootOpen();
    freeButton('/work/docs')!.click();
    await vi.waitFor(() => expect(statusText()).toMatch(/^Freed memory/));
    vi.mocked(window.ccmws.onInfo).mock.calls[0][0]({ port: 9888, token: 'tkn', ready: true, available: true });
    expect(statusText()).toMatch(/^Freed memory/);
  });

  it('keeps keyboard focus on the project after Free memory removes the button that had it', async () => {
    await bootOpen();
    const free = freeButton('/work/docs')!;
    free.focus();
    free.click();
    expect(document.activeElement).toBe(document.querySelector('[data-project-focus="select:/work/docs"]'));
  });

  it('moves focus to the filter when Remove from sidebar removes the focused row', async () => {
    await bootOpen();
    window.ccmws.hide = vi.fn().mockResolvedValue(PROJECTS.slice(1));
    const remove = removeButton('/work/docs');
    remove.focus();
    remove.click();
    await vi.waitFor(() => expect(document.activeElement).toBe(document.getElementById('project-filter')));
  });

  it('keeps arrow-key navigation between the selection buttons with the action buttons present', async () => {
    await bootOpen();
    const selects = [...document.querySelectorAll<HTMLButtonElement>('.project-select')];
    selects[0].focus();
    selects[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
    expect(document.activeElement).toBe(selects[1]);
  });
});

describe('adding a folder', () => {
  const group = (name: string) => ({ name, path: `/p/${name}`, sessions: [] });

  it('opens the selected new folder when it sorts before several existing projects', async () => {
    const app = await bootWorkspace();
    const groups = [group('aardvark'), group('alpha'), group('middle'), group('zulu')];
    vi.mocked(window.ccmws.addFolder).mockResolvedValue({ groups, selectedPath: '/p/aardvark' });

    document.getElementById('addFolder')!.click();

    await vi.waitFor(() => expect(app.activeKey).toBe('/p/aardvark'));
    expect(window.ccmws.opened).toHaveBeenCalledWith('/p/aardvark', 'aardvark');
    expect(app.groups).toEqual(groups);
  });

  it('opens a selected folder that already exists in the project list', async () => {
    const app = await bootWorkspace();
    const groups = [group('alpha'), group('zulu')];
    vi.mocked(window.ccmws.addFolder).mockResolvedValue({ groups, selectedPath: '/p/alpha' });

    document.getElementById('addFolder')!.click();

    await vi.waitFor(() => expect(app.activeKey).toBe('/p/alpha'));
    expect(window.ccmws.opened).toHaveBeenCalledWith('/p/alpha', 'alpha');
  });

  it('activates a selected folder that is already open in an inactive tab', async () => {
    const app = await bootWorkspace();
    const tab = (isActive: boolean) => ({
      path: isActive ? '/p/zulu' : '/p/alpha',
      label: isActive ? 'zulu' : 'alpha',
      webview: Object.assign(document.createElement('div'), { className: isActive ? 'active' : '' }),
      watch: { cover: Object.assign(document.createElement('div'), { style: `display: ${isActive ? '' : 'none'}` }), phase: () => 'ready' as const, dispose: vi.fn() },
    });
    app.opened.set('/p/alpha', tab(false));
    app.opened.set('/p/zulu', tab(true));
    app.activeKey = '/p/zulu';
    vi.mocked(window.ccmws.addFolder).mockResolvedValue({ groups: [group('alpha'), group('zulu')], selectedPath: '/p/alpha' });

    document.getElementById('addFolder')!.click();

    await vi.waitFor(() => expect(app.activeKey).toBe('/p/alpha'));
    expect(window.ccmws.opened).toHaveBeenCalledWith('/p/alpha', 'alpha');
    expect(app.opened.get('/p/alpha')!.webview.classList.contains('active')).toBe(true);
    expect(app.opened.get('/p/zulu')!.webview.classList.contains('active')).toBe(false);
  });

  it('does not open a project when folder selection is cancelled', async () => {
    const app = await bootWorkspace();
    const groups = [group('alpha'), group('zulu')];
    vi.mocked(window.ccmws.addFolder).mockResolvedValue({ groups, selectedPath: null });

    document.getElementById('addFolder')!.click();

    await vi.waitFor(() => expect(app.groups).toEqual(groups));
    expect(app.activeKey).toBeNull();
    expect(window.ccmws.opened).not.toHaveBeenCalled();
    expect(app.groups).toEqual(groups);
  });
});

describe('command palette field', () => {
  const field = () => document.getElementById('command-palette-btn') as HTMLButtonElement;
  const keys = () => document.getElementById('command-palette-keys')!.textContent;

  it('sits in the app bar between the project name and the mode switch as a named button', () => {
    mountPage();
    expect(field().type).toBe('button');
    expect(accessibleName(field())).toBe('Search commands');
    expect(field().hasAttribute('data-tip')).toBe(false);
    expect(field().querySelector('.command-palette-field-label')!.textContent).toBe('Search commands');
    expect(field().parentElement!.matches('header.appbar')).toBe(true);
    expect(field().previousElementSibling!.matches('#project-ident')).toBe(true);
    expect(field().nextElementSibling!.matches('#mode-btn')).toBe(true);
  });

  it('shows the palette key, and opens the palette', async () => {
    await bootWorkspace();
    await vi.waitFor(() => expect(keys()).toBe('Ctrl+Shift+P'));
    expect(field().getAttribute('aria-keyshortcuts')).toBe('Control+Shift+P');
    expect(display('command-palette-btn')).not.toBe('none');
    field().click();
    expect(document.querySelector('[role="dialog"].pl-modal')).not.toBeNull();
  });

  it('shows the mac label on macOS', async () => {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)');
    await bootWorkspace();
    await vi.waitFor(() => expect(keys()).toBe('⌘⇧P'));
    vi.restoreAllMocks();
  });

  it('a shortcut from main closes the palette before running its command', async () => {
    await bootWorkspace();
    field().click();
    expect(document.querySelector('.pl-modal')).not.toBeNull();
    vi.mocked(window.ccmws.onCommand).mock.calls[0][0]('settings.open');
    expect(document.querySelector('.pl-modal')).toBeNull();
    expect(document.querySelector('.st-modal')).not.toBeNull();
    document.querySelector<HTMLButtonElement>('.st-modal .modal-close')!.click();
  });
  it('follows a rebind of palette.open and clears when it is unbound', async () => {
    await bootWorkspace();
    await vi.waitFor(() => expect(keys()).toBe('Ctrl+Shift+P'));
    const { replaceSettings } = await import('../src/renderer/lib/settings-state');
    const push = (bindings: { key: string; command: string }[]) =>
      replaceSettings({ values: { ...SETTING_DEFAULTS, 'keymap.bindings': bindings }, modified: ['keymap.bindings'], problems: [], writable: true }, ['keymap.bindings']);
    push([{ key: 'mod+shift+k', command: 'palette.open' }]);
    expect(keys()).toBe('Ctrl+Shift+K');
    expect(field().getAttribute('aria-keyshortcuts')).toBe('Control+Shift+K');
    push([{ key: 'mod+shift+p', command: '-palette.open' }]);
    expect(keys()).toBe('');
    expect(field().hasAttribute('aria-keyshortcuts')).toBe(false);
  });
});

describe('editor and map per project', () => {
  it('re-selecting a project you were editing keeps the editor in front', async () => {
    const app = await bootWorkspace();
    const open = vi.mocked(window.ccmws.onOpen).mock.calls[0][0];
    const lantern = () => !document.getElementById('lantern-tab')!.classList.contains('hidden');
    open('/p/alpha', 'alpha');
    expect(lantern()).toBe(true);
    document.getElementById('mode-btn')!.click();
    await vi.waitFor(() => expect(lantern()).toBe(false));
    open('/p/beta', 'beta');
    expect(app.activeKey).toBe('/p/beta');
    expect(lantern()).toBe(true);
    open('/p/alpha', 'alpha');
    expect(app.activeKey).toBe('/p/alpha');
    expect(lantern()).toBe(false);
  });
});
