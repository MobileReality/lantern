import os from 'node:os';
import { collectMemory, runCommand } from './memory-collect';
import { createSampler } from './memory-sampler';
import { MemoryHistory, summarize } from './memory-summary';
import { createMemoryWatch } from './memory-watch';

export const MEMORY_SUPPORTED_PLATFORMS: NodeJS.Platform[] = ['darwin'];

export function createMemoryService({ platform, rootPid, projectPaths }: { platform: NodeJS.Platform; rootPid: number; projectPaths: () => string[] }) {
  const history = new MemoryHistory();
  const sampler = createSampler({
    collect: () => collectMemory({ run: runCommand, rootPid, projectPaths, now: Date.now, installedBytes: os.totalmem }),
    summarize: (sample) => summarize(sample, history),
    reset: () => history.clear(),
    now: Date.now,
    schedule: (run, delayMs) => setTimeout(run, delayMs),
    cancel: (handle) => clearTimeout(handle as NodeJS.Timeout),
    onError: (error) => console.error('Memory sample failed:', (error as Error).message),
  });
  return createMemoryWatch({ supported: MEMORY_SUPPORTED_PLATFORMS.includes(platform), source: sampler });
}
