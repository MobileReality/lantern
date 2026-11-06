import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { planRelease, releaseProjectMemory, signalableTargets, type ReleaseDeps } from '../src/main/memory-free';
import { attributeTree, walkTree } from '../src/main/memory-collect';
import { parsePsAged } from '../src/main/memory-parse';
import { registeredProject } from '../src/main/agent-request';
import { terminatePids, type KillDeps } from '../src/main/prockill';
import { PROJECT_MOBILE, PROJECT_WEBAPP, ROOT_PID, fakeRunner, fixture } from './helpers/memory-fixtures';

const SERVER_PID = 4010;
const WEBAPP_RELEASED = [4020, 4021, 4022, 4023, 4025, 4030, 4031, 4032];
const MOBILE_RELEASED = [4040, 4041];

const PS_EXTRA_FOREIGN = [
  ' 4026  4020       00:10 S    /Users/dev/.nvm/versions/node/v22.22.0/bin/node /Users/dev/GIT/mobile/scripts/sync.js',
  ' 4027  4026       00:09 S    sleep 600',
];
const PS_EXTRA_STALE_HOST = [
  ' 4060  4014  2-03:00:00 S    /Users/dev/.vscode/cli/serve-web/6d62b1d5dace93a33b3a6d3eca1317bd5e15bcb1/node --type=extensionHost --transformURIs',
  ' 4061  4060  2-02:59:00 S    /Users/dev/.vscode/cli/serve-web/6d62b1d5dace93a33b3a6d3eca1317bd5e15bcb1/node --max-old-space-size=3072 /Users/dev/.vscode/cli/serve-web/6d62b1d5dace93a33b3a6d3eca1317bd5e15bcb1/extensions/node_modules/typescript/lib/tsserver.js --useInferredProjectPerProjectRoot',
];
const PS_EXTRA_OUTSIDE_SERVER = [
  ' 4070  4000       00:30 S    /Users/dev/.vscode/cli/serve-web/6d62b1d5dace93a33b3a6d3eca1317bd5e15bcb1/node --type=extensionHost --transformURIs',
  ' 4071  4070       00:29 S    /Users/dev/.vscode/cli/serve-web/6d62b1d5dace93a33b3a6d3eca1317bd5e15bcb1/node --max-old-space-size=3072 /Users/dev/.vscode/cli/serve-web/6d62b1d5dace93a33b3a6d3eca1317bd5e15bcb1/extensions/node_modules/typescript/lib/tsserver.js',
];
const LSOF_EXTRA = ['p4061', 'fcwd', 'n/Users/dev/GIT/webapp', 'p4070', 'fcwd', 'n/Users/dev/GIT/webapp', 'p4071', 'fcwd', 'n/Users/dev/GIT/webapp'];

const HOST_WITH_OWN_CWD = fixture('lsof-cwd.txt').replace('p4020\nfcwd\nn/\n', `p4020\nfcwd\nn${PROJECT_WEBAPP}\n`);

const withLines =(text: string, lines: string[]) => `${text.trimEnd()}\n${lines.join('\n')}\n`;
const numerically = (pids: number[]) => [...pids].sort((a, b) => a - b);

function harness(overrides: Partial<ReleaseDeps> = {}, outputs: Partial<Record<string, string>> = {}) {
  const runner = fakeRunner(outputs);
  const sent: { pid: number; signal: string }[] = [];
  const gone = new Set<number>();
  const kill: KillDeps = {
    signal: (pid, signal) => {
      sent.push({ pid, signal });
      gone.add(pid);
    },
    snapshot: async () => parsePsAged(outputs['/bin/ps'] ?? fixture('ps-aged.txt')).filter((row) => !gone.has(row.pid)),
  };
  const deps: ReleaseDeps = {
    supported: true,
    run: runner.run,
    rootPid: ROOT_PID,
    serverPid: () => SERVER_PID,
    projectPaths: () => [PROJECT_WEBAPP, PROJECT_MOBILE],
    registered: (value) => (value === PROJECT_WEBAPP || value === PROJECT_MOBILE ? value : null),
    sharedWindow: () => false,
    terminate: (pids) => terminatePids(pids, 0, kill),
    ...overrides,
  };
  return { deps, sent, calls: runner.calls, signalled: () => numerically(sent.map((s) => s.pid)) };
}

describe('releasing a project that is open', () => {
  it('terminates the project host and everything below it, and nothing else', async () => {
    const { deps, signalled } = harness();
    const result = await releaseProjectMemory(PROJECT_WEBAPP, deps);
    expect(result.ok).toBe(true);
    expect(signalled()).toEqual(WEBAPP_RELEASED);
  });

  it('reports what it stopped as plain counts per kind', async () => {
    const { deps } = harness();
    const result = await releaseProjectMemory(PROJECT_WEBAPP, deps);
    expect(result).toEqual({ ok: true, terminated: { 'extension-host': 1, claude: 1, tsserver: 1, codex: 1, extension: 1, shell: 1, test: 2 } });
    expect(JSON.stringify(result)).not.toMatch(/\/Users\/dev|--resume|shell-snapshots|jest --runInBand/);
  });

  it('leaves another project, the server chain, the watcher and Lantern itself alone', async () => {
    const { deps, signalled } = harness();
    await releaseProjectMemory(PROJECT_WEBAPP, deps);
    const untouched = [200, 210, 4000, 4001, 4002, 4003, 4010, 4011, 4012, 4013, 4014, 4024, 4033, 4040, 4041, 4050, 4051, 9000, 9001];
    for (const pid of untouched) expect(signalled(), String(pid)).not.toContain(pid);
  });

  it('does not touch Lantern children outside the editor server even when they belong to the project', async () => {
    const { deps, signalled } = harness();
    await releaseProjectMemory(PROJECT_WEBAPP, deps);
    expect(signalled()).not.toContain(4050);
    expect(signalled()).not.toContain(4051);
  });

  it('releases the other project the same way without touching the first', async () => {
    const { deps, signalled } = harness();
    await releaseProjectMemory(PROJECT_MOBILE, deps);
    expect(signalled()).toEqual(MOBILE_RELEASED);
  });

  it('spares a process below the host that belongs to another project, with its children', async () => {
    const outputs = { '/bin/ps': withLines(fixture('ps-aged.txt'), PS_EXTRA_FOREIGN), '/usr/sbin/lsof': HOST_WITH_OWN_CWD };
    const { deps, signalled } = harness({}, outputs);
    await releaseProjectMemory(PROJECT_WEBAPP, deps);
    expect(signalled()).toEqual(WEBAPP_RELEASED);
    expect(signalled()).not.toContain(4026);
    expect(signalled()).not.toContain(4027);
  });

  it('does not guess a host that serves processes of two projects', async () => {
    const { deps, sent } = harness({}, { '/bin/ps': withLines(fixture('ps-aged.txt'), PS_EXTRA_FOREIGN) });
    expect(await releaseProjectMemory(PROJECT_WEBAPP, deps)).toEqual({ ok: false, reason: 'no-host' });
    expect(sent).toEqual([]);
  });

  it('also stops an older host of the same project that is still waiting out the reconnection grace time', async () => {
    const outputs = { '/bin/ps': withLines(fixture('ps-aged.txt'), PS_EXTRA_STALE_HOST), '/usr/sbin/lsof': `${fixture('lsof-cwd.txt')}${LSOF_EXTRA.slice(0, 3).join('\n')}\n` };
    const { deps, signalled } = harness({}, outputs);
    await releaseProjectMemory(PROJECT_WEBAPP, deps);
    expect(signalled()).toEqual(numerically([...WEBAPP_RELEASED, 4060, 4061]));
  });

  it('ignores a host of the project that is not below the editor server Lantern started', async () => {
    const outputs = { '/bin/ps': withLines(fixture('ps-aged.txt'), PS_EXTRA_OUTSIDE_SERVER), '/usr/sbin/lsof': `${fixture('lsof-cwd.txt')}${LSOF_EXTRA.slice(3).join('\n')}\n` };
    const { deps, signalled } = harness({}, outputs);
    await releaseProjectMemory(PROJECT_WEBAPP, deps);
    expect(signalled()).toEqual(WEBAPP_RELEASED);
    expect(signalled()).not.toContain(4070);
    expect(signalled()).not.toContain(4071);
  });

  it('refuses a project whose host sits outside the given server tree', async () => {
    const { deps, sent } = harness({ serverPid: () => 4040 });
    expect(await releaseProjectMemory(PROJECT_WEBAPP, deps)).toEqual({ ok: false, reason: 'no-host' });
    expect(sent).toEqual([]);
  });

  it('asks only for the process list and working directories, never a shell', async () => {
    const { deps, calls } = harness();
    await releaseProjectMemory(PROJECT_WEBAPP, deps);
    expect(calls.map((call) => call.file).sort()).toEqual(['/bin/ps', '/usr/sbin/lsof']);
    expect(calls.every((call) => call.args.every((arg) => !/[;&|$`<>\n]/.test(arg)))).toBe(true);
  });
});

describe('the fallback when the host cannot be identified', () => {
  it('reports no host for a project that has none, and signals nothing', async () => {
    const { deps, sent } = harness({ projectPaths: () => [PROJECT_WEBAPP, PROJECT_MOBILE, '/Users/dev/GIT/quiet'], registered: () => '/Users/dev/GIT/quiet' });
    expect(await releaseProjectMemory('/Users/dev/GIT/quiet', deps)).toEqual({ ok: false, reason: 'no-host' });
    expect(sent).toEqual([]);
  });

  it('reports no server when Lantern has not started one', async () => {
    const { deps, sent, calls } = harness({ serverPid: () => null });
    expect(await releaseProjectMemory(PROJECT_WEBAPP, deps)).toEqual({ ok: false, reason: 'no-server' });
    expect(sent).toEqual([]);
    expect(calls).toEqual([]);
  });

  it('reports no server when its pid is not in Lantern process tree', async () => {
    const { deps, sent } = harness({ serverPid: () => 9000 });
    expect(await releaseProjectMemory(PROJECT_WEBAPP, deps)).toEqual({ ok: false, reason: 'no-server' });
    expect(sent).toEqual([]);
  });

  it('leaves a project that also has a window of its own to that window', async () => {
    const { deps, sent, calls } = harness({ sharedWindow: (project) => project === PROJECT_WEBAPP });
    expect(await releaseProjectMemory(PROJECT_WEBAPP, deps)).toEqual({ ok: false, reason: 'shared-window' });
    expect(sent).toEqual([]);
    expect(calls).toEqual([]);
  });

  it('says so when the process list cannot be read', async () => {
    const { deps, sent } = harness({}, { '/bin/ps': '' });
    expect(await releaseProjectMemory(PROJECT_WEBAPP, deps)).toEqual({ ok: false, reason: 'unreadable' });
    expect(sent).toEqual([]);
  });

  it('does nothing off macOS', async () => {
    const { deps, sent, calls } = harness({ supported: false });
    expect(await releaseProjectMemory(PROJECT_WEBAPP, deps)).toEqual({ ok: false, reason: 'unsupported' });
    expect(sent).toEqual([]);
    expect(calls).toEqual([]);
  });
});

describe('validating the project argument', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lantern-free-'));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'lantern-free-outside-'));

  it.each([undefined, null, 7, {}, ['/a'], '', 'relative/path', '/definitely/not/a/folder'])('rejects %j before reading any process', async (value) => {
    const { deps, calls, sent } = harness({ registered: (v) => registeredProject(v, [dir]) });
    expect(await releaseProjectMemory(value, deps)).toEqual({ ok: false, reason: 'invalid-project' });
    expect(calls).toEqual([]);
    expect(sent).toEqual([]);
  });

  it('rejects an existing folder that is not a registered project', async () => {
    const { deps, calls } = harness({ registered: (v) => registeredProject(v, [dir]) });
    expect(await releaseProjectMemory(outside, deps)).toEqual({ ok: false, reason: 'invalid-project' });
    expect(calls).toEqual([]);
  });

  it('accepts a registered folder and hands the registered path on', async () => {
    const { deps } = harness({ registered: (v) => registeredProject(v, [dir]), projectPaths: () => [dir] });
    expect(await releaseProjectMemory(dir, deps)).toEqual({ ok: false, reason: 'no-host' });
  });
});

describe('signalableTargets', () => {
  const scope = { rootPid: 4000, serverPid: 4010 };

  it('drops pid 1 and lower, Lantern and the editor server itself', () => {
    expect(signalableTargets([1, 0, -1, 4000, 4010, 4020], scope)).toEqual([4020]);
  });
});

describe('planRelease', () => {
  const rows = parsePsAged(fixture('ps-aged.txt'));
  const tree = walkTree(rows, ROOT_PID);
  const projectOf = attributeTree(tree, fixture('lsof-cwd.txt'), [PROJECT_WEBAPP, PROJECT_MOBILE]);
  const scope = { rootPid: ROOT_PID, serverPid: SERVER_PID, project: PROJECT_WEBAPP };

  it('plans the project hosts and their subtrees', () => {
    expect(numerically(planRelease(tree, projectOf, scope)!.pids)).toEqual(WEBAPP_RELEASED);
  });

  it('plans nothing when the project has no extension host', () => {
    expect(planRelease(tree, projectOf, { ...scope, project: '/Users/dev/GIT/quiet' })).toBeNull();
  });

  it('never plans a pid above the host, whatever the attribution says', () => {
    const everything = new Map(tree.map(({ row }) => [row.pid, PROJECT_WEBAPP]));
    const pids = planRelease(tree, everything, scope)!.pids;
    for (const pid of [4000, 4001, 4003, 4010, 4011, 4012, 4013, 4014, 4024, 4050, 4051]) expect(pids, String(pid)).not.toContain(pid);
  });
});
