import fs from 'node:fs';
import path from 'node:path';
import type { CommandRunner } from '../../src/main/memory-collect';

export const ROOT_PID = 4000;
export const PROJECT_WEBAPP = '/Users/dev/GIT/webapp';
export const PROJECT_MOBILE = '/Users/dev/GIT/mobile';

export const fixture = (name: string) => fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'memory', name), 'utf8');

export interface RecordedCall {
  file: string;
  args: string[];
}

export function fakeRunner(overrides: Partial<Record<string, string>> = {}) {
  const calls: RecordedCall[] = [];
  const outputs: Record<string, string> = {
    '/bin/ps': fixture('ps-aged.txt'),
    '/usr/bin/top': fixture('top-footprint.txt'),
    '/usr/sbin/lsof': fixture('lsof-cwd.txt'),
    '/usr/bin/memory_pressure': fixture('memory-pressure.txt'),
    ...overrides,
  };
  const run: CommandRunner = async (file, args) => {
    calls.push({ file, args });
    return outputs[file] ?? '';
  };
  return { run, calls };
}
