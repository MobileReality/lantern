// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SetupProgress } from '../src/main/setup-progress';
import { mapOf, node } from './helpers/lantern-map';

const PROJECT = '/proj';

vi.mock('../src/renderer/state', () => ({
  activeProjectPath: () => PROJECT,
  providerForProject: () => 'claude',
  app: { lanternFront: new Set<string>(), lanternPlatform: new Map<string, string>(), lanternLang: new Map<string, string>(), lanternSection: new Map<string, string>(), explainCollapsed: new Map<string, boolean>(), lanternPr: new Map<string, string>(), dismissedPrs: new Map<string, string[]>() },
}));
vi.mock('../src/renderer/features/agent-run', () => ({ cancelRun: vi.fn(), isBusy: () => false, startRun: vi.fn() }));

function progress(chunksDone: number, chunksTotal: number): SetupProgress {
  return {
    files: { done: chunksDone * 25, total: chunksTotal * 25 },
    bytes: { done: chunksDone * 1000, total: chunksTotal * 1000 },
    chunks: { done: chunksDone, total: chunksTotal },
    next: chunksDone < chunksTotal ? { id: chunksDone + 1, dir: 'src/renderer/lib', files: 25, pending: 25 } : null,
    features: true,
    platforms: false,
    sections: 0,
  };
}

const INCOMPLETE = mapOf({ project: 'proj', nodes: [node('a.ts', 'page')], unmappedCount: 3, total: 4 });

async function open(map: ReturnType<typeof mapOf>, lanternProgress: ReturnType<typeof vi.fn>) {
  document.body.innerHTML = '<div id="main"></div><div id="lantern-tab" class="hidden"></div>';
  window.ccmws = { lanternLoad: vi.fn().mockResolvedValue(map), lanternProgress } as unknown as Window['ccmws'];
  vi.resetModules();
  const agentRun = await import('../src/renderer/features/agent-run');
  vi.mocked(agentRun.startRun).mockReset().mockResolvedValue(undefined as never);
  vi.mocked(agentRun.cancelRun).mockReset();
  const { openLantern } = await import('../src/renderer/features/lantern');
  openLantern();
  await vi.waitFor(() => expect(document.querySelector('.lt-root, .lt-empty')).not.toBeNull());
  return agentRun;
}

const notice = () => document.querySelector('.lt-diag-item.is-notice') as HTMLElement | null;
const banner = () => ({ get hidden() { return notice() === null; }, querySelector: (sel: string) => notice()?.querySelector(sel) ?? null, get textContent() { return notice()?.textContent ?? ''; } });

describe('resume call to action when the map is incomplete', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('says how many chunks are left when a setup was started and never finished', async () => {
    await open(INCOMPLETE, vi.fn().mockResolvedValue({ progress: progress(11, 42), unfinished: 'lantern' }));
    await vi.waitFor(() => expect(banner().hidden).toBe(false));
    const button = banner().querySelector('button') as HTMLButtonElement;
    expect(button.textContent).toBe('Resume setup (31 of 42 chunks left)');
    expect(banner().textContent).toContain('Setup is unfinished');
  });

  it('starts the setup run again from the call to action, as a resume', async () => {
    const agentRun = await open(INCOMPLETE, vi.fn().mockResolvedValue({ progress: progress(11, 42), unfinished: 'lantern' }));
    await vi.waitFor(() => expect(banner().hidden).toBe(false));
    (banner().querySelector('button') as HTMLButtonElement).click();
    await vi.waitFor(() => expect(agentRun.startRun).toHaveBeenCalledWith('lantern', expect.anything()));
    expect(document.querySelector('.ls-screen')?.getAttribute('data-state')).toBe('running');
    expect(banner().hidden).toBe(true);
  });

  it('resumes a refresh as a refresh', async () => {
    const agentRun = await open(INCOMPLETE, vi.fn().mockResolvedValue({ progress: progress(1, 4), unfinished: 'lantern-refresh' }));
    await vi.waitFor(() => expect(banner().hidden).toBe(false));
    expect(banner().querySelector('button')?.textContent).toBe('Resume refresh (3 of 4 chunks left)');
    (banner().querySelector('button') as HTMLButtonElement).click();
    await vi.waitFor(() => expect(agentRun.startRun).toHaveBeenCalledWith('lantern-refresh', expect.anything()));
  });

  it('shows nothing extra for a map that was not left unfinished', async () => {
    await open(INCOMPLETE, vi.fn().mockResolvedValue({ progress: null, unfinished: null }));
    await new Promise((r) => setTimeout(r, 10));
    expect(banner().hidden).toBe(true);
    expect(document.querySelector('.lt-primary')?.textContent).toContain('Refresh');
  });

  it('turns the Set up button of an empty map into Resume when a setup stopped before writing any map', async () => {
    const agentRun = await open(mapOf({ exists: false }), vi.fn().mockResolvedValue({ progress: progress(0, 42), unfinished: 'lantern' }));
    await vi.waitFor(() => expect(document.querySelector('.lt-empty .lt-primary')?.textContent).toBe('Resume setup (42 of 42 chunks left)'));
    expect(document.querySelectorAll('.lt-empty select')).toHaveLength(0);
    (document.querySelector('.lt-empty .lt-primary') as HTMLButtonElement).click();
    await vi.waitFor(() => expect(agentRun.startRun).toHaveBeenCalledWith('lantern', expect.anything()));
  });
});

describe('stop and resume from the run screen', () => {
  it('stops through the cancel path once, shows how much is done, and resumes', async () => {
    const lanternProgress = vi.fn().mockResolvedValue({ progress: progress(11, 42), unfinished: null });
    const agentRun = await open(mapOf({ exists: false }), lanternProgress);
    (document.querySelector('.lt-empty .lt-primary') as HTMLButtonElement).click();
    await vi.waitFor(() => expect(agentRun.startRun).toHaveBeenCalledTimes(1));
    expect(document.querySelector('.ls-screen')?.getAttribute('data-state')).toBe('running');
    expect(document.querySelector('.ls-title')?.textContent).toBe('Mapping the code');

    const stop = document.querySelector('.ls-stop') as HTMLButtonElement;
    stop.click();
    stop.click();
    expect(agentRun.cancelRun).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => expect(document.querySelector('.ls-screen')?.getAttribute('data-state')).toBe('stopped'));
    await vi.waitFor(() => expect(document.querySelector('.ls-note')?.textContent).toContain('31 chunks left'));
    expect(document.querySelector('.lt-note')?.textContent).toBe('Stopped — 275 of 1050 files mapped');
    expect((document.querySelector('.ls-stop') as HTMLElement).hidden).toBe(true);
    const resume = document.querySelector('.ls-resume') as HTMLButtonElement;
    expect(resume.hidden).toBe(false);
    expect(resume.textContent).toBe('Resume setup (31 of 42 chunks left)');

    resume.click();
    await vi.waitFor(() => expect(agentRun.startRun).toHaveBeenCalledTimes(2));
    expect(document.querySelector('.ls-screen')?.getAttribute('data-state')).toBe('running');
  });

  it('lets the user look at the map so far, and offers Resume there', async () => {
    const lanternProgress = vi.fn().mockImplementation(async (_p: string, mode?: string) => ({ progress: progress(11, 42), unfinished: mode ? null : 'lantern' }));
    const agentRun = await open(INCOMPLETE, lanternProgress);
    (document.querySelector('.lt-primary') as HTMLButtonElement).click();
    await vi.waitFor(() => expect(agentRun.startRun).toHaveBeenCalledTimes(1));
    (document.querySelector('.ls-stop') as HTMLButtonElement).click();
    await vi.waitFor(() => expect(document.querySelector('.ls-screen')?.getAttribute('data-state')).toBe('stopped'));
    (document.querySelector('.ls-view') as HTMLButtonElement).click();
    await vi.waitFor(() => expect(document.querySelector('.lt-root')).not.toBeNull());
    expect(document.querySelector('.ls-screen')).toBeNull();
    await vi.waitFor(() => expect(banner().hidden).toBe(false));
    expect(banner().querySelector('button')?.textContent).toBe('Resume setup (31 of 42 chunks left)');
  });

  it('shows no Resume banner after a run that finished every chunk, and shows it for one that left chunks', async () => {
    const lanternProgress = vi.fn().mockResolvedValue({ progress: progress(42, 42), unfinished: null });
    const agentRun = await open(INCOMPLETE, lanternProgress);
    (document.querySelector('.lt-primary') as HTMLButtonElement).click();
    await vi.waitFor(() => expect(agentRun.startRun).toHaveBeenCalledTimes(1));
    const handlers = vi.mocked(agentRun.startRun).mock.calls[0][1] as { done(ok: boolean, meta: object): void };
    handlers.done(true, { secs: '9s', cost: '', denials: 0 });
    await vi.waitFor(() => expect(document.querySelector('.ls-screen')).toBeNull());
    await new Promise((r) => setTimeout(r, 20));
    expect(banner().hidden).toBe(true);

    lanternProgress.mockResolvedValue({ progress: progress(40, 42), unfinished: 'lantern' });
    (document.querySelector('.lt-primary') as HTMLButtonElement).click();
    await vi.waitFor(() => expect(agentRun.startRun).toHaveBeenCalledTimes(2));
    const second = vi.mocked(agentRun.startRun).mock.calls[1][1] as { done(ok: boolean, meta: object): void };
    second.done(true, { secs: '9s', cost: '', denials: 0 });
    await vi.waitFor(() => expect(document.querySelector('.ls-screen')).toBeNull());
    await vi.waitFor(() => expect(banner().hidden).toBe(false));
    expect(banner().querySelector('button')?.textContent).toBe('Resume refresh (2 of 42 chunks left)');
  });
});
