import type { MemoryKind } from '../../shared/memory';
import { readProcessRows, walkTree, type CommandRunner } from '../memory-collect';
import type { ProcessActivity } from './guard';

const SHELL_KIND: MemoryKind = 'shell';
const TRANSIENT_KINDS: ReadonlySet<MemoryKind> = new Set(['git']);
const WORK_CATEGORIES: ReadonlySet<string> = new Set(['agents', 'other']);
// The process listing is taken by a child of Lantern and lists itself.
const OWN_PROBE = /^\/bin\/ps\s/;

export interface ProcessActivityDeps {
  platform: NodeJS.Platform;
  supportedPlatforms: readonly NodeJS.Platform[];
  run: CommandRunner;
  rootPid: number;
}

export async function readProcessActivity({ platform, supportedPlatforms, run, rootPid }: ProcessActivityDeps): Promise<ProcessActivity | null> {
  if (!supportedPlatforms.includes(platform)) return null;
  const rows = await readProcessRows(run);
  if (!rows.some((row) => row.pid === rootPid)) return null;
  const tree = walkTree(rows, rootPid);
  let terminals = 0;
  let running = 0;
  for (const { row, identity } of tree) {
    if (OWN_PROBE.test(row.command)) continue;
    if (identity.kind === SHELL_KIND) terminals++;
    else if (WORK_CATEGORIES.has(identity.category) && !TRANSIENT_KINDS.has(identity.kind)) running++;
  }
  return { terminals, running };
}
