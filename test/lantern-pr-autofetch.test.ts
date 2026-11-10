// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LanternMap } from '../src/main/lantern';
import { mapOf, node, pr } from './helpers/lantern-map';

const PROJECT = '/proj';
const state = vi.hoisted(() => ({
  app: { lanternFront: new Set<string>(), lanternPlatform: new Map<string, string>(), lanternLang: new Map<string, string>(), lanternSection: new Map<string, string>(), explainCollapsed: new Map<string, boolean>(), lanternPr: new Map<string, string>(), dismissedPrs: new Map<string, string[]>() },
}));

vi.mock('../src/renderer/state', () => ({ activeProjectPath: () => '/proj', providerForProject: () => 'claude', app: state.app }));
vi.mock('../src/renderer/features/agent-run', () => ({ cancelRun: vi.fn(), isBusy: () => false, startRun: vi.fn().mockResolvedValue(undefined) }));

const withPrs = (ids: string[]): LanternMap =>
  mapOf({
    nodes: [node('a.ts', 'page'), node('b.ts', 'service')],
    prs: ids.map((id) => pr(id, { files: [{ path: 'a.ts', kind: 'modified', mapped: true }] })),
  });

type Mock = ReturnType<typeof vi.fn>;

async function mount(load: Mock, fetchPrs: Mock) {
  document.body.innerHTML = '<div id="main"></div><div id="lantern-tab" class="hidden"></div>';
  window.ccmws = { lanternLoad: load, lanternFetchPrs: fetchPrs, lanternPrFileStats: vi.fn().mockResolvedValue({}) } as unknown as Window['ccmws'];
  vi.resetModules();
  return import('../src/renderer/features/lantern');
}

const rendered = () => vi.waitFor(() => expect(document.querySelector('.lt-root')).not.toBeNull());
const headReload = () => document.querySelector('.lt-icon') as HTMLButtonElement;
const settle = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};

async function openAndSettle(load: Mock, fetchPrs: Mock) {
  const { hideLantern, openLantern } = await mount(load, fetchPrs);
  openLantern();
  await rendered();
  await vi.waitFor(() => expect(load).toHaveBeenCalledTimes(2));
  await settle();
  return { openLantern, hideLantern };
}

const listeners: [string, EventListener][] = [];

describe('lantern automatic fetch', () => {
  beforeEach(() => {
    const add = window.addEventListener.bind(window);
    vi.spyOn(window, 'addEventListener').mockImplementation((type: string, fn: EventListenerOrEventListenerObject, opts?: boolean | AddEventListenerOptions) => {
      listeners.push([type, fn as EventListener]);
      add(type, fn, opts);
    });
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-01-01T10:00:00Z'));
    state.app.lanternFront.clear();
    state.app.lanternPr.clear();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    for (const [type, fn] of listeners.splice(0)) window.removeEventListener(type, fn);
  });

  it('opening the tab fetches once, reloads, and shows the new PR without blocking the first render', async () => {
    let finish: (v: { ok: boolean }) => void = () => undefined;
    const fetchPrs = vi.fn().mockReturnValue(new Promise((r) => (finish = r)));
    const load = vi.fn().mockResolvedValue(withPrs([]));
    const { hideLantern, openLantern } = await mount(load, fetchPrs);
    openLantern();
    await rendered();
    expect(fetchPrs).toHaveBeenCalledTimes(1);
    expect(fetchPrs).toHaveBeenCalledWith(PROJECT);
    expect(document.querySelector('.pr-chip')).toBeNull();
    load.mockResolvedValue(withPrs(['11']));
    finish({ ok: true });
    await vi.waitFor(() => expect(document.querySelector('.pr-chip[data-pr="11"]')).not.toBeNull());
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('a second open within 5 minutes does not fetch; after 5 minutes it does', async () => {
    const fetchPrs = vi.fn().mockResolvedValue({ ok: true });
    const { openLantern, hideLantern } = await openAndSettle(vi.fn().mockResolvedValue(withPrs([])), fetchPrs);
    hideLantern();
    vi.setSystemTime(Date.now() + 4 * 60 * 1000);
    openLantern();
    await rendered();
    await settle();
    expect(fetchPrs).toHaveBeenCalledTimes(1);
    hideLantern();
    vi.setSystemTime(Date.now() + 2 * 60 * 1000);
    openLantern();
    await vi.waitFor(() => expect(fetchPrs).toHaveBeenCalledTimes(2));
  });

  it('window focus while front respects the same throttle', async () => {
    const fetchPrs = vi.fn().mockResolvedValue({ ok: true });
    await openAndSettle(vi.fn().mockResolvedValue(withPrs([])), fetchPrs);
    window.dispatchEvent(new Event('focus'));
    await settle();
    expect(fetchPrs).toHaveBeenCalledTimes(1);
    vi.setSystemTime(Date.now() + 6 * 60 * 1000);
    window.dispatchEvent(new Event('focus'));
    await vi.waitFor(() => expect(fetchPrs).toHaveBeenCalledTimes(2));
  });

  it('a running fetch is not duplicated', async () => {
    const fetchPrs = vi.fn().mockReturnValue(new Promise(() => undefined));
    const { openLantern } = await mount(vi.fn().mockResolvedValue(withPrs([])), fetchPrs);
    openLantern();
    await rendered();
    vi.setSystemTime(Date.now() + 10 * 60 * 1000);
    window.dispatchEvent(new Event('focus'));
    await settle();
    expect(fetchPrs).toHaveBeenCalledTimes(1);
    expect(headReload().disabled).toBe(true);
    expect(headReload().getAttribute('aria-busy')).toBe('true');
  });

  it('the head reload button fetches, then reloads', async () => {
    const fetchPrs = vi.fn().mockResolvedValue({ ok: true });
    const load = vi.fn().mockResolvedValue(withPrs([]));
    await openAndSettle(load, fetchPrs);
    expect(headReload().disabled).toBe(false);
    load.mockResolvedValue(withPrs(['3']));
    headReload().click();
    expect(fetchPrs).toHaveBeenCalledTimes(2);
    await vi.waitFor(() => expect(document.querySelector('.pr-chip[data-pr="3"]')).not.toBeNull());
    expect(load).toHaveBeenCalledTimes(3);
  });

  it('stays silent when the project has no origin', async () => {
    const fetchPrs = vi.fn().mockResolvedValue({ ok: false, error: 'not a git project with an origin remote' });
    await openAndSettle(vi.fn().mockResolvedValue(withPrs([])), fetchPrs);
    expect(document.querySelector('.lt-diag-item')).toBeNull();
  });

  it('shows a dismissible note on other failures', async () => {
    const fetchPrs = vi.fn().mockResolvedValue({ ok: false, error: 'could not resolve host' });
    await openAndSettle(vi.fn().mockResolvedValue(withPrs([])), fetchPrs);
    expect(document.querySelector('.lt-diag-item.is-error .lt-diag-text')?.textContent).toBe('Could not check the remote: could not resolve host');
    (document.querySelector('.lt-diag-item .lt-diag-action') as HTMLElement).click();
    expect(document.querySelector('.lt-diag-item')).toBeNull();
  });

  it('a successful refresh clears the panel note left by a failed automatic fetch', async () => {
    const fetchPrs = vi.fn().mockResolvedValueOnce({ ok: false, error: 'could not resolve host' }).mockResolvedValue({ ok: true });
    await openAndSettle(vi.fn().mockResolvedValue(withPrs(['7'])), fetchPrs);
    expect(document.querySelector('.lt-diag-item.is-error')).not.toBeNull();
    (document.querySelector('.lt-icon') as HTMLElement).click();
    await vi.waitFor(() => expect((document.querySelector('.lt-icon') as HTMLButtonElement).disabled).toBe(false));
    expect(document.querySelector('.lt-diag-item')).toBeNull();
  });

  it('a failed reload reports one problem on the bottom bar, not a second note', async () => {
    const fetchPrs = vi.fn().mockResolvedValue({ ok: false, error: 'could not resolve host' });
    await openAndSettle(vi.fn().mockResolvedValue(withPrs(['7'])), fetchPrs);
    expect(document.querySelectorAll('.lt-diag-item.is-error')).toHaveLength(1);
    (document.querySelector('.lt-icon') as HTMLElement).click();
    await vi.waitFor(() => expect(fetchPrs).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect((document.querySelector('.lt-icon') as HTMLButtonElement).disabled).toBe(false));
    expect(document.querySelectorAll('.lt-diag-item.is-error')).toHaveLength(1);
    expect(document.querySelector('.lt-prs .pr-note')).toBeNull();
  });

  describe('strip focus', () => {
    async function withStrip(ids: string[]) {
      await openAndSettle(vi.fn().mockResolvedValue(withPrs(ids)), vi.fn().mockResolvedValue({ ok: true }));
      expect(document.querySelector('.pr-chip')).not.toBeNull();
    }

    it('returns to the chip that was activated', async () => {
      await withStrip(['7', '5']);
      const chip = () => document.querySelector('.pr-chip[data-pr="5"]') as HTMLElement;
      chip().focus();
      chip().click();
      expect(chip().getAttribute('aria-pressed')).toBe('true');
      expect(document.activeElement).toBe(chip());
    });

    it('does not pull focus back when the user moved it during a refresh', async () => {
      const fetchPrs = vi.fn().mockResolvedValueOnce({ ok: true });
      let finish: (v: { ok: boolean }) => void = () => undefined;
      fetchPrs.mockReturnValueOnce(new Promise((r) => (finish = r)));
      await openAndSettle(vi.fn().mockResolvedValue(withPrs(['7'])), fetchPrs);
      const refresh = headReload;
      refresh().focus();
      refresh().click();
      const other = document.createElement('input');
      document.body.appendChild(other);
      other.focus();
      finish({ ok: true });
      await vi.waitFor(() => expect(refresh().disabled).toBe(false));
      expect(document.activeElement).toBe(other);
    });

    it('returns to the refresh button', async () => {
      await withStrip(['1', '2', '3', '4', '5', '6', '7', '8']);
      const refresh = headReload;
      refresh().focus();
      refresh().click();
      await vi.waitFor(() => expect(refresh().disabled).toBe(false));
      expect(document.activeElement).toBe(refresh());
    });
  });
});
