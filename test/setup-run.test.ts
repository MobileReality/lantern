import { describe, expect, it, vi } from 'vitest';
import type { SetupProgress } from '../src/main/setup-progress';
import { SetupRun } from '../src/renderer/lib/setuprun';
import type { RunHandlers, SetupDeps } from '../src/renderer/lib/setuprun';

function progress(filesDone: number, chunksDone: number, extra: Partial<SetupProgress> = {}): SetupProgress {
  const chunksTotal = 4;
  return {
    files: { done: filesDone, total: 100 },
    bytes: { done: filesDone * 1000, total: 100_000 },
    chunks: { done: chunksDone, total: chunksTotal },
    next: chunksDone < chunksTotal ? { id: chunksDone + 1, dir: `dir${chunksDone + 1}`, files: 25, pending: 25 } : null,
    features: true,
    platforms: false,
    sections: 0,
    ...extra,
  };
}

function harness(initial: SetupProgress | null = progress(0, 0), assistant = 'Claude') {
  let current = initial;
  let clock = 1_000_000;
  const handlers: RunHandlers[] = [];
  const startRun = vi.fn(async (_kind: string, h: RunHandlers) => {
    handlers.push(h);
  });
  const cancelRun = vi.fn();
  const readProgress = vi.fn(async () => current);
  const deps: SetupDeps = { project: '/proj', assistant: () => assistant, startRun, cancelRun, readProgress, now: () => clock };
  const run = new SetupRun(deps);
  return {
    run,
    startRun,
    cancelRun,
    readProgress,
    handlers,
    setProgress: (p: SetupProgress | null) => (current = p),
    advance: (ms: number) => (clock += ms),
    last: () => handlers[handlers.length - 1],
  };
}

const settle = () => new Promise((r) => setTimeout(r, 0));

describe('setup run state machine', () => {
  it('goes running -> stopped -> resumed -> done', async () => {
    const h = harness();
    expect(h.run.state.phase).toBe('idle');

    await h.run.start('lantern');
    expect(h.run.state.phase).toBe('running');
    expect(h.startRun).toHaveBeenCalledTimes(1);
    expect(h.startRun.mock.calls[0][0]).toBe('lantern');

    h.setProgress(progress(25, 1));
    h.run.stop();
    expect(h.run.state.phase).toBe('stopped');
    await settle();
    expect(h.run.state.progress?.files.done).toBe(25);
    expect(h.run.canResume()).toBe(true);

    await h.run.resume();
    expect(h.run.state.phase).toBe('running');
    expect(h.run.state.resumed).toBe(true);
    expect(h.startRun).toHaveBeenCalledTimes(2);
    expect(h.startRun.mock.calls[1][0]).toBe('lantern');
    expect(h.run.state.baseline?.files.done).toBe(25);

    h.setProgress(progress(100, 4));
    h.last().done(true, { cost: '$0.10', secs: '42s', denials: 0 });
    expect(h.run.state.phase).toBe('done');
    expect(h.run.state.summary).toBe('42s · $0.10');
  });

  it('calls the cancel path once however many times Stop is pressed', async () => {
    const h = harness();
    await h.run.start('lantern');
    h.run.stop();
    h.run.stop();
    h.run.stop();
    expect(h.cancelRun).toHaveBeenCalledTimes(1);
    h.last().cancelled();
    expect(h.cancelRun).toHaveBeenCalledTimes(1);
    expect(h.run.state.phase).toBe('stopped');
  });

  it('does not offer Resume until an asynchronous (Codex) cancel releases the runner slot', async () => {
    const h = harness();
    let release = () => {};
    h.cancelRun.mockReturnValueOnce(new Promise<void>((resolve) => (release = resolve)));
    await h.run.start('lantern');
    h.run.stop();
    expect(h.run.state.phase).toBe('stopped');
    expect(h.run.canResume()).toBe(false);
    await h.run.resume();
    expect(h.startRun).toHaveBeenCalledTimes(1);
    release();
    await h.run.settled();
    expect(h.run.canResume()).toBe(true);
    await h.run.resume();
    expect(h.startRun).toHaveBeenCalledTimes(2);
  });

  it('cancels before it redraws as stopped, so Resume is not drawn while the app still counts a run', async () => {
    const h = harness();
    await h.run.start('lantern');
    const phaseAtCancel: string[] = [];
    h.cancelRun.mockImplementation(() => phaseAtCancel.push(h.run.state.phase));
    h.run.stop();
    expect(phaseAtCancel).toEqual(['running']);
  });

  it('does not touch the cancel path when stopped before the run was launched', async () => {
    const h = harness();
    let release: (p: SetupProgress | null) => void = () => {};
    h.readProgress.mockImplementationOnce(() => new Promise((resolve) => (release = resolve)));
    const started = h.run.start('lantern');
    h.run.stop();
    release(progress(0, 0));
    await started;
    expect(h.cancelRun).not.toHaveBeenCalled();
    expect(h.startRun).not.toHaveBeenCalled();
    expect(h.run.state.phase).toBe('stopped');
  });

  it('ignores events from a run that was stopped', async () => {
    const h = harness();
    await h.run.start('lantern');
    const first = h.last();
    h.run.stop();
    first.line('late line');
    first.tool('Read', '/proj/a.ts');
    first.done(true, { cost: '', secs: '', denials: 0 });
    first.fail('boom');
    expect(h.run.state.phase).toBe('stopped');
    expect(h.run.log.map((l) => l.text)).not.toContain('late line');
  });

  it('does not start a second run while one is going', async () => {
    const h = harness();
    await h.run.start('lantern');
    await h.run.start('lantern');
    expect(h.startRun).toHaveBeenCalledTimes(1);
  });

  it('only resumes from stopped or failed', async () => {
    const h = harness();
    await h.run.resume();
    expect(h.startRun).not.toHaveBeenCalled();
    await h.run.start('lantern-refresh');
    await h.run.resume();
    expect(h.startRun).toHaveBeenCalledTimes(1);
  });

  it('resumes the kind it was running', async () => {
    const h = harness();
    await h.run.start('lantern-refresh');
    h.run.stop();
    await h.run.settled();
    await h.run.resume();
    expect(h.startRun.mock.calls[1][0]).toBe('lantern-refresh');
  });

  it('fails with the run error, keeps what was mapped, and offers Resume', async () => {
    const h = harness();
    await h.run.start('lantern');
    h.setProgress(progress(25, 1));
    h.last().fail('claude exited 1');
    await settle();
    expect(h.run.state.phase).toBe('failed');
    expect(h.run.state.error).toBe('claude exited 1');
    expect(h.run.state.progress?.chunks.done).toBe(1);
    expect(h.run.canResume()).toBe(true);
  });

  it('reports a run that finished without success as failed, with its denials', async () => {
    const h = harness();
    await h.run.start('lantern');
    h.last().done(false, { cost: '', secs: '', denials: 2 });
    expect(h.run.state.phase).toBe('failed');
    expect(h.run.state.error).toContain('2 permission denial');
  });

  it('turns a start that throws into a failed run', async () => {
    const h = harness();
    h.startRun.mockRejectedValueOnce(new Error('ipc down'));
    await h.run.start('lantern');
    expect(h.run.state.phase).toBe('failed');
    expect(h.run.state.error).toBe('ipc down');
  });

  it('stops when the run is cancelled from elsewhere, without cancelling again', async () => {
    const h = harness();
    await h.run.start('lantern');
    h.last().cancelled();
    expect(h.run.state.phase).toBe('stopped');
    expect(h.cancelRun).not.toHaveBeenCalled();
  });

  it('keeps one log across a resume and marks where it continued', async () => {
    const h = harness();
    await h.run.start('lantern');
    h.last().line('first sitting');
    h.run.stop();
    await h.run.settled();
    await h.run.resume();
    h.last().line('second sitting');
    expect(h.run.log.map((l) => l.text)).toEqual(['first sitting', '— resumed —', 'second sitting']);
  });

  it('can be dismissed once it is not running, and not while it is', async () => {
    const h = harness();
    await h.run.start('lantern');
    h.run.dismiss();
    expect(h.run.state.phase).toBe('running');
    h.run.stop();
    h.run.dismiss();
    expect(h.run.state.phase).toBe('idle');
  });

  it('turns a tool call into the rolling activity line', async () => {
    const h = harness();
    await h.run.start('lantern');
    h.last().tool('Bash', 'node /proj/.claude/skills/lantern-setup/scripts/plan.mjs . chunk 7');
    expect(h.run.state.activity).toBe('Reading chunk 7');
    h.last().tool('Write', '/proj/.lantern/map/src/renderer/lib.lantern');
    expect(h.run.state.activity).toBe('Writing the map for src/renderer/lib');
  });

  it('shows the selected assistant while a run starts', async () => {
    const h = harness(progress(0, 0), 'Codex');
    await h.run.start('lantern');
    expect(h.run.state.activity).toBe('Starting Codex…');
    h.last().begin(false);
    expect(h.run.log.at(-1)?.text).toBe('Starting Codex…');
  });
});

describe('setup run polling', () => {
  it('polls every two seconds while running and moves the bar', async () => {
    const h = harness();
    await h.run.start('lantern');
    h.readProgress.mockClear();

    await h.run.tick();
    expect(h.readProgress).not.toHaveBeenCalled();

    h.advance(2100);
    h.setProgress(progress(50, 2));
    await h.run.tick();
    expect(h.readProgress).toHaveBeenCalledTimes(1);
    expect(h.readProgress).toHaveBeenCalledWith('live');
    expect(h.run.view().fraction).toBe(0.5);
    expect(h.run.view().chunkText).toBe('chunk 3 of 4');
  });

  it('does not poll once stopped', async () => {
    const h = harness();
    await h.run.start('lantern');
    h.run.stop();
    await settle();
    h.readProgress.mockClear();
    h.advance(10_000);
    await h.run.tick();
    expect(h.readProgress).not.toHaveBeenCalled();
  });

  it('takes the first snapshot as the baseline when the one before the run never arrived', async () => {
    const h = harness();
    h.readProgress.mockRejectedValueOnce(new Error('slow'));
    await h.run.start('lantern-refresh');
    expect(h.run.state.baseline).toBeNull();
    h.advance(2100);
    h.setProgress(progress(10, 0));
    await h.run.tick();
    expect(h.run.state.baseline?.files.done).toBe(10);
  });

  it('counts elapsed time of this sitting only', async () => {
    const h = harness();
    await h.run.start('lantern');
    h.advance(90_000);
    h.run.stop();
    h.advance(600_000);
    expect(h.run.view().elapsedMs).toBe(90_000);
    await h.run.settled();
    await h.run.resume();
    h.advance(5_000);
    expect(h.run.view().elapsedMs).toBe(5_000);
  });
});
