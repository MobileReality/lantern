import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as agent from '../src/main/agent';

const spawned = vi.hoisted(() => ({ calls: [] as Array<{ args: string[]; env: NodeJS.ProcessEnv; cwd: string }>, processes: [] as EventEmitter[], pid: undefined as number | undefined }));

vi.mock('node:child_process', () => ({
  spawn: (_bin: string, args: string[], opts: { env: NodeJS.ProcessEnv; cwd: string }) => {
    spawned.calls.push({ args, env: opts.env, cwd: opts.cwd });
    const p = new EventEmitter() as EventEmitter & { stdout: EventEmitter; stderr: EventEmitter; kill: () => boolean };
    p.stdout = new EventEmitter();
    p.stderr = new EventEmitter();
    p.kill = () => true;
    (p as { pid?: number }).pid = spawned.pid;
    spawned.processes.push(p);
    return p;
  },
}));

// A stub `codex` on PATH so the Codex lifecycle tests run without a real install; spawn is mocked.
const fakeCodexDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ccm-fake-codex-'));
fs.writeFileSync(path.join(fakeCodexDir, process.platform === 'win32' ? 'codex.exe' : 'codex'), '#!/bin/sh\n', { mode: 0o755 });
process.env.PATH = `${fakeCodexDir}${path.delimiter}${process.env.PATH ?? ''}`;

describe('agent.start for lantern', () => {
  const dirs: string[] = [];
  afterEach(async () => {
    // Children are fakes with made-up pids, so teardown must never reach the real kill.
    vi.spyOn(process, 'kill').mockImplementation(() => true);
    const cancelling = agent.cancel();
    spawned.processes.splice(0).forEach((process) => { process.emit('close', null); });
    await cancelling;
    vi.restoreAllMocks();
    spawned.pid = undefined;
    for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
  });

  it.skipIf(!agent.isAvailable())('runs an unlinked project with both bundled skills and LANTERN_LANG from the language', () => {
    const project = fs.mkdtempSync(path.join(os.tmpdir(), 'ccm-start-'));
    dirs.push(project);
    const events: string[] = [];
    const res = agent.start({ project, kind: 'lantern', language: 'Polish', onEvent: (e) => e.text && events.push(e.text) });
    expect(res.ok).toBe(true);
    expect(spawned.calls.at(-1)?.env.LANTERN_LANG).toBe('pl');
    const inHome = (name: string) => !!fs.lstatSync(path.join(os.homedir(), '.claude', 'skills', name), { throwIfNoEntry: false });
    const expected = ['lantern-setup', 'lantern-sync'].filter((name) => !inHome(name));
    for (const name of expected) {
      expect(fs.existsSync(path.join(project, '.claude', 'skills', name, 'SKILL.md'))).toBe(true);
    }
    if (!inHome('lantern-sync')) expect(fs.existsSync(path.join(project, '.claude', 'skills', 'lantern-sync', 'scripts', 'sync.mjs'))).toBe(true);
    expect(events.filter((t) => t.includes('Installed the bundled'))).toEqual(
      expected.map((name) => `Installed the bundled ${name} skill into .claude/skills/ for this run.`),
    );
  });

  it.skipIf(!agent.isAvailable())('still refuses a plan fix when its skill is not linked', () => {
    const project = fs.mkdtempSync(path.join(os.tmpdir(), 'ccm-start-'));
    dirs.push(project);
    const res = agent.start({ project, kind: 'plan-fix', onEvent: () => {} });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/not linked/);
  });

  it.skipIf(!agent.isAvailable())('never signals process group -1 when the child pid is 1', () => {
    const kill = vi.spyOn(process, 'kill').mockImplementation(() => true);
    try {
      const project = fs.mkdtempSync(path.join(os.tmpdir(), 'ccm-start-'));
      dirs.push(project);
      spawned.pid = 1;
      expect(agent.start({ project, kind: 'lantern', onEvent: () => {} }).ok).toBe(true);
      agent.cancel();
      expect(kill).not.toHaveBeenCalled();
    } finally {
      kill.mockRestore();
    }
  });

  it('keeps the Codex runner slot until the cancelled child closes', async () => {
    const project = fs.mkdtempSync(path.join(os.tmpdir(), 'ccm-start-'));
    dirs.push(project);
    expect(agent.start({ project, kind: 'lantern', provider: 'codex', onEvent: () => {} }).ok).toBe(true);
    const first = spawned.processes.at(-1) as EventEmitter;
    let settled = false;
    const cancelling = agent.cancel().then(() => (settled = true));
    await Promise.resolve();
    expect(settled).toBe(false);
    expect(agent.start({ project, kind: 'lantern', provider: 'codex', onEvent: () => {} })).toMatchObject({ ok: false, error: 'already running' });
    first.emit('close', null);
    await cancelling;
    expect(settled).toBe(true);
    expect(agent.start({ project, kind: 'lantern', provider: 'codex', onEvent: () => {} }).ok).toBe(true);
  });

  it('reaps a Codex child that lingers after turn.completed instead of refusing the next run', () => {
    const kill = vi.spyOn(process, 'kill').mockImplementation(() => true);
    const project = fs.mkdtempSync(path.join(os.tmpdir(), 'ccm-start-'));
    dirs.push(project);
    spawned.pid = 4242;
    const events: string[] = [];
    expect(agent.start({ project, kind: 'lantern', provider: 'codex', onEvent: (e) => events.push(e.kind) }).ok).toBe(true);
    const first = spawned.processes.at(-1) as EventEmitter & { stdout: EventEmitter };
    first.stdout.emit('data', `${JSON.stringify({ type: 'turn.completed' })}\n`);
    expect(events).toContain('done');
    expect(agent.isRunning()).toBe(false);
    expect(agent.start({ project, kind: 'lantern', provider: 'codex', onEvent: () => {} }).ok).toBe(true);
    expect(kill).toHaveBeenCalledWith(-4242, 'SIGKILL');
    first.emit('close', null);
    expect(agent.isRunning()).toBe(true);
  });
});
