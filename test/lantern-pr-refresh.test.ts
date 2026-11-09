// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
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

const local = {
  lanternCompareRefs: vi.fn().mockResolvedValue({ branches: [{ name: 'main', date: '1 day ago', subject: 'init' }, { name: 'feat/x', date: '1 hour ago', subject: 'wip' }], base: 'main', current: 'feat/x', dirty: 2 }),
  lanternCompareCommits: vi.fn().mockResolvedValue([{ sha: 'b'.repeat(40), short: 'bbbbbbb', date: '1 hour ago', subject: 'wip' }]),
  lanternCompareStat: vi.fn().mockResolvedValue({ ok: true, files: 3, add: 40, del: 7 }),
  settingsAddLocalReview: vi.fn().mockResolvedValue({}),
  settingsRemoveLocalReview: vi.fn().mockResolvedValue({}),
  lanternPrFileDiff: vi.fn(() => new Promise(() => {})),
  lanternPrFile: vi.fn(() => new Promise(() => {})),
};

async function open(load: ReturnType<typeof vi.fn>, fetchPrs = vi.fn().mockResolvedValue({ ok: true })) {
  document.body.innerHTML = '<div id="main"></div><div id="lantern-tab" class="hidden"></div>';
  let auto = true;
  const routed = vi.fn((project: string) => {
    if (!auto) return fetchPrs(project);
    auto = false;
    return Promise.resolve({ ok: true });
  });
  window.ccmws = { lanternLoad: load, lanternFetchPrs: routed, ...local } as unknown as Window['ccmws'];
  vi.resetModules();
  const { openLantern } = await import('../src/renderer/features/lantern');
  openLantern();
  await vi.waitFor(() => expect(document.querySelector('.lt-root')).not.toBeNull());
  await vi.waitFor(() => expect(load).toHaveBeenCalledTimes(2));
  await vi.waitFor(() => expect((document.querySelector('.lt-icon') as HTMLButtonElement).disabled).toBe(false));
  load.mockClear();
  return fetchPrs;
}

const refreshBtn = () => document.querySelector('.lt-icon') as HTMLButtonElement;

describe('lantern panel pull requests', () => {
  beforeEach(() => {
    state.app.lanternFront.clear();
    state.app.lanternPr.clear();
  });

  it('renders only the add button for a map without pull requests', async () => {
    await open(vi.fn().mockResolvedValue(withPrs([])));
    expect(document.querySelector('.pr-chip')).toBeNull();
    expect(document.querySelector('.lt-prs')?.hasAttribute('hidden')).toBe(false);
    expect(document.querySelector('.pr-add')).not.toBeNull();
    expect(document.querySelector('.lt-pixi-host')).not.toBeNull();
    expect(document.querySelector('.lt-graph')).toBeNull();
    (document.querySelector('.lt-pixi-node-access') as HTMLButtonElement).click();
    expect(document.querySelector('.lt-detail')?.textContent).toContain('a.ts');
  });

  it('picks two points in the compare modal, shows the line counts and selects the new review', async () => {
    const load = vi.fn().mockResolvedValue(withPrs([]));
    await open(load);
    const id = 'local:cmp:main|@';
    const review = pr(id, { title: 'main → working tree', branch: 'working tree', source: 'local', files: [{ path: 'a.ts', kind: 'modified', mapped: true }] });
    load.mockResolvedValue(mapOf({ nodes: [node('a.ts', 'page'), node('b.ts', 'service')], prs: [review] }));
    (document.querySelector('.pr-add') as HTMLButtonElement).click();
    await vi.waitFor(() => expect(document.querySelector('.cmp-summary')?.textContent).toContain('+40'));
    expect(local.lanternCompareStat).toHaveBeenLastCalledWith(PROJECT, 'main', '@');
    const trigger = (side: string, kind: string) => document.querySelector(`.cmp-col[data-side="${side}"] [data-cmp-${kind}] .cmp-trigger`) as HTMLButtonElement;
    const choose = (side: string, kind: string, value: string) => {
      trigger(side, kind).click();
      const pop = [...document.querySelectorAll('.cmp-pop')].find((p) => !(p as HTMLElement).hidden) as HTMLElement;
      (pop.querySelector(`.cmp-opt[data-value="${value}"]`) as HTMLElement).click();
    };
    expect(trigger('base', 'branch').textContent).toContain('main');
    expect(trigger('head', 'branch').textContent).toContain('Working tree');
    expect(trigger('head', 'commit').disabled).toBe(true);
    choose('head', 'branch', 'feat/x');
    expect(local.lanternCompareStat).toHaveBeenLastCalledWith(PROJECT, 'main', 'feat/x');
    await vi.waitFor(() => expect(trigger('head', 'commit').disabled).toBe(false));
    choose('head', 'commit', 'b'.repeat(40));
    expect(local.lanternCompareStat).toHaveBeenLastCalledWith(PROJECT, 'main', 'b'.repeat(40));
    expect(trigger('head', 'commit').querySelector('.cmp-sha')?.textContent).toBe('bbbbbbb');
    choose('head', 'branch', '@');
    await vi.waitFor(() => expect((document.querySelector('[data-cmp-go]') as HTMLButtonElement).disabled).toBe(false));
    (document.querySelector('[data-cmp-go]') as HTMLButtonElement).click();
    await vi.waitFor(() => expect(document.querySelector('.cmp-modal')).toBeNull());
    expect(local.settingsAddLocalReview).toHaveBeenCalledWith(PROJECT, id);
    await vi.waitFor(() => expect(document.querySelector('.pr-chip.pr-local')?.getAttribute('aria-pressed')).toBe('true'));
    expect(document.querySelector('.lt-side .pr-title')?.textContent).toBe('main → working tree');
  });

  it('the refresh button fetches, then reloads, and shows a busy state meanwhile', async () => {
    let finish: (v: { ok: boolean }) => void = () => undefined;
    const fetchPrs = vi.fn().mockReturnValue(new Promise((r) => (finish = r)));
    const load = vi.fn().mockResolvedValue(withPrs(['7']));
    await open(load, fetchPrs);
    expect(load).not.toHaveBeenCalled();
    refreshBtn().click();
    expect(fetchPrs).toHaveBeenCalledWith(PROJECT);
    expect(refreshBtn().disabled).toBe(true);
    expect(refreshBtn().getAttribute('aria-busy')).toBe('true');
    refreshBtn().click();
    expect(fetchPrs).toHaveBeenCalledTimes(1);

    load.mockResolvedValue(withPrs(['9', '7']));
    finish({ ok: true });
    await vi.waitFor(() => expect(document.querySelectorAll('.pr-chip')).toHaveLength(2));
    await vi.waitFor(() => expect(refreshBtn().disabled).toBe(false));
    expect(load).toHaveBeenCalledTimes(1);
    expect(document.querySelector('.lt-diag-item')).toBeNull();
  });

  it('a failed fetch shows a short inline note, still reloads, and never blocks', async () => {
    const fetchPrs = vi.fn().mockResolvedValue({ ok: false, error: 'git fetch failed: could not resolve host\nmore detail' });
    const load = vi.fn().mockResolvedValue(withPrs(['7']));
    await open(load, fetchPrs);
    refreshBtn().click();
    await vi.waitFor(() => expect(document.querySelector('.lt-diag-item')).not.toBeNull());
    expect(document.querySelector('.lt-diag-item .lt-diag-text')?.textContent).toBe('Could not check the remote: git fetch failed: could not resolve host');
    expect(load).toHaveBeenCalledTimes(1);
    expect(refreshBtn().disabled).toBe(false);
    expect(document.querySelector('.pr-chip')).not.toBeNull();
  });

  it('a rejected fetch is reported the same way', async () => {
    const load = vi.fn().mockResolvedValue(withPrs(['7']));
    await open(load, vi.fn().mockRejectedValue(new Error('ipc gone')));
    refreshBtn().click();
    await vi.waitFor(() => expect(document.querySelector('.lt-diag-item .lt-diag-text')?.textContent).toContain('Could not check the remote'));
    expect(refreshBtn().disabled).toBe(false);
  });

  it('remembers the selected pull request per project and restores it', async () => {
    await open(vi.fn().mockResolvedValue(withPrs(['7', '5'])));
    (document.querySelector('.pr-chip[data-pr="5"]') as HTMLElement).click();
    expect(state.app.lanternPr.get(PROJECT)).toBe('5');
    await open(vi.fn().mockResolvedValue(withPrs(['7', '5'])));
    expect(document.querySelector('.pr-head .pr-id')?.textContent).toContain('#5');
    expect(document.querySelector('.pr-chip[data-pr="5"]')?.getAttribute('aria-pressed')).toBe('true');
  });

  it('clears the remembered pull request when a reload no longer has it', async () => {
    const load = vi.fn().mockResolvedValue(withPrs(['7', '5']));
    await open(load);
    (document.querySelector('.pr-chip[data-pr="5"]') as HTMLElement).click();
    load.mockResolvedValue(withPrs(['7']));
    window.dispatchEvent(new Event('focus'));
    await vi.waitFor(() => expect(document.querySelector('.pr-chip[data-pr="5"]')).toBeNull());
    expect(document.querySelector('.pr-head')).toBeNull();
    expect(state.app.lanternPr.get(PROJECT)).toBe('');
  });
});

describe('generated reasons on a local comparison', () => {
  const localId = 'local:cmp:main|@';
  const localMap = (both: boolean): LanternMap =>
    mapOf({
      nodes: [node('a.ts', 'page'), node('b.ts', 'service')],
      prs: [
        pr(localId, {
          source: 'local',
          head: '',
          title: 'main → working tree',
          files: [
            { path: 'a.ts', kind: 'modified', mapped: true, reason: 'Keeps the guard' },
            { path: 'b.ts', kind: 'added', mapped: true, ...(both ? { reason: 'Adds b' } : {}) },
          ],
        }),
      ],
    });
  const button = () => document.querySelector('[data-pr-reasons]') as HTMLButtonElement;

  async function openOn(load: ReturnType<typeof vi.fn>) {
    state.app.lanternPr.clear();
    await open(load);
    (document.querySelector(`.pr-chip[data-pr="${localId}"]`) as HTMLElement).click();
    await vi.waitFor(() => expect(button()).not.toBeNull());
  }

  it('runs on click, shows the busy label, reloads and shows every reason', async () => {
    const load = vi.fn().mockResolvedValue(localMap(false));
    await openOn(load);
    expect(button().textContent).toBe('Write reasons');
    expect(document.querySelectorAll('.pr-reason')).toHaveLength(1);
    let finish: (result: unknown) => void = () => {};
    window.ccmws.lanternLocalReasons = vi.fn(() => new Promise((r) => (finish = r))) as never;
    load.mockResolvedValue(localMap(true));
    button().click();
    await vi.waitFor(() => expect(button().disabled).toBe(true));
    expect(button().textContent).toBe('Writing reasons…');
    finish({ ok: true, written: 1, skipped: 0, left: 0 });
    await vi.waitFor(() => expect(document.querySelector('.pr-context-box')).toBeNull());
    expect(window.ccmws.lanternLocalReasons).toHaveBeenCalledWith('/proj', localId);
    expect(document.querySelectorAll('.pr-reason')).toHaveLength(2);
  });

  it('shows the error and offers the button again when the run fails', async () => {
    await openOn(vi.fn().mockResolvedValue(localMap(false)));
    window.ccmws.lanternLocalReasons = vi.fn().mockResolvedValue({ ok: false, error: 'boom' }) as never;
    button().click();
    await vi.waitFor(() => expect([...document.querySelectorAll('.lt-diag-text')].map((e) => e.textContent)).toContain('Could not write reasons: boom'));
    expect(button().disabled).toBe(false);
    expect(button().textContent).toBe('Write reasons');
  });
});

describe('files outside the map', () => {
  it('opens an unmapped file in the review pane, drops the graph selection and says why there are no connections', async () => {
    const id = 'local:cmp:main|@';
    const map = mapOf({ nodes: [node('a.ts', 'page')], prs: [pr(id, { source: 'local', head: '', files: [{ path: 'a.ts', kind: 'modified', mapped: true }, { path: 'c.ts', kind: 'added', mapped: false }] })] });
    state.app.lanternPr.clear();
    await open(vi.fn().mockResolvedValue(map));
    (document.querySelector(`.pr-chip[data-pr="${id}"]`) as HTMLElement).click();
    await vi.waitFor(() => expect(document.querySelector('.pr-file.off .pr-path[data-pr-go="c.ts"]')).not.toBeNull());
    (document.querySelector('.pr-path[data-pr-go="a.ts"]') as HTMLElement).click();
    await vi.waitFor(() => expect(document.querySelector('.lt-mapnote')?.hasAttribute('hidden')).toBe(true));
    (document.querySelector('.pr-file.off .pr-path[data-pr-go="c.ts"]') as HTMLElement).click();
    await vi.waitFor(() => expect(document.querySelector('.lt-review .lt-code-path')?.textContent).toContain('c.ts'));
    expect(document.querySelector('.pr-file.off')?.classList.contains('sel')).toBe(true);
    expect(document.querySelector('.pr-file:not(.off)')?.classList.contains('sel')).toBe(false);
    const note = document.querySelector('.lt-mapnote') as HTMLElement;
    expect(note.hidden).toBe(false);
    expect(note.textContent).toContain('c.ts is not in the map');
  });

  it('offers to map the missing files and starts the map refresh', async () => {
    const files = [{ path: 'a.ts', kind: 'modified' as const, mapped: true }, { path: 'c.ts', kind: 'added' as const, mapped: false }, { path: 'd.ts', kind: 'added' as const, mapped: false }, { path: 'notes.md', kind: 'added' as const, mapped: false }];
    const map = mapOf({ nodes: [node('a.ts', 'page')], prs: [pr('5', { files })], unmapped: ['c.ts', 'd.ts'], unmappedCount: 2 });
    state.app.lanternPr.clear();
    await open(vi.fn().mockResolvedValue(map));
    (document.querySelector('.pr-chip[data-pr="5"]') as HTMLElement).click();
    await vi.waitFor(() => expect(document.querySelector('[data-pr-map]')).not.toBeNull());
    expect(document.querySelector('[data-pr-map]')?.textContent).toBe('Map 2 missing files');
    expect(document.querySelector('li.pr-file[data-tip="notes.md"] .pr-tag')?.textContent).toBe('not in map');
    const { startRun } = await import('../src/renderer/features/agent-run');
    (document.querySelector('[data-pr-map]') as HTMLElement).click();
    await vi.waitFor(() => expect(startRun).toHaveBeenCalled());
    expect((startRun as ReturnType<typeof vi.fn>).mock.calls[0][0]).toBe('lantern-refresh');
  });
});
