import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { checkNoPr, checkRemoteBranches } from '../scripts/e2e-delegate/checks.mjs';
import { FAKE_ACCOUNT, answerFor, startFakeLantern } from '../scripts/e2e-delegate/fake-lantern.mjs';
import { main, parseArgs, renderPlan } from '../scripts/skill-test/run.mjs';

interface Slice {
  name: string;
  ok: boolean;
  reason: string;
  detail?: string[];
}

const folders: string[] = [];

afterEach(() => {
  for (const folder of folders.splice(0)) fs.rmSync(folder, { recursive: true, force: true });
});

async function delegateRun(delivery: string) {
  const lines: string[] = [];
  const out = { log: (...parts: unknown[]) => void lines.push(parts.join(' ')), err: (...parts: unknown[]) => void lines.push(parts.join(' ')) };
  const code = await main(['lantern-delegate', '--delivery', delivery, '--json'], {}, out);
  const report = JSON.parse(lines.find((line) => line.startsWith('{')) ?? 'null');
  const run = report.slices.find((slice: Slice) => slice.name === 'delegate-run') as Slice;
  return { code, report, run, rig: report.slices.find((slice: Slice) => slice.name === 'rig-ready') as Slice };
}

const checkNames = (run: Slice) => (run.detail ?? []).map((line) => line.replace(/^(ok|FAIL|warn)\s+/, '').split(':')[0]);

describe('the delegate PR flow end to end, with the credential variables unset and a fake Lantern socket answering', () => {
  it('delivery pr opens one pull request, with the account taken from the socket', async () => {
    const { code, report, run, rig } = await delegateRun('pr');
    expect(code, JSON.stringify(report.slices)).toBe(0);
    expect(rig.reason).toContain('the account is only on the fake Lantern socket');
    expect(run.reason).toContain('delivery pr, 2 account request(s) on the Lantern socket');
    expect(checkNames(run)).toEqual(expect.arrayContaining(['one-open-pr', 'sync-verify-green', 'panel-sees-pr']));
    expect(checkNames(run)).not.toContain('no-pr');
  }, 180_000);

  it('delivery push pushes the branch and opens none, and never asks for the account', async () => {
    const { code, report, run } = await delegateRun('push');
    expect(code, JSON.stringify(report.slices)).toBe(0);
    expect(run.reason).toContain('delivery push, 0 account request(s) on the Lantern socket');
    expect(checkNames(run)).toEqual(expect.arrayContaining(['no-pr', 'branch-pushed', 'sync-verify-green', 'panel-sees-record']));
    expect(checkNames(run)).not.toContain('one-open-pr');
    expect(run.detail?.find((line) => line.includes('sync-verify-green'))).toContain('--require-pr --require-reason --require-order --require-flow');
  }, 180_000);

  it('delivery local pushes nothing and opens none', async () => {
    const { code, report, run } = await delegateRun('local');
    expect(code, JSON.stringify(report.slices)).toBe(0);
    expect(run.reason).toContain('delivery local, 0 account request(s) on the Lantern socket');
    expect(checkNames(run)).toEqual(expect.arrayContaining(['no-pr', 'nothing-pushed', 'sync-verify-green', 'panel-sees-record']));
    expect(checkNames(run)).not.toEqual(expect.arrayContaining(['branch-pushed']));
    expect(run.detail?.find((line) => line.includes('sync-verify-green'))).toContain('--require-pr --require-reason --require-order --require-flow');
  }, 180_000);

  it('a record without its reasons is red under push and local, in verify and in the comparison view', async () => {
    for (const delivery of ['push', 'local']) {
      const lines: string[] = [];
      const out = { log: (...parts: unknown[]) => void lines.push(parts.join(' ')), err: () => {} };
      const code = await main(['lantern-delegate', '--delivery', delivery, '--fake', 'no-reason', '--json'], {}, out);
      const report = JSON.parse(lines.find((line) => line.startsWith('{')) ?? 'null');
      const run = report.slices.find((slice: Slice) => slice.name === 'delegate-run') as Slice;
      expect(code, delivery).toBe(1);
      expect(run.detail?.filter((line) => line.startsWith('FAIL')).map((line) => line.split(':')[0].replace('FAIL ', '')), delivery).toEqual(expect.arrayContaining(['sync-verify-green', 'panel-sees-record']));
      expect(run.detail?.find((line) => line.includes('sync-verify-green')), delivery).toContain('have no reason');
    }
  }, 240_000);

  it('a broken run still fails under every delivery, in the paid slice only', async () => {
    for (const delivery of ['pr', 'push', 'local']) {
      const lines: string[] = [];
      const out = { log: (...parts: unknown[]) => void lines.push(parts.join(' ')), err: () => {} };
      const code = await main(['lantern-delegate', '--delivery', delivery, '--fake', 'broken', '--json'], {}, out);
      const report = JSON.parse(lines.find((line) => line.startsWith('{')) ?? 'null');
      expect(code, delivery).toBe(1);
      expect(report.slices.filter((slice: Slice) => !slice.ok).map((slice: Slice) => slice.name), delivery).toEqual(['delegate-run']);
    }
  }, 240_000);
});

describe('the checks that tell the deliveries apart', () => {
  const pr = { key: 'e2e/todo-cli', state: 'OPEN' };

  it('no-pr fails on a pull request of the project and ignores another repository', () => {
    expect(checkNoPr([], 'e2e/todo-cli')).toMatchObject({ ok: true, hard: true });
    expect(checkNoPr([{ ...pr, key: 'e2e/other' }], 'e2e/todo-cli').ok).toBe(true);
    expect(checkNoPr([pr], 'e2e/todo-cli')).toMatchObject({ ok: false, hard: true });
  });

  it('branch-pushed wants exactly one branch besides main; nothing-pushed wants none', () => {
    expect(checkRemoteBranches(['main', 'feat/x'], 'main', true)).toMatchObject({ name: 'branch-pushed', ok: true });
    expect(checkRemoteBranches(['main'], 'main', true)).toMatchObject({ name: 'branch-pushed', ok: false });
    expect(checkRemoteBranches(['main', 'feat/x', 'fix/y'], 'main', true).ok).toBe(false);
    expect(checkRemoteBranches(['main'], 'main', false)).toMatchObject({ name: 'nothing-pushed', ok: true });
    expect(checkRemoteBranches(['main', 'feat/x'], 'main', false)).toMatchObject({ name: 'nothing-pushed', ok: false });
  });
});

describe('the fake Lantern socket', () => {
  it('answers a Bitbucket request with the account and refuses anything else', () => {
    expect(answerFor({ provider: 'bitbucket' })).toEqual({ ok: true, env: FAKE_ACCOUNT });
    expect(answerFor({ provider: 'github' })).toMatchObject({ ok: false });
    expect(answerFor(null)).toMatchObject({ ok: false });
  });

  it('serves one JSON line per connection and records the requests', async () => {
    const folder = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'fl-'));
    folders.push(folder);
    const lantern = await startFakeLantern(folder);
    const reply = await new Promise<string>((resolve) => {
      const socket = net.createConnection(lantern.socketPath);
      let received = '';
      socket.on('connect', () => socket.write(`${JSON.stringify({ project: '/p', provider: 'bitbucket' })}\n`));
      socket.on('data', (chunk) => (received += chunk));
      socket.on('close', () => resolve(received));
    });
    expect(JSON.parse(reply)).toEqual({ ok: true, env: FAKE_ACCOUNT });
    expect(lantern.requests).toEqual([{ project: '/p', provider: 'bitbucket' }]);
    await lantern.close();
  });
});

describe('--delivery on the skill-test command', () => {
  it('defaults to pr, accepts the three values and names the choice in the plan', () => {
    expect(parseArgs(['lantern-delegate'], {}).delivery).toBe('pr');
    for (const value of ['pr', 'push', 'local']) expect(renderPlan(parseArgs(['lantern-delegate', '--delivery', value], {}), 'claude')).toContain(`delivery: ${value}`);
  });

  it('refuses any other value and a missing one', () => {
    expect(() => parseArgs(['lantern-delegate', '--delivery', 'always'], {})).toThrow(/--delivery must be one of: pr, push, local/);
    expect(() => parseArgs(['lantern-delegate', '--delivery'], {})).toThrow(/needs a value/);
  });
});
