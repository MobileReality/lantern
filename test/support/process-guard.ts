const BROADCAST_PIDS = new Set([0, 1, -1]);

type Killer = { kill: ((pid: number, signal?: string | number) => unknown) & { guarded?: true } };

export function installProcessGuard(target: Killer) {
  const realKill = target.kill.bind(target);
  target.kill = (pid, signal) => {
    if (signal !== 0 && (!Number.isInteger(pid) || BROADCAST_PIDS.has(pid))) {
      throw new Error(`test tried to signal pid ${pid}, which reaches every process the user owns`);
    }
    return realKill(pid, signal);
  };
  target.kill.guarded = true;
}
