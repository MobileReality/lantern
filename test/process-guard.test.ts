import { describe, expect, it, vi } from 'vitest';
import { installProcessGuard } from './support/process-guard';

function guarded() {
  const real = vi.fn(() => true);
  const target = { kill: real };
  installProcessGuard(target);
  return { real, kill: target.kill };
}

describe('process guard', () => {
  it.each([0, 1, -1, Number.NaN])('refuses to signal pid %s and never reaches the real kill', (pid) => {
    const { real, kill } = guarded();
    expect(() => kill(pid, 'SIGKILL')).toThrow(/every process the user owns/);
    expect(() => kill(pid)).toThrow();
    expect(real).not.toHaveBeenCalled();
  });

  it('lets an existence probe (signal 0) through', () => {
    const { real, kill } = guarded();
    kill(1, 0);
    expect(real).toHaveBeenCalledWith(1, 0);
  });

  it('passes ordinary pids and process groups to the real kill', () => {
    const { real, kill } = guarded();
    kill(4242, 'SIGTERM');
    kill(-4242, 'SIGKILL');
    expect(real).toHaveBeenNthCalledWith(1, 4242, 'SIGTERM');
    expect(real).toHaveBeenNthCalledWith(2, -4242, 'SIGKILL');
  });

  it('is installed on the real process for every test in the suite', () => {
    expect((process.kill as { guarded?: boolean }).guarded).toBe(true);
  });
});
