// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LanternCoverage } from '../src/main/lantern';
import { mapOf, node } from './helpers/lantern-map';

const state = vi.hoisted(() => ({
  app: { lanternFront: new Set<string>(), lanternPlatform: new Map<string, string>(), lanternLang: new Map<string, string>(), lanternSection: new Map<string, string>(), explainCollapsed: new Map<string, boolean>(), lanternPr: new Map<string, string>(), dismissedPrs: new Map<string, string[]>() },
}));

vi.mock('../src/renderer/state', () => ({ activeProjectPath: () => '/proj', providerForProject: () => 'claude', app: state.app }));
vi.mock('../src/renderer/features/agent-run', () => ({ cancelRun: vi.fn(), isBusy: () => false, startRun: vi.fn().mockResolvedValue(undefined) }));

const graph = () => mapOf({ nodes: [node('a.ts', 'page'), node('b.ts', 'service')], coveragePending: true });
const note = () => document.querySelector('.lt-stats')?.textContent ?? '';

async function open(load: ReturnType<typeof vi.fn>, coverage: ReturnType<typeof vi.fn>) {
  document.body.innerHTML = '<div id="main"></div><div id="lantern-tab" class="hidden"></div>';
  window.ccmws = { lanternLoad: load, lanternCoverage: coverage, lanternFetchPrs: vi.fn().mockReturnValue(new Promise(() => undefined)), settingsLanguage: vi.fn().mockResolvedValue('English'), settingsRequestedLanguage: vi.fn().mockResolvedValue(undefined), settingsSetLanguage: vi.fn() } as unknown as Window['ccmws'];
  vi.resetModules();
  return import('../src/renderer/features/lantern');
}

const pending = () => {
  let finish: (v: LanternCoverage) => void = () => undefined;
  const promise = new Promise<LanternCoverage>((r) => (finish = r));
  return { promise, finish };
};

const listeners: [string, EventListener][] = [];

describe('lantern coverage stage', () => {
  beforeEach(() => {
    const add = window.addEventListener.bind(window);
    vi.spyOn(window, 'addEventListener').mockImplementation((type: string, fn: EventListenerOrEventListenerObject, opts?: boolean | AddEventListenerOptions) => {
      listeners.push([type, fn as EventListener]);
      add(type, fn, opts);
    });
    state.app.lanternFront.clear();
    state.app.lanternLang.clear();
  });
  afterEach(() => {
    vi.restoreAllMocks();
    for (const [type, fn] of listeners.splice(0)) window.removeEventListener(type, fn);
  });

  it('draws the graph before coverage arrives and then fills the summary in', async () => {
    const second = pending();
    const load = vi.fn().mockResolvedValue(graph());
    const coverage = vi.fn().mockReturnValue(second.promise);
    const { openLantern } = await open(load, coverage);
    openLantern();
    await vi.waitFor(() => expect(document.querySelector('.lt-root')).not.toBeNull());
    expect(coverage).toHaveBeenCalledTimes(1);
    expect(note()).toBe('2 map records · 0 relations');
    second.finish({ unmapped: ['c.ts'], unmappedCount: 1, total: 3 });
    await vi.waitFor(() => expect(note()).toContain('1 source files unmapped'));
    expect(note()).toContain('2/3 source files mapped');
  });

  it('asks for coverage once per load', async () => {
    const load = vi.fn().mockResolvedValue(graph());
    const coverage = vi.fn().mockResolvedValue({ unmapped: [], unmappedCount: 0, total: 2 });
    const { openLantern } = await open(load, coverage);
    openLantern();
    await vi.waitFor(() => expect(note()).toContain('up to date'));
    expect(load).toHaveBeenCalledTimes(1);
    expect(coverage).toHaveBeenCalledTimes(1);
  });

  it('keeps the known coverage on a reload instead of blanking it', async () => {
    const load = vi.fn().mockResolvedValue(graph());
    const coverage = vi.fn().mockResolvedValue({ unmapped: ['c.ts'], unmappedCount: 1, total: 3 });
    const { openLantern } = await open(load, coverage);
    openLantern();
    await vi.waitFor(() => expect(note()).toContain('1 source files unmapped'));
    const slow = pending();
    coverage.mockReturnValue(slow.promise);
    window.dispatchEvent(new Event('focus'));
    await vi.waitFor(() => expect(load).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(coverage).toHaveBeenCalledTimes(2));
    expect(note()).toContain('1 source files unmapped');
    slow.finish({ unmapped: [], unmappedCount: 0, total: 3 });
    await vi.waitFor(() => expect(note()).toContain('up to date'));
  });

  it('ignores a coverage reply that belongs to a superseded load', async () => {
    const first = pending();
    const load = vi.fn().mockResolvedValue(graph());
    const coverage = vi.fn().mockReturnValueOnce(first.promise).mockResolvedValue({ unmapped: [], unmappedCount: 0, total: 2 });
    const { openLantern } = await open(load, coverage);
    openLantern();
    await vi.waitFor(() => expect(coverage).toHaveBeenCalledTimes(1));
    window.dispatchEvent(new Event('focus'));
    await vi.waitFor(() => expect(note()).toContain('up to date'));
    first.finish({ unmapped: ['x.ts'], unmappedCount: 9, total: 11 });
    await new Promise((r) => setTimeout(r, 20));
    expect(note()).toContain('up to date');
    expect(note()).not.toContain('unmapped');
  });

  it('keeps the known coverage when the coverage request fails', async () => {
    const load = vi.fn().mockResolvedValue(graph());
    const coverage = vi.fn().mockResolvedValueOnce({ unmapped: ['c.ts'], unmappedCount: 1, total: 3 }).mockRejectedValue(new Error('boom'));
    const { openLantern } = await open(load, coverage);
    openLantern();
    await vi.waitFor(() => expect(note()).toContain('1 source files unmapped'));
    window.dispatchEvent(new Event('focus'));
    await vi.waitFor(() => expect(coverage).toHaveBeenCalledTimes(2));
    await new Promise((r) => setTimeout(r, 20));
    expect(note()).toContain('2/3 source files mapped');
  });

  it('asks the main process for fresh data after files changed, and plain data on focus', async () => {
    const load = vi.fn().mockResolvedValue(graph());
    const coverage = vi.fn().mockResolvedValue({ unmapped: [], unmappedCount: 0, total: 2 });
    const { openLantern } = await open(load, coverage);
    openLantern();
    await vi.waitFor(() => expect(coverage).toHaveBeenCalledTimes(1));
    window.dispatchEvent(new Event('focus'));
    await vi.waitFor(() => expect(load).toHaveBeenCalledTimes(2));
    expect(load).toHaveBeenLastCalledWith('/proj', undefined);
    window.dispatchEvent(new Event('mr:files-changed'));
    await vi.waitFor(() => expect(load).toHaveBeenCalledTimes(3));
    expect(load).toHaveBeenLastCalledWith('/proj', undefined, true);
    await vi.waitFor(() => expect(coverage).toHaveBeenLastCalledWith('/proj', true));
  });

  it('does not ask for coverage when the payload is not pending', async () => {
    const load = vi.fn().mockResolvedValue(mapOf({ nodes: [node('a.ts', 'page')], total: 1 }));
    const coverage = vi.fn();
    const { openLantern } = await open(load, coverage);
    openLantern();
    await vi.waitFor(() => expect(document.querySelector('.lt-root')).not.toBeNull());
    expect(coverage).not.toHaveBeenCalled();
  });
});
