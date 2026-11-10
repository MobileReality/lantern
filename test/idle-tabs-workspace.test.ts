// @vitest-environment jsdom
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { IDLE_SWEEP_MS } from '../src/renderer/lib/idle-tabs';
import { SETTING_DEFAULTS } from '../src/shared/settings-registry';
import type { SettingValues } from '../src/shared/settings-registry';
import type { Tab } from '../src/renderer/state';

const HTML = fs.readFileSync(path.join(__dirname, '../src/renderer/workspace.html'), 'utf8');
const MINUTE = 60_000;
const START = 1_000_000_000;

type Group = { name: string; path: string; sessions: { state: string }[] };

const group = (name: string, sessions: { state: string }[] = []): Group => ({ name, path: `/p/${name}`, sessions });

function fakeTab(name: string, lastSelectedAt?: number): Tab & { dispose: ReturnType<typeof vi.fn> } {
  const dispose = vi.fn();
  const webview = document.createElement('div');
  document.body.append(webview);
  return { path: `/p/${name}`, label: name, webview, watch: { cover: document.createElement('div'), phase: () => 'ready', dispose }, lastSelectedAt, dispose };
}

async function boot(groups: Group[], overrides: Partial<SettingValues> = {}) {
  vi.resetModules();
  const doc = new DOMParser().parseFromString(HTML, 'text/html');
  doc.querySelectorAll('script').forEach((s) => { s.remove(); });
  document.body.innerHTML = doc.body.innerHTML;
  history.replaceState({}, '', '/');
  const intervals: (() => void)[] = [];
  const realSetInterval = globalThis.setInterval;
  vi.spyOn(globalThis, 'setInterval').mockImplementation(((fn: () => void, ms?: number) => {
    if (ms === IDLE_SWEEP_MS) {
      intervals.push(fn);
      return 0;
    }
    return realSetInterval(fn, ms);
  }) as unknown as typeof setInterval);
  const values = { ...SETTING_DEFAULTS, ...overrides };
  const resolved = (value: unknown) => vi.fn().mockResolvedValue(value);
  const full = { languages: {}, providers: {}, dismissedPrs: {} };
  window.ccmws = {
    info: resolved({ port: 9888, token: 'tkn', ready: true, available: true, graceSeconds: 60 }),
    devInstance: resolved(null),
    diagnosticsNotice: resolved(null),
    updateNotice: resolved(null),
    onUpdateNotice: vi.fn(),
    reportRendererError: resolved({ ok: true }),
    projects: resolved(groups),
    settingsGet: resolved(full),
    settingsSnapshot: resolved({ values, modified: [], problems: [], writable: true }),
    codexHooksStatus: resolved({ ok: true, configured: false }),
    skillsList: resolved({ installed: false, project: null }),
    explainsList: resolved([]),
    lanternCount: resolved(0),
    agentStatus: resolved({ running: false, available: true, provider: 'claude' }),
    cliStatus: resolved(null),
    onSettingsChanged: vi.fn(),
    onCommand: vi.fn(),
    onProjects: vi.fn(),
    onInfo: vi.fn(),
    onOpen: vi.fn(),
    onShowCompare: vi.fn(),
    onAgentEvent: vi.fn(),
    onAgentStatus: vi.fn(),
    onProvider: vi.fn(),
    opened: vi.fn(),
    hide: resolved(groups),
  } as unknown as Window['ccmws'];
  const { app } = await import('../src/renderer/state');
  await import('../src/renderer/workspace');
  await vi.waitFor(() => expect(window.ccmws.settingsGet).toHaveBeenCalled());
  await vi.waitFor(() => expect(app.groups).toEqual(groups));
  await vi.waitFor(() => expect(app.info.ready).toBe(true));
  return { app, sweep: () => intervals.at(-1)!(), info: (graceSeconds: number | null) => (app.info = { ...app.info, graceSeconds }) };
}

const closeIdleOn: Partial<SettingValues> = { 'tabs.closeIdleProjectTabs': true };
const setNow = (ms: number) => vi.spyOn(Date, 'now').mockReturnValue(ms);

afterEach(() => vi.restoreAllMocks());

describe('closing idle project tabs in the workspace', () => {
  it('closes an idle tab, keeps its project row and leaves the selected tab alone', async () => {
    const { app, sweep } = await boot([group('active'), group('idle')], closeIdleOn);
    const idle = fakeTab('idle', START);
    app.opened.set('/p/active', fakeTab('active', START));
    app.opened.set('/p/idle', idle);
    app.activeKey = '/p/active';
    setNow(START + 10 * MINUTE);
    sweep();
    expect(app.opened.has('/p/idle')).toBe(false);
    expect(idle.dispose).toHaveBeenCalledOnce();
    expect(idle.webview.isConnected).toBe(false);
    expect(app.opened.has('/p/active')).toBe(true);
    expect(app.activeKey).toBe('/p/active');
    expect([...document.querySelectorAll('.project-row .name')].map((n) => n.textContent)).toEqual(['active', 'idle']);
  });

  it('opens a fresh tab for the project when its row is clicked again', async () => {
    const { app, sweep } = await boot([group('active'), group('idle')], closeIdleOn);
    app.opened.set('/p/active', fakeTab('active', START));
    app.opened.set('/p/idle', fakeTab('idle', START));
    app.activeKey = '/p/active';
    setNow(START + 10 * MINUTE);
    sweep();
    expect(app.opened.has('/p/idle')).toBe(false);
    document.querySelectorAll<HTMLButtonElement>('.project-row .project-select')[1].click();
    expect(app.activeKey).toBe('/p/idle');
    const reopened = app.opened.get('/p/idle')!;
    expect(reopened.webview.src).toBe(`http://127.0.0.1:9888/?tkn=tkn&folder=${encodeURIComponent('/p/idle')}`);
    expect(reopened.lastSelectedAt).toBe(START + 10 * MINUTE);
  });

  it('closes nothing while the setting is off, however long a tab has been idle', async () => {
    const { app, sweep } = await boot([group('active'), group('idle')]);
    app.opened.set('/p/active', fakeTab('active', START));
    app.opened.set('/p/idle', fakeTab('idle', START));
    app.activeKey = '/p/active';
    setNow(START + 600 * MINUTE);
    sweep();
    expect(app.opened.has('/p/idle')).toBe(true);
  });

  it('closes nothing when the server was not started with the short grace time', async () => {
    const { app, sweep, info } = await boot([group('active'), group('idle')], closeIdleOn);
    info(null);
    app.opened.set('/p/active', fakeTab('active', START));
    app.opened.set('/p/idle', fakeTab('idle', START));
    app.activeKey = '/p/active';
    setNow(START + 600 * MINUTE);
    sweep();
    expect(app.opened.has('/p/idle')).toBe(true);
  });

  it.each(['running', 'permission', 'idle'])('keeps a tab whose agent is %s', async (state) => {
    const { app, sweep } = await boot([group('active'), group('busy', [{ state }])], closeIdleOn);
    app.opened.set('/p/active', fakeTab('active', START));
    app.opened.set('/p/busy', fakeTab('busy', START));
    app.activeKey = '/p/active';
    setNow(START + 600 * MINUTE);
    sweep();
    expect(app.opened.has('/p/busy')).toBe(true);
  });

  it('keeps a blank tab', async () => {
    const { app, sweep } = await boot([group('active')], closeIdleOn);
    const blank = { ...fakeTab('x', START), path: null };
    app.opened.set('/p/active', fakeTab('active', START));
    app.opened.set('blank:1', blank);
    app.activeKey = '/p/active';
    setNow(START + 600 * MINUTE);
    sweep();
    expect(app.opened.has('blank:1')).toBe(true);
  });

  it('restarts the clock when a tab is selected and then left', async () => {
    const { app, sweep } = await boot([group('a'), group('b')], closeIdleOn);
    const tabA = fakeTab('a', START);
    app.opened.set('/p/a', tabA);
    app.opened.set('/p/b', fakeTab('b', START));
    app.activeKey = '/p/b';
    setNow(START + 9 * MINUTE);
    document.querySelector<HTMLButtonElement>('.project-row .project-select')!.click();
    expect(app.activeKey).toBe('/p/a');
    expect(tabA.lastSelectedAt).toBe(START + 9 * MINUTE);
    setNow(START + 12 * MINUTE);
    document.querySelectorAll<HTMLButtonElement>('.project-row .project-select')[1].click();
    expect(app.activeKey).toBe('/p/b');
    setNow(START + 12 * MINUTE + 9 * MINUTE);
    sweep();
    expect(app.opened.has('/p/a')).toBe(true);
    setNow(START + 12 * MINUTE + 10 * MINUTE);
    sweep();
    expect(app.opened.has('/p/a')).toBe(false);
  });

  it('honours the configured idle minutes', async () => {
    const { app, sweep } = await boot([group('active'), group('idle')], { ...closeIdleOn, 'tabs.idleMinutes': 3 });
    app.opened.set('/p/active', fakeTab('active', START));
    app.opened.set('/p/idle', fakeTab('idle', START));
    app.activeKey = '/p/active';
    setNow(START + 3 * MINUTE);
    sweep();
    expect(app.opened.has('/p/idle')).toBe(false);
  });
});
