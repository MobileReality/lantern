// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LanternMap } from '../src/main/lantern';
import { mapOf, node, pr } from './helpers/lantern-map';

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

async function mount(api: Record<string, Mock>) {
  document.body.innerHTML = '<div id="main"></div><div id="lantern-tab" class="hidden"></div>';
  window.ccmws = { lanternFetchPrs: vi.fn().mockResolvedValue({ ok: true }), ...api } as unknown as Window['ccmws'];
  vi.resetModules();
  return import('../src/renderer/features/lantern');
}

const rendered = () => vi.waitFor(() => expect(document.querySelector('.lt-root')).not.toBeNull());
const settle = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
};
const firstNode = () => document.querySelector('.lt-pixi-node-access');
const focus = async () => {
  window.dispatchEvent(new Event('focus'));
  await settle();
};

async function openAndSettle(load: Mock, stamp: Mock) {
  const { openLantern } = await mount({ lanternLoad: load, lanternStamp: stamp });
  openLantern();
  await rendered();
  await vi.waitFor(() => expect(load).toHaveBeenCalledTimes(1));
  await settle();
  return load;
}

const listeners: [string, EventListener][] = [];

describe('lantern window focus', () => {
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

  it('loads nothing and redraws nothing when the stamp is unchanged', async () => {
    const stamp = vi.fn().mockResolvedValue('same');
    const load = await openAndSettle(vi.fn().mockResolvedValue(withPrs([])), stamp);
    const drawn = firstNode();
    stamp.mockClear();
    await focus();
    await focus();
    expect(stamp).toHaveBeenCalledTimes(2);
    expect(load).toHaveBeenCalledTimes(1);
    expect(firstNode()).toBe(drawn);
  });

  it('reloads and redraws when the stamp changed', async () => {
    const stamp = vi.fn().mockResolvedValue('one');
    const load = await openAndSettle(vi.fn().mockResolvedValue(withPrs([])), stamp);
    stamp.mockResolvedValue('two');
    load.mockResolvedValue(withPrs(['5']));
    await focus();
    await vi.waitFor(() => expect(document.querySelector('.pr-chip[data-pr="5"]')).not.toBeNull());
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('compares with the stamp taken when the last load began, not the one before', async () => {
    const stamp = vi.fn().mockResolvedValue('one');
    const load = await openAndSettle(vi.fn().mockResolvedValue(withPrs([])), stamp);
    stamp.mockResolvedValue('two');
    await focus();
    await vi.waitFor(() => expect(load).toHaveBeenCalledTimes(2));
    await settle();
    await focus();
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('takes the stamp before it loads, so a write during the load shows up as a change', async () => {
    const order: string[] = [];
    const stamp = vi.fn().mockImplementation(async () => {
      order.push('stamp');
      return 'one';
    });
    const load = vi.fn().mockImplementation(async () => {
      order.push('load');
      return withPrs([]);
    });
    await openAndSettle(load, stamp);
    expect(order.slice(0, 2)).toEqual(['stamp', 'load']);
  });

  it('reloads after five minutes even when the stamp is unchanged, because source files are not in it', async () => {
    const stamp = vi.fn().mockResolvedValue('same');
    const load = await openAndSettle(vi.fn().mockResolvedValue(withPrs([])), stamp);
    vi.setSystemTime(Date.now() + 6 * 60 * 1000);
    await focus();
    await vi.waitFor(() => expect(load).toHaveBeenCalledTimes(2));
    await settle();
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('reloads when the stamp cannot be read', async () => {
    const stamp = vi.fn().mockResolvedValue('one');
    const load = await openAndSettle(vi.fn().mockResolvedValue(withPrs([])), stamp);
    stamp.mockRejectedValue(new Error('no access'));
    await focus();
    await vi.waitFor(() => expect(load).toHaveBeenCalledTimes(2));
  });

  it('still reloads on files-changed when the stamp is unchanged', async () => {
    const stamp = vi.fn().mockResolvedValue('same');
    const load = await openAndSettle(vi.fn().mockResolvedValue(withPrs([])), stamp);
    window.dispatchEvent(new Event('mr:files-changed'));
    await vi.waitFor(() => expect(load).toHaveBeenCalledTimes(2));
  });

  it('the reload button always loads', async () => {
    const stamp = vi.fn().mockResolvedValue('same');
    const load = await openAndSettle(vi.fn().mockResolvedValue(withPrs([])), stamp);
    (document.querySelector('.lt-icon') as HTMLButtonElement).click();
    await vi.waitFor(() => expect(load).toHaveBeenCalledTimes(2));
  });

  it('an automatic fetch that changed nothing does not load a second time', async () => {
    const stamp = vi.fn().mockResolvedValue('same');
    const load = await openAndSettle(vi.fn().mockResolvedValue(withPrs([])), stamp);
    vi.setSystemTime(Date.now() + 6 * 60 * 1000);
    await focus();
    await vi.waitFor(() => expect(window.ccmws.lanternFetchPrs).toHaveBeenCalledTimes(2));
    await settle();
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('an automatic fetch that moved the remote refs loads the new pull requests', async () => {
    const stamp = vi.fn().mockResolvedValue('one');
    const load = await openAndSettle(vi.fn().mockResolvedValue(withPrs([])), stamp);
    stamp.mockResolvedValue('two');
    load.mockResolvedValue(withPrs(['9']));
    vi.setSystemTime(Date.now() + 6 * 60 * 1000);
    await focus();
    await vi.waitFor(() => expect(document.querySelector('.pr-chip[data-pr="9"]')).not.toBeNull());
  });

  it('does nothing when the Lantern tab is not in front', async () => {
    const stamp = vi.fn().mockResolvedValue('same');
    const load = await openAndSettle(vi.fn().mockResolvedValue(withPrs([])), stamp);
    state.app.lanternFront.clear();
    stamp.mockClear();
    await focus();
    expect(stamp).not.toHaveBeenCalled();
    expect(load).toHaveBeenCalledTimes(1);
  });
});
