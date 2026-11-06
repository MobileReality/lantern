import { describe, expect, it } from 'vitest';
import { collectMemory, lsofArgs, topArgs } from '../src/main/memory-collect';
import { PROJECT_MOBILE, PROJECT_WEBAPP, ROOT_PID, fakeRunner } from './helpers/memory-fixtures';

const MB = 1024 ** 2;
const TREE_PIDS = [4000, 4001, 4002, 4003, 4010, 4011, 4012, 4013, 4014, 4020, 4021, 4022, 4023, 4024, 4025, 4030, 4031, 4032, 4040, 4041, 4050, 4051];

async function collect(overrides: Parameters<typeof fakeRunner>[0] = {}) {
  const runner = fakeRunner(overrides);
  const clock = { t: 1_000 };
  const sample = await collectMemory({
    run: runner.run,
    rootPid: ROOT_PID,
    projectPaths: () => [PROJECT_WEBAPP, PROJECT_MOBILE],
    now: () => (clock.t += 25),
    installedBytes: () => 8 * 1024 ** 3,
  });
  return { sample, calls: runner.calls, byPid: new Map(sample.processes.map((p) => [p.pid, p])) };
}

describe('collectMemory tree walk', () => {
  it('keeps Lantern and everything below it, and nothing else', async () => {
    const { sample } = await collect();
    const pids = sample.processes.map((p) => p.pid).sort((a, b) => a - b);
    expect(pids).toEqual(TREE_PIDS);
    expect(pids).not.toContain(9000);
    expect(pids).not.toContain(9001);
    expect(pids).not.toContain(200);
  });

  it('drops zombies, which hold no memory', async () => {
    const { calls, byPid } = await collect();
    expect(byPid.has(4033)).toBe(false);
    expect(calls.find((c) => c.file === '/usr/bin/top')!.args).not.toContain('4033');
  });

  it('puts every process in its category', async () => {
    const { byPid } = await collect();
    const categoryOf = (pid: number) => byPid.get(pid)?.category;
    expect([4000, 4001, 4002, 4003].map(categoryOf)).toEqual(['app', 'app', 'app', 'app']);
    expect([4010, 4014, 4020, 4022, 4024, 4025, 4041].map(categoryOf)).toEqual(Array(7).fill('editor'));
    expect([4021, 4023].map(categoryOf)).toEqual(['agents', 'agents']);
    expect([4030, 4031, 4032, 4050, 4051].map(categoryOf)).toEqual(Array(5).fill('other'));
  });

  it('joins the footprint and age onto each process', async () => {
    const { byPid } = await collect();
    expect(byPid.get(4022)).toMatchObject({ bytes: 2423 * MB, ageSeconds: 86400 + 3600 + 59 * 60 });
    expect(byPid.get(4020)?.bytes).toBe(Math.round(1.5 * 1024 ** 3));
  });

  it('reads the system figures and falls back to the OS for installed memory', async () => {
    const { sample } = await collect();
    expect(sample.installedBytes).toBe(25769803776);
    expect(sample.freePercent).toBe(43);
    const missing = await collect({ '/usr/bin/memory_pressure': '' });
    expect(missing.sample.installedBytes).toBe(8 * 1024 ** 3);
    expect(missing.sample.freePercent).toBeNull();
  });

  it('records how long the sample took', async () => {
    const { sample } = await collect();
    expect(sample.sampleMs).toBeGreaterThan(0);
  });

  it('fails instead of reporting zero when top returns nothing', async () => {
    await expect(collect({ '/usr/bin/top': '' })).rejects.toThrow('did not report a footprint');
  });

  it('fails clearly when Lantern is not in the process list', async () => {
    await expect(collect({ '/bin/ps': '  200     0 03-22:48:27 Ss   /sbin/launchd\n' })).rejects.toThrow('does not contain Lantern');
  });
});

describe('collectMemory commands', () => {
  it('runs only fixed commands with argument arrays, never a shell', async () => {
    const { calls } = await collect();
    expect(calls.map((c) => c.file).sort()).toEqual(['/bin/ps', '/usr/bin/memory_pressure', '/usr/bin/top', '/usr/sbin/lsof']);
    expect(calls.every((c) => c.args.every((arg) => !/[;&|$`<>\n]/.test(arg)))).toBe(true);
  });

  it('asks top for the footprint of exactly the processes in the tree', async () => {
    const { calls } = await collect();
    const top = calls.find((c) => c.file === '/usr/bin/top')!;
    expect(top.args.slice(0, 4)).toEqual(['-l', '1', '-stats', 'pid,mem']);
    const asked = top.args.slice(4);
    expect(asked.filter((arg) => arg === '-pid')).toHaveLength(TREE_PIDS.length);
    expect(asked.filter((arg) => arg !== '-pid').map(Number).sort((a, b) => a - b)).toEqual(TREE_PIDS);
  });

  it('asks lsof for working directories of non-app processes only', async () => {
    const { calls } = await collect();
    const lsof = calls.find((c) => c.file === '/usr/sbin/lsof')!;
    const pids = lsof.args[lsof.args.length - 1].split(',').map(Number);
    expect(lsof.args.slice(0, 4)).toEqual(['-a', '-d', 'cwd', '-Fpn']);
    expect(pids).not.toContain(4000);
    expect(pids).not.toContain(4003);
    expect(pids).toContain(4021);
  });

  it('builds argument lists from plain numbers', () => {
    expect(topArgs([7, 8])).toEqual(['-l', '1', '-stats', 'pid,mem', '-pid', '7', '-pid', '8']);
    expect(lsofArgs([7, 8])).toEqual(['-a', '-d', 'cwd', '-Fpn', '-p', '7,8']);
  });
});

describe('collectMemory attribution and privacy', () => {
  it('attributes agents, tsservers and their host to the project of their working directory', async () => {
    const { byPid } = await collect();
    for (const pid of [4021, 4022, 4020, 4023, 4030, 4032, 4050, 4051]) expect(byPid.get(pid)?.projectPath, String(pid)).toBe(PROJECT_WEBAPP);
    for (const pid of [4041, 4040]) expect(byPid.get(pid)?.projectPath, String(pid)).toBe(PROJECT_MOBILE);
  });

  it('leaves the app, the server chain and the watcher unattributed', async () => {
    const { byPid } = await collect();
    for (const pid of [4000, 4001, 4003, 4010, 4012, 4014, 4024]) expect(byPid.get(pid)?.projectPath, String(pid)).toBeNull();
  });

  it('keeps command lines out of the sample', async () => {
    const { sample } = await collect();
    expect(JSON.stringify(sample)).not.toMatch(/7e166f5d|--resume|shell-snapshots|cancellationPipeName|user-data-dir/);
  });
});
