import { spawn } from 'node:child_process';
import net from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { killTree, portListener, psSnapshot, waitPortFree } from '../src/main/prockill';
import { descendantsOf } from '../src/main/proctree';

const CHILDREN = 2;
const GRACE_MS = 300;
const SETTLE_MS = 5000;
const TEST_TIMEOUT_MS = 20_000;

const spawned: number[] = [];

afterEach(() => {
  for (const pid of spawned.splice(0)) {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {}
  }
});

async function spawnTree(script: string) {
  const root = spawn('sh', ['-c', script], { stdio: 'ignore' });
  const deadline = Date.now() + SETTLE_MS;
  for (;;) {
    const tree = [root.pid!, ...descendantsOf(await psSnapshot(), root.pid!)];
    if (tree.length > CHILDREN || Date.now() > deadline) {
      spawned.push(...tree);
      return tree;
    }
  }
}

async function liveOf(pids: number[]) {
  const rows = await psSnapshot();
  return rows.filter((r) => pids.includes(r.pid) && !r.stat.startsWith('Z')).map((r) => r.pid);
}

describe.skipIf(process.platform === 'win32')('killTree', () => {
  it(
    'terminates a real parent and every child',
    async () => {
      const tree = await spawnTree('sleep 60 & sleep 60 & wait');
      expect(tree.length).toBe(CHILDREN + 1);
      expect(await liveOf(tree)).toHaveLength(tree.length);
      await killTree(tree[0], GRACE_MS);
      expect(await liveOf(tree)).toEqual([]);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'force-kills a tree that ignores SIGTERM once the grace period ends',
    async () => {
      const tree = await spawnTree('trap "" TERM; sleep 60 & sleep 60 & wait');
      expect(tree.length).toBe(CHILDREN + 1);
      await killTree(tree[0], GRACE_MS);
      expect(await liveOf(tree)).toEqual([]);
    },
    TEST_TIMEOUT_MS,
  );
});

describe.skipIf(process.platform === 'win32')('portListener', () => {
  it('finds this process listening, then nothing once the port closes', async () => {
    const srv = net.createServer();
    await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
    const port = (srv.address() as net.AddressInfo).port;
    expect(await portListener(port)).toBe(process.pid);
    await new Promise<void>((r) => srv.close(() => r()));
    expect(await waitPortFree(port, SETTLE_MS)).toBe(true);
  });
});
