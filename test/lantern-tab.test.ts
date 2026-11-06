// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mapOf } from './helpers/lantern-map';

const PROJECT = '/proj';

vi.mock('../src/renderer/state', () => ({
  activeProjectPath: () => PROJECT,
  providerForProject: () => 'claude',
  app: { lanternFront: new Set<string>(), lanternPlatform: new Map<string, string>(), lanternLang: new Map<string, string>(), lanternSection: new Map<string, string>(), explainCollapsed: new Map<string, boolean>(), lanternPr: new Map<string, string>(), dismissedPrs: new Map<string, string[]>() },
}));
vi.mock('../src/renderer/features/agent-run', () => ({ cancelRun: vi.fn(), isBusy: () => false, startRun: vi.fn() }));

describe('lantern tab first open', () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="main"></div><div id="lantern-tab" class="hidden"></div>';
    window.ccmws = {
      lanternLoad: vi.fn().mockResolvedValue(mapOf({ exists: false, project: 'proj' })),
    } as unknown as Window['ccmws'];
  });

  it('shows the project panel the first time Lantern is opened', async () => {
    const { openLantern } = await import('../src/renderer/features/lantern');
    openLantern();
    const panel = document.querySelector('.lt-panel');
    expect(panel).not.toBeNull();
    expect(panel!.classList.contains('hidden')).toBe(false);
    expect(document.getElementById('lantern-tab')!.classList.contains('hidden')).toBe(false);
  });

  it('offers no language picker of its own; the map language comes from Settings', async () => {
    vi.resetModules();
    document.getElementById('lantern-tab')!.innerHTML = '';
    const { openLantern } = await import('../src/renderer/features/lantern');
    openLantern();
    await vi.waitFor(() => expect(document.querySelector('.lt-empty .lt-primary')).not.toBeNull());
    expect(document.querySelector('.lt-panel select')).toBeNull();
  });

});

describe('lantern run screen', () => {
  const MAP = mapOf({ project: 'proj' });

  async function startedRun() {
    document.body.innerHTML = '<div id="main"></div><div id="lantern-tab" class="hidden"></div>';
    window.ccmws = { lanternLoad: vi.fn().mockResolvedValue(MAP) } as unknown as Window['ccmws'];
    vi.resetModules();
    const { startRun } = await import('../src/renderer/features/agent-run');
    const { openLantern } = await import('../src/renderer/features/lantern');
    vi.mocked(startRun).mockReset().mockResolvedValue(undefined as never);
    openLantern();
    await vi.waitFor(() => expect(document.querySelector('.lt-primary')).not.toBeNull());
    (document.querySelector('.lt-primary') as HTMLButtonElement).click();
    await vi.waitFor(() => expect(vi.mocked(startRun)).toHaveBeenCalled());
    const handlers = vi.mocked(startRun).mock.calls[0][1] as Required<Parameters<typeof startRun>[1]>;
    return { handlers, log: () => document.querySelector('.ls-log') as HTMLElement, toggle: () => document.querySelector('.ls-toggle') as HTMLButtonElement };
  }

  it('replaces the raw call stream with a run screen whose details start closed', async () => {
    const { handlers, log, toggle } = await startedRun();
    handlers.begin(false);
    handlers.line('→ Bash node plan.mjs . chunk 7', 'tool');
    expect(document.querySelector('.ls-screen')).not.toBeNull();
    expect(document.querySelector('[role="progressbar"]')).not.toBeNull();
    expect(log().classList.contains('hidden')).toBe(true);
    expect(toggle().textContent).toBe('Show details');
    toggle().click();
    expect(log().classList.contains('hidden')).toBe(false);
    expect(toggle().textContent).toBe('Hide details');
    expect(log().textContent).toContain('plan.mjs . chunk 7');
  });

  it('puts a Stop button on the screen and no Cancel button in the head', async () => {
    await startedRun();
    expect(document.querySelector('.ls-stop')).not.toBeNull();
    expect(document.querySelector('.lt-cancel')).toBeNull();
  });

  it('keeps the screen with a Resume button after a failed run', async () => {
    const { handlers } = await startedRun();
    handlers.begin(false);
    handlers.fail('boom');
    expect(document.querySelector('.ls-screen')?.getAttribute('data-state')).toBe('failed');
    expect((document.querySelector('.ls-resume') as HTMLElement).hidden).toBe(false);
    expect(document.querySelector('.ls-note')?.textContent).toContain('boom');
  });
});
