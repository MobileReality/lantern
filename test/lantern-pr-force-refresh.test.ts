// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mapOf, node, pr } from './helpers/lantern-map';

const PROJECT = '/proj';
const state = vi.hoisted(() => ({
  app: { lanternFront: new Set<string>(), lanternPlatform: new Map<string, string>(), lanternLang: new Map<string, string>(), lanternSection: new Map<string, string>(), explainCollapsed: new Map<string, boolean>(), lanternPr: new Map<string, string>(), dismissedPrs: new Map<string, string[]>() },
}));

vi.mock('../src/renderer/state', () => ({ activeProjectPath: () => '/proj', providerForProject: () => 'claude', app: state.app }));
vi.mock('../src/renderer/features/agent-run', () => ({ cancelRun: vi.fn(), isBusy: () => false, startRun: vi.fn().mockResolvedValue(undefined) }));

const map = mapOf({ nodes: [node('a.ts', 'page')], prs: [pr('126', { files: [{ path: 'a.ts', kind: 'modified', mapped: true }] })] });

async function openSettled(fetchPrs: ReturnType<typeof vi.fn>) {
  document.body.innerHTML = '<div id="main"></div><div id="lantern-tab" class="hidden"></div>';
  const load = vi.fn().mockResolvedValue(map);
  window.ccmws = { lanternLoad: load, lanternFetchPrs: fetchPrs, settingsLanguage: vi.fn().mockResolvedValue('English'), settingsRequestedLanguage: vi.fn().mockResolvedValue(undefined), settingsSetLanguage: vi.fn() } as unknown as Window['ccmws'];
  vi.resetModules();
  const { openLantern } = await import('../src/renderer/features/lantern');
  openLantern();
  await vi.waitFor(() => expect(document.querySelector('.pr-chip')).not.toBeNull());
  await vi.waitFor(() => expect(fetchPrs).toHaveBeenCalledTimes(1));
  await vi.waitFor(() => expect((document.querySelector('.lt-icon') as HTMLButtonElement).disabled).toBe(false));
}

describe('the refresh button and the host cache', () => {
  beforeEach(() => {
    state.app.lanternFront.clear();
    state.app.lanternPr.clear();
  });

  it('asks the main process to drop the host cache; the automatic fetch does not', async () => {
    const fetchPrs = vi.fn().mockResolvedValue({ ok: true });
    await openSettled(fetchPrs);
    expect(fetchPrs).toHaveBeenLastCalledWith(PROJECT);
    (document.querySelector('.lt-icon') as HTMLButtonElement).click();
    await vi.waitFor(() => expect(fetchPrs).toHaveBeenCalledTimes(2));
    expect(fetchPrs).toHaveBeenLastCalledWith(PROJECT, true);
  });
});
