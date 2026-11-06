// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mapOf, node, pr } from './helpers/lantern-map';

const state = vi.hoisted(() => ({
  app: { lanternFront: new Set<string>(), lanternPlatform: new Map<string, string>(), lanternLang: new Map<string, string>(), lanternSection: new Map<string, string>(), explainCollapsed: new Map<string, boolean>(), lanternPr: new Map<string, string>(), dismissedPrs: new Map<string, string[]>() },
}));

vi.mock('../src/renderer/state', () => ({ activeProjectPath: () => '/proj', providerForProject: () => 'claude', app: state.app }));
vi.mock('../src/renderer/features/agent-run', () => ({ cancelRun: vi.fn(), isBusy: () => false, startRun: vi.fn().mockResolvedValue(undefined) }));

const PROJECT = '/proj';
const first = mapOf({ nodes: [node('a.ts', 'page')], prs: [pr('126', { title: 'Before', files: [{ path: 'a.ts', kind: 'modified', mapped: true }] })] });
const second = mapOf({ nodes: [node('a.ts', 'page')], prs: [pr('126', { title: 'After the remote moved', files: [{ path: 'a.ts', kind: 'modified', mapped: true }] })] });

interface Bridge {
  lanternLoad: ReturnType<typeof vi.fn>;
  lanternEnterPr: ReturnType<typeof vi.fn>;
  lanternRefreshPrs: ReturnType<typeof vi.fn>;
}

async function openSettled(overrides: Partial<Bridge> = {}) {
  document.body.innerHTML = '<div id="main"></div><div id="lantern-tab" class="hidden"></div>';
  const bridge: Bridge = {
    lanternLoad: vi.fn().mockResolvedValue(first),
    lanternEnterPr: vi.fn().mockResolvedValue({ changed: false }),
    lanternRefreshPrs: vi.fn().mockResolvedValue({ ok: true }),
    ...overrides,
  };
  window.ccmws = {
    ...bridge,
    lanternFetchPrs: vi.fn().mockResolvedValue({ ok: true }),
    settingsLanguage: vi.fn().mockResolvedValue('English'),
    settingsRequestedLanguage: vi.fn().mockResolvedValue(undefined),
    settingsSetLanguage: vi.fn(),
  } as unknown as Window['ccmws'];
  vi.resetModules();
  const { openLantern } = await import('../src/renderer/features/lantern');
  openLantern();
  await vi.waitFor(() => expect(document.querySelector('.pr-chip')).not.toBeNull());
  await vi.waitFor(() => expect((document.querySelector('.lt-icon') as HTMLButtonElement).disabled).toBe(false));
  return bridge;
}

const enter = () => (document.querySelector('.pr-chip') as HTMLElement).click();
const titleShown = () => document.querySelector('.lt-side .pr-title')?.textContent;

describe('entering a pull request in the review view', () => {
  beforeEach(() => {
    state.app.lanternFront.clear();
    state.app.lanternPr.clear();
  });

  it('shows the data it has at once and asks the main process to revalidate it in the background', async () => {
    const bridge = await openSettled();
    const loads = bridge.lanternLoad.mock.calls.length;

    enter();

    expect(titleShown()).toBe('Before');
    await vi.waitFor(() => expect(bridge.lanternEnterPr).toHaveBeenCalledWith(PROJECT, '126'));
    expect(bridge.lanternEnterPr).toHaveBeenCalledTimes(1);
    await new Promise((r) => setTimeout(r, 20));
    expect(bridge.lanternLoad).toHaveBeenCalledTimes(loads);
  });

  it('updates the view when the revalidation found the data changed', async () => {
    const bridge = await openSettled({ lanternEnterPr: vi.fn().mockResolvedValue({ changed: true }) });
    bridge.lanternLoad.mockResolvedValue(second);
    const loads = bridge.lanternLoad.mock.calls.length;

    enter();
    expect(titleShown()).toBe('Before');

    await vi.waitFor(() => expect(titleShown()).toBe('After the remote moved'));
    expect(bridge.lanternLoad.mock.calls.length).toBeGreaterThan(loads);
  });
});

describe('the Refresh button in the review view', () => {
  beforeEach(() => {
    state.app.lanternFront.clear();
    state.app.lanternPr.clear();
  });

  const refreshButton = () => document.querySelector('.lt-side [data-pr-refresh]') as HTMLButtonElement;

  it('refreshes the project in the main process, then loads the map again and shows the new data', async () => {
    const bridge = await openSettled();
    enter();
    bridge.lanternLoad.mockResolvedValue(second);
    const loads = bridge.lanternLoad.mock.calls.length;

    refreshButton().click();

    await vi.waitFor(() => expect(titleShown()).toBe('After the remote moved'));
    expect(bridge.lanternRefreshPrs).toHaveBeenCalledWith(PROJECT);
    expect(bridge.lanternLoad.mock.calls.length).toBeGreaterThan(loads);
    expect(bridge.lanternLoad).toHaveBeenLastCalledWith(PROJECT, undefined, true);
  });

  it('shows a busy state while the main process works and the failure message in the same place', async () => {
    let finish: (value: { ok: boolean; error?: string }) => void = () => undefined;
    const bridge = await openSettled({ lanternRefreshPrs: vi.fn(() => new Promise((resolve) => (finish = resolve))) });
    enter();

    refreshButton().click();
    await vi.waitFor(() => expect(refreshButton().getAttribute('aria-busy')).toBe('true'));
    expect(refreshButton().disabled).toBe(true);

    finish({ ok: false, error: 'Could not resolve host: bitbucket.org' });

    await vi.waitFor(() => expect(document.querySelector('.lt-side .pr-refresh-row .pr-reasons-note')?.textContent).toBe('Could not refresh: Could not resolve host: bitbucket.org'));
    expect(refreshButton().disabled).toBe(false);
    expect(bridge.lanternRefreshPrs).toHaveBeenCalledTimes(1);
  });
});
