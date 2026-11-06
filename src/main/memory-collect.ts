import { execFile } from 'node:child_process';
import type { MemoryCategory, MemoryKind } from '../shared/memory';
import { attributeProjects } from './memory-attribute';
import { classifyProcess, type ProcessIdentity } from './memory-classify';
import { parseLsofCwd, parseMemoryPressure, parsePsAged, parseTopFootprint, type AgedProcRow } from './memory-parse';
import { descendantsOf } from './proctree';

export type CommandRunner = (file: string, args: string[]) => Promise<string>;

export interface SampledProcess {
  pid: number;
  ppid: number;
  category: MemoryCategory;
  kind: MemoryKind;
  name: string;
  label: string;
  projectPath: string | null;
  ageSeconds: number;
  bytes: number;
}

export interface MemorySample {
  takenAt: number;
  sampleMs: number;
  processes: SampledProcess[];
  installedBytes: number | null;
  freePercent: number | null;
}

export interface CollectDeps {
  run: CommandRunner;
  rootPid: number;
  projectPaths: () => string[];
  now: () => number;
  installedBytes: () => number;
}

const PS = '/bin/ps';
const TOP = '/usr/bin/top';
const LSOF = '/usr/sbin/lsof';
const MEMORY_PRESSURE = '/usr/bin/memory_pressure';
const PS_ARGS = ['-A', '-ww', '-o', 'pid=,ppid=,etime=,stat=,command='];
const COMMAND_TIMEOUT_MS = 10_000;
const COMMAND_MAX_BUFFER = 32 * 1024 * 1024;

export const runCommand: CommandRunner = (file, args) =>
  new Promise((resolve) => {
    execFile(file, args, { maxBuffer: COMMAND_MAX_BUFFER, timeout: COMMAND_TIMEOUT_MS, windowsHide: true }, (_error, stdout) => resolve(String(stdout ?? '')));
  });

const isPid = (value: number) => Number.isSafeInteger(value) && value > 0;
const isLive = (stat: string) => !stat.startsWith('Z');

export const topArgs = (pids: number[]) => ['-l', '1', '-stats', 'pid,mem', ...pids.flatMap((pid) => ['-pid', String(pid)])];
export const lsofArgs = (pids: number[]) => ['-a', '-d', 'cwd', '-Fpn', '-p', pids.join(',')];

export interface TreeEntry {
  row: AgedProcRow;
  identity: ProcessIdentity;
}

export async function readProcessRows(run: CommandRunner) {
  return parsePsAged(await run(PS, PS_ARGS));
}

export function walkTree(rows: AgedProcRow[], rootPid: number): TreeEntry[] {
  const inTree = new Set([rootPid, ...descendantsOf(rows, rootPid)]);
  return rows
    .filter((row) => inTree.has(row.pid) && isLive(row.stat) && isPid(row.pid))
    .map((row) => ({ row, identity: classifyProcess(row.command, { pid: row.pid, ppid: row.ppid, rootPid }) }));
}

export function readWorkingDirectories(run: CommandRunner, tree: TreeEntry[]) {
  const pids = tree.filter(({ identity }) => identity.category !== 'app').map(({ row }) => row.pid);
  return pids.length ? run(LSOF, lsofArgs(pids)) : Promise.resolve('');
}

export function attributeTree(tree: TreeEntry[], lsofText: string, projectPaths: string[]) {
  return attributeProjects(
    tree.map(({ row, identity }) => ({ pid: row.pid, ppid: row.ppid, kind: identity.kind, command: row.command })),
    parseLsofCwd(lsofText),
    projectPaths,
  );
}

export async function collectMemory({ run, rootPid, projectPaths, now, installedBytes }: CollectDeps): Promise<MemorySample> {
  const started = now();
  const rows = await readProcessRows(run);
  if (!rows.some((row) => row.pid === rootPid)) throw new Error('The process list does not contain Lantern');
  const tree = walkTree(rows, rootPid);
  const [top, lsof, pressure] = await Promise.all([run(TOP, topArgs(tree.map(({ row }) => row.pid))), readWorkingDirectories(run, tree), run(MEMORY_PRESSURE, ['-Q'])]);
  const footprint = parseTopFootprint(top);
  if (!footprint.has(rootPid)) throw new Error('top did not report a footprint for Lantern');
  const projectOf = attributeTree(tree, lsof, projectPaths());
  const processes = tree.flatMap(({ row, identity }) => {
    const bytes = footprint.get(row.pid);
    if (bytes === undefined) return [];
    return [{ ...identity, pid: row.pid, ppid: row.ppid, projectPath: projectOf.get(row.pid) ?? null, ageSeconds: row.ageSeconds, bytes }];
  });
  const system = parseMemoryPressure(pressure);
  return { takenAt: started, sampleMs: now() - started, processes, installedBytes: system.installedBytes ?? installedBytes(), freePercent: system.freePercent };
}
