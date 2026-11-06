// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LanternMap } from '../src/main/lantern';
import { mapOf, node } from './helpers/lantern-map';

const PROJECT = '/proj';
const state = vi.hoisted(() => ({
  app: { lanternFront: new Set<string>(), lanternPlatform: new Map<string, string>(), lanternLang: new Map<string, string>(), lanternSection: new Map<string, string>(), explainCollapsed: new Map<string, boolean>(), lanternPr: new Map<string, string>(), dismissedPrs: new Map<string, string[]>() },
  provider: 'claude' as 'claude' | 'codex',
}));

vi.mock('../src/renderer/state', () => ({ activeProjectPath: () => '/proj', app: state.app }));
vi.mock('../src/renderer/lib/providers', async (original) => {
  const actual = await original<typeof import('../src/renderer/lib/providers')>();
  return { ...actual, providerForProject: () => state.provider, assistantName: () => actual.providerLabel(state.provider) };
});
const startRun = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const fixPlanFile = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock('../src/renderer/features/agent-run', () => ({ cancelRun: vi.fn(), fixPlanFile, isBusy: () => false, startRun }));
const openCodeModal = vi.hoisted(() => vi.fn());
vi.mock('../src/renderer/lib/codemodal', async (original) => {
  const actual = await original<typeof import('../src/renderer/lib/codemodal')>();
  return { ...actual, openCodeModal };
});

const platforms = [
  { id: 'web', kind: 'web' as const, label: 'Web', count: 1 },
  { id: 'api', kind: 'backend' as const, label: 'API', count: 1 },
];

function tabbed(extra: Partial<LanternMap> = {}) {
  return mapOf({
    platforms,
    nodes: [node('web/a.ts', 'page', { platform: 'web' }), node('api/b.ts', 'service', { platform: 'api' })],
    ...extra,
  });
}

async function open(load: ReturnType<typeof vi.fn>, expectMap = true) {
  document.body.innerHTML = '<div id="main"></div><div id="lantern-tab" class="hidden"></div>';
  window.ccmws = { lanternLoad: load, lanternFetchPrs: vi.fn().mockResolvedValue({ ok: false, error: 'not a git project with an origin remote' }) } as unknown as Window['ccmws'];
  vi.resetModules();
  const { openLantern } = await import('../src/renderer/features/lantern');
  openLantern();
  await vi.waitFor(() => expect(document.querySelector(expectMap ? '.lt-root' : '.lt-empty')).not.toBeNull());
}

vi.setConfig({ testTimeout: 20_000 });

describe('lantern panel', () => {
  beforeEach(() => {
    state.app.lanternFront.clear();
    state.app.lanternPlatform.clear();
    state.app.lanternLang.clear();
    state.provider = 'claude';
  });

  it('puts the tab strip between the head and the graph, and remembers the tab per project', async () => {
    await open(vi.fn().mockResolvedValue(tabbed()));
    expect(document.querySelectorAll('.lt-plat')).toHaveLength(3);
    (document.querySelector('.lt-plat[data-plat="api"]') as HTMLElement).click();
    expect(state.app.lanternPlatform.get(PROJECT)).toBe('api');
    await open(vi.fn().mockResolvedValue(tabbed()));
    expect(document.querySelector('.lt-plat[aria-selected="true"]')?.getAttribute('data-plat')).toBe('api');
  });

  it('shows no language switch with one language and reloads with the chosen one otherwise', async () => {
    const load = vi.fn().mockResolvedValue(tabbed());
    await open(load);
    expect(document.querySelector('.lt-lang')).toBeNull();
    expect(load).toHaveBeenLastCalledWith(PROJECT, undefined);

    const multi = tabbed({ language: { primary: 'en', code: 'en', available: ['en', 'pl'], fallbackCount: 0, fallbackKeys: [] } });
    const loadMulti = vi.fn().mockResolvedValue(multi);
    await open(loadMulti);
    const select = document.querySelector('.lt-lang') as HTMLSelectElement;
    expect([...select.options].map((o) => o.value)).toEqual(['en', 'pl']);
    select.value = 'pl';
    select.dispatchEvent(new Event('change'));
    expect(state.app.lanternLang.get(PROJECT)).toBe('pl');
    await vi.waitFor(() => expect(loadMulti).toHaveBeenLastCalledWith(PROJECT, 'pl'));
  });

  it('has no map language selector; only a multi-language map offers its viewer switch', async () => {
    const opts = (s: Element | null) => [...(s as HTMLSelectElement).options].map((o) => o.value);
    await open(vi.fn().mockResolvedValue(mapOf({ exists: false })), false);
    expect(document.querySelectorAll('.lt-panel select')).toHaveLength(0);
    const multi = tabbed({ language: { primary: 'en', code: 'en', available: ['en', 'pl'], fallbackCount: 0, fallbackKeys: [] } });
    await open(vi.fn().mockResolvedValue(multi));
    const selects = document.querySelectorAll('.lt-head select');
    expect(selects).toHaveLength(1);
    expect(opts(selects[0])).toEqual(['en', 'pl']);
  });

  it('counts map errors and warnings on the bottom bar, lists them on click and dismisses each warning', async () => {
    await open(vi.fn().mockResolvedValue(tabbed({ warnings: ['platforms:3: unknown kind "x"', 'features:2: unknown area "y"'], errors: ['map/a.lantern:1: first line must be "lantern 1"'] })));
    const button = document.querySelector('.lt-diag-btn') as HTMLButtonElement;
    const list = document.querySelector('.lt-diag-list') as HTMLElement;
    expect(button.querySelector('.is-error')?.textContent).toBe('1');
    expect(button.querySelector('.is-warning')?.textContent).toBe('2');
    expect((document.querySelector('.lt-diag-panel') as HTMLElement).hidden).toBe(true);
    button.click();
    expect((document.querySelector('.lt-diag-panel') as HTMLElement).hidden).toBe(false);
    expect(list.textContent).toContain('unknown kind');
    expect(list.textContent).toContain('first line must be');
    (list.querySelector('.is-warning .lt-diag-action') as HTMLElement).click();
    expect(list.textContent).not.toContain('unknown kind');
    expect(list.textContent).toContain('unknown area');
    (list.querySelector('.is-warning .lt-diag-action') as HTMLElement).click();
    expect(button.querySelector('.is-warning')).toBeNull();
    expect(button.getAttribute('aria-label')).toBe('Problems: 1 error');
    expect(list.querySelector('.is-error .lt-diag-where')?.textContent).toBe('map/a.lantern:1');
    expect(document.querySelector('.lt-warn, .lt-warnings')).toBeNull();
  });

  it('reports no problems on the bar when the map loads clean', async () => {
    await open(vi.fn().mockResolvedValue(tabbed()));
    const button = document.querySelector('.lt-diag-btn') as HTMLButtonElement;
    expect(button.classList.contains('is-clear')).toBe(true);
    expect(button.textContent).toBe('No problems');
    button.click();
    expect((document.querySelector('.lt-diag-panel') as HTMLElement).hidden).toBe(false);
    expect(document.querySelector('.lt-diag-empty')?.textContent).toBe('No problems');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect((document.querySelector('.lt-diag-panel') as HTMLElement).hidden).toBe(true);
  });

  it('summarises missing and unmapped files without any stale wording', async () => {
    await open(vi.fn().mockResolvedValue(mapOf({ nodes: [node('a.ts', 'page'), node('b.ts', 'page', { freshness: 'gone' })], unmappedCount: 2, total: 3 })));
    const note = document.querySelector('.lt-stats')?.textContent ?? '';
    expect(note).toContain('1 missing');
    expect(note).toContain('2 source files unmapped');
    expect(note).not.toMatch(/stale|up to date/i);
  });

  it('says up to date when nothing is missing or unmapped', async () => {
    await open(vi.fn().mockResolvedValue(mapOf({ nodes: [node('a.ts', 'page')], unmappedCount: 0, total: 1 })));
    expect(document.querySelector('.lt-stats')?.textContent).toContain('up to date');
  });

  it('refreshes the setup action when the project provider changes', async () => {
    const load = vi.fn().mockResolvedValue(tabbed());
    state.provider = 'codex';
    await open(load);
    expect(document.querySelector('.lt-actions .lt-primary')?.getAttribute('data-tip')).toContain('Codex');
    state.provider = 'claude';
    window.dispatchEvent(new Event('mr:provider-changed'));
    await vi.waitFor(() => expect(document.querySelector('.lt-actions .lt-primary')?.getAttribute('data-tip')).toContain('Claude'));
    expect(document.querySelector('.lt-actions .lt-primary')?.textContent).toBe('✦ Refresh map');
  });
});

describe('Claude sessions on the bottom bar', () => {
  it('shows the state that most needs the user, and no session when there is none', async () => {
    state.app.groups = [] as never;
    await open(vi.fn().mockResolvedValue(tabbed()));
    const status = () => document.querySelector('.lt-session') as HTMLElement;
    expect(status().textContent).toBe('No Claude session running');
    state.app.groups = [{ name: 'p', path: PROJECT, sessions: [{ state: 'running' }, { state: 'running' }, { state: 'permission' }] }] as never;
    const { syncSessions } = await import('../src/renderer/features/lantern');
    syncSessions();
    expect(status().textContent).toBe('Claude needs you');
    expect(status().classList.contains('is-permission')).toBe(true);
    state.app.groups = [{ name: 'p', path: PROJECT, sessions: [{ state: 'running' }, { state: 'running' }] }] as never;
    syncSessions();
    expect(status().textContent).toBe('Claude working · 2 sessions');
  });

  it('names the assistant each session runs on, not the one picked for Lantern tools, and counts a live shell as work', async () => {
    state.provider = 'codex';
    state.app.groups = [{ name: 'p', path: PROJECT, sessions: [{ state: 'shell', provider: 'claude' }] }] as never;
    await open(vi.fn().mockResolvedValue(tabbed()));
    const status = document.querySelector('.lt-session') as HTMLElement;
    expect(status.textContent).toBe('Claude running a shell');
    expect(status.classList.contains('is-shell')).toBe(true);
    state.provider = 'claude';
  });
});

describe('running from the commands', () => {
  it('starts the refresh from the command for the map in front', async () => {
    startRun.mockClear();
    await open(vi.fn().mockResolvedValue(tabbed()));
    window.ccmws.lanternProgress = vi.fn().mockResolvedValue({ progress: null, unfinished: null }) as never;
    const { refreshMap } = await import('../src/renderer/features/lantern');
    const { hideLantern } = await import('../src/renderer/features/lantern');
    hideLantern();
    expect(state.app.lanternFront.has('/proj')).toBe(false);
    refreshMap();
    expect(state.app.lanternFront.has('/proj')).toBe(true);
    await vi.waitFor(() => expect(startRun).toHaveBeenCalledWith('lantern-refresh', expect.anything()));
  });
});

describe('the problems list', () => {
  const list = () => document.querySelector('.lt-diag-panel:not(.lt-toast) .lt-diag-list') as HTMLElement;
  const rows = () => [...list().querySelectorAll<HTMLElement>('[role="listitem"]')];

  it('counts an identical warning once', async () => {
    await open(vi.fn().mockResolvedValue(tabbed({ warnings: ['platforms:3: unknown kind "x"', 'platforms:3: unknown kind "x"'] })));
    expect(document.querySelector('.lt-diag-btn .is-warning')?.textContent).toBe('1');
  });

  it('opens a problem at its file and line, and moves between rows with the arrow keys', async () => {
    openCodeModal.mockClear();
    await open(vi.fn().mockResolvedValue(tabbed({ errors: ['map/a.lantern:4: bad record', 'map/b.lantern:9: bad hash'] })));
    (document.querySelector('.lt-diag-btn') as HTMLButtonElement).click();
    expect(document.activeElement).toBe(rows()[0]);
    rows()[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    expect(document.activeElement).toBe(rows()[1]);
    rows()[1].dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(openCodeModal).toHaveBeenCalledTimes(1);
    expect(openCodeModal.mock.calls[0][2]).toBe('map/b.lantern');
    expect(openCodeModal.mock.calls[0][8]).toBe(9);
    expect((document.querySelector('.lt-diag-panel:not(.lt-toast)') as HTMLElement).hidden).toBe(true);
  });

  it('lets a toast run out only while its panel is on screen', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    try {
      startRun.mockClear();
      window.ccmws.lanternProgress = vi.fn().mockResolvedValue({ progress: null, unfinished: null }) as never;
      await open(vi.fn().mockResolvedValue(tabbed()));
      (document.querySelector('.lt-actions .lt-primary') as HTMLButtonElement).click();
      await vi.waitFor(() => expect(startRun).toHaveBeenCalled());
      startRun.mock.calls[0][1].fail('boom');
      const toast = () => document.querySelector('.lt-toast') as HTMLElement;
      await vi.waitFor(() => expect(toast().hidden).toBe(false));
      const { hideLantern, openLantern } = await import('../src/renderer/features/lantern');
      hideLantern();
      vi.advanceTimersByTime(10_000);
      openLantern();
      expect(toast().hidden).toBe(false);
      vi.advanceTimersByTime(6_500);
      expect(toast().hidden).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('problems from a run the user started', () => {
  it('pops a failed map refresh up as a toast and keeps it in the list until dismissed', async () => {
    startRun.mockClear();
    window.ccmws.lanternProgress = vi.fn().mockResolvedValue({ progress: null, unfinished: null }) as never;
    await open(vi.fn().mockResolvedValue(tabbed()));
    (document.querySelector('.lt-actions .lt-primary') as HTMLButtonElement).click();
    await vi.waitFor(() => expect(startRun).toHaveBeenCalledWith('lantern-refresh', expect.anything()));
    startRun.mock.calls[0][1].fail('claude CLI not found');
    await vi.waitFor(() => expect(document.querySelector('.lt-toast')?.textContent).toContain('claude CLI not found'));
    const row = document.querySelector('.lt-diag-panel:not(.lt-toast) .lt-diag-item.is-error') as HTMLElement;
    expect(row.textContent).toContain('Map refresh stopped');
    (row.querySelector('.lt-diag-action') as HTMLElement).click();
    expect(document.querySelector('.lt-diag-panel:not(.lt-toast) .lt-diag-item.is-error')).toBeNull();
  });

  it('toggles the problems list from the command, only while the map is in front', async () => {
    await open(vi.fn().mockResolvedValue(tabbed()));
    const { toggleProblems } = await import('../src/renderer/features/lantern');
    const panel = () => document.querySelector('.lt-diag-panel:not(.lt-toast)') as HTMLElement;
    toggleProblems();
    expect(panel().hidden).toBe(false);
    toggleProblems();
    expect(panel().hidden).toBe(true);
    const { hideLantern } = await import('../src/renderer/features/lantern');
    hideLantern();
    toggleProblems();
    expect(panel().hidden).toBe(true);
  });

  it('labels the problems button before any map exists', async () => {
    await open(vi.fn().mockResolvedValue(mapOf({ exists: false, project: 'p' })), false);
    const button = document.querySelector('.lt-diag-btn') as HTMLButtonElement;
    expect(button.textContent).toBe('No problems');
    expect(button.getAttribute('aria-label')).toBe('No problems');
  });
});

describe('a broken plan in the problems list', () => {
  it('offers copy and fix with an agent on its warning', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    const warning = 'plan .lantern/plans/x.plan could not be read: bad header';
    await open(vi.fn().mockResolvedValue(tabbed({ warnings: [warning], brokenPlans: [{ file: 'x.plan', slug: 'x', error: 'bad header', warning }] })));
    const row = document.querySelector('.lt-diag-panel:not(.lt-toast) .lt-diag-item.is-warning') as HTMLElement;
    const labels = [...row.querySelectorAll('.lt-diag-action')].map((b) => b.textContent);
    expect(labels).toHaveLength(3);
    expect(labels[2]).toBe('Dismiss');
    (row.querySelectorAll('.lt-diag-action')[0] as HTMLElement).click();
    await vi.waitFor(() => expect(writeText).toHaveBeenCalledWith(expect.stringContaining('bad header')));
    const actions = () => [...document.querySelectorAll<HTMLElement>('.lt-diag-panel:not(.lt-toast) .lt-diag-item.is-warning .lt-diag-action')];
    const fix = actions()[1].textContent;
    actions()[1].click();
    expect(fixPlanFile).toHaveBeenCalledWith('x.plan', expect.anything());
    expect(actions()[1].textContent).not.toBe(fix);
  });
});
