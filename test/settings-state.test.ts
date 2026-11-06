// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SETTING_DEFAULTS } from '../src/shared/settings-registry';
import type { SettingsSnapshot } from '../src/shared/settings-registry';
import { mapOf } from './helpers/lantern-map';

const FOLD = 'graph.foldFilesWhenZoomedOut';

const mount = vi.hoisted(() =>
  vi.fn((root: HTMLElement, _data: unknown, _opts: unknown) => {
    root.classList.add('lt-root');
    return { setFoldFiles: vi.fn(), update: vi.fn(), dispose: vi.fn() };
  }),
);

vi.mock('../src/renderer/lib/lanternview', () => ({ mountLanternView: mount }));
vi.mock('../src/renderer/state', () => ({
  activeProjectPath: () => '/proj',
  app: { lanternFront: new Set<string>(), lanternPlatform: new Map<string, string>(), lanternLang: new Map<string, string>(), lanternSection: new Map<string, string>(), explainCollapsed: new Map<string, boolean>(), lanternPr: new Map<string, string>(), dismissedPrs: new Map<string, string[]>() },
}));
vi.mock('../src/renderer/features/agent-run', () => ({ cancelRun: vi.fn(), isBusy: () => false, startRun: vi.fn() }));

const folded = (on: boolean): SettingsSnapshot => ({ values: { ...SETTING_DEFAULTS, [FOLD]: on }, modified: [FOLD], problems: [], writable: true });

beforeEach(() => vi.resetModules());

describe('settings state', () => {
  it('starts from the registry defaults', async () => {
    const { settingsSnapshot, settingValue } = await import('../src/renderer/lib/settings-state');
    expect(settingsSnapshot().values).toEqual(SETTING_DEFAULTS);
    expect(settingValue(FOLD)).toBe(SETTING_DEFAULTS[FOLD]);
  });

  it('stores a replaced snapshot and announces the changed keys once', async () => {
    const { onSettingsChanged, replaceSettings, settingValue } = await import('../src/renderer/lib/settings-state');
    const listener = vi.fn();
    const stop = onSettingsChanged(listener);
    replaceSettings(folded(!SETTING_DEFAULTS[FOLD]), [FOLD]);
    expect(settingValue(FOLD)).toBe(!SETTING_DEFAULTS[FOLD]);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith([FOLD]);
    stop();
    replaceSettings(folded(SETTING_DEFAULTS[FOLD]), [FOLD]);
    expect(listener).toHaveBeenCalledTimes(1);
  });
});

describe('startup snapshot', () => {
  it('adopts the snapshot when no push arrived while it loaded', async () => {
    const { beginSettingsLoad, settingValue } = await import('../src/renderer/lib/settings-state');
    const adopt = beginSettingsLoad();
    expect(adopt(folded(false))).toBe(true);
    expect(settingValue(FOLD)).toBe(false);
  });

  it('drops an older snapshot once a push arrived and keeps the pushed value', async () => {
    const { beginSettingsLoad, onSettingsChanged, replaceSettings, settingValue } = await import('../src/renderer/lib/settings-state');
    const adopt = beginSettingsLoad();
    replaceSettings(folded(false), [FOLD]);
    const listener = vi.fn();
    onSettingsChanged(listener);
    expect(adopt(folded(true))).toBe(false);
    expect(settingValue(FOLD)).toBe(false);
    expect(listener).not.toHaveBeenCalled();
  });

  it('adopts a snapshot begun after the last push', async () => {
    const { beginSettingsLoad, replaceSettings, settingValue } = await import('../src/renderer/lib/settings-state');
    replaceSettings(folded(false), [FOLD]);
    const adopt = beginSettingsLoad();
    expect(adopt(folded(true))).toBe(true);
    expect(settingValue(FOLD)).toBe(true);
  });
});

describe('graph folding setting', () => {
  afterEach(() => mount.mockClear());

  async function openGraph() {
    document.body.innerHTML = '<div id="main"></div><div id="lantern-tab" class="hidden"></div>';
    window.ccmws = {
      lanternLoad: vi.fn().mockResolvedValue(mapOf({ project: 'proj' })),
      lanternFetchPrs: vi.fn().mockResolvedValue({ ok: true }),
    } as unknown as Window['ccmws'];
    const state = await import('../src/renderer/lib/settings-state');
    const { openLantern } = await import('../src/renderer/features/lantern');
    return { state, openLantern };
  }

  it('mounts the graph with the stored folding value', async () => {
    const { state, openLantern } = await openGraph();
    state.replaceSettings(folded(false), [FOLD]);
    openLantern();
    await vi.waitFor(() => expect(mount).toHaveBeenCalled());
    expect(mount.mock.calls[0][2]).toMatchObject({ foldFiles: false });
  });

  it('pushes a changed folding value to the open graph', async () => {
    const { state, openLantern } = await openGraph();
    openLantern();
    await vi.waitFor(() => expect(mount).toHaveBeenCalled());
    const view = mount.mock.results[0].value;
    state.replaceSettings(folded(false), [FOLD]);
    expect(view.setFoldFiles).toHaveBeenCalledWith(false);
    view.setFoldFiles.mockClear();
    state.replaceSettings(folded(true), []);
    expect(view.setFoldFiles).not.toHaveBeenCalled();
  });
});
