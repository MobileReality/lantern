import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrExplainDone } from '../src/shared/pr-explain';
import { EXPLAINER_ENABLED } from '../src/shared/pr-explain';
import { EXPLAINER_OFF, createPrExplainService } from '../src/main/pr-explain';
import { PR_EXPLAIN_MODEL } from '../src/main/pr-explain-prompt';
import { createPrExplainStore, storeFileFor } from '../src/main/pr-explain-store';
import { installFakeClaude, isAlive } from './helpers/fake-claude';
import type { FakeClaude } from './helpers/fake-claude';
import { branchOff, commitFile, commitRecord, git, makeTmp, makeWorld } from './helpers/git-repo';
import type { World } from './helpers/git-repo';

vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });

const WHY = 'Rejects a negative pid before it reaches kill()';
const NO_BINARY = 'Claude CLI not found. Run "which claude" in a terminal where claude works.';
const REPLY = 'It adds a guard. It runs before the call. It affects callers.';

let world: World;
let tools: string;
let userData: string;
let fake: FakeClaude;
let head: string;
let logs: string[];

function service(overrides: { timeoutMs?: number; missing?: boolean; enabled?: boolean } = {}) {
  return createPrExplainService({
    projectPaths: () => [world.project],
    userData,
    language: () => 'Polish',
    run: {
      prepareLaunch: (args) => (overrides.missing ? { error: NO_BINARY } : { command: fake.bin, args }),
      scratchDir: path.join(tools, 'scratch'),
      timeoutMs: overrides.timeoutMs,
    },
    log: (line) => logs.push(line),
    enabled: overrides.enabled ?? true,
  });
}

function request(overrides: Record<string, unknown> = {}) {
  return { project: world.project, pr: '7', path: 'src/app.ts', ...overrides };
}

function waiting() {
  let resolve: (done: PrExplainDone) => void = () => {};
  const done = new Promise<PrExplainDone>((r) => (resolve = r));
  return { done, deliver: (d: PrExplainDone) => resolve(d) };
}

async function runOnce(svc = service(), overrides: Record<string, unknown> = {}) {
  const { done, deliver } = waiting();
  expect(await svc.start(request(overrides), deliver)).toEqual({ ok: true });
  return done;
}

function storeFile() {
  return storeFileFor(userData, world.project);
}

async function until(check: () => boolean) {
  for (let i = 0; i < 100 && !check(); i += 1) await new Promise((r) => setTimeout(r, 40));
  return check();
}

beforeEach(() => {
  world = makeWorld();
  tools = makeTmp('ccm-pr-explain-');
  userData = path.join(tools, 'userData');
  fake = installFakeClaude(tools);
  logs = [];
  branchOff(world.project, 'feat/explain');
  commitFile(world.project, 'src/app.ts', 'export {};\n// guarded\n', 'edit app');
  commitFile(world.project, 'src/fresh.ts', 'export const fresh = 1;\n', 'add fresh');
  head = git(world.project, ['rev-parse', 'HEAD']);
  commitRecord(world.project, { id: 7, branch: 'feat/explain', head, title: 'Guard the kill path', files: ['~ src/app.ts', '+ src/fresh.ts', `#reason src/app.ts ${WHY}`] });
  git(world.project, ['push', '-q', 'origin', 'feat/explain']);
  git(world.project, ['checkout', '-q', 'main']);
});

afterEach(() => {
  delete process.env.FAKE_CLAUDE_MODE;
  fs.rmSync(world.dir, { recursive: true, force: true });
  fs.rmSync(tools, { recursive: true, force: true });
});

describe('the explainer switch', () => {
  it('ships switched off', () => {
    expect(EXPLAINER_ENABLED).toBe(false);
  });

  it('refuses to start with the switch off and runs nothing', async () => {
    const deliver = vi.fn();
    expect(await service({ enabled: false }).start(request(), deliver)).toEqual({ ok: false, error: EXPLAINER_OFF });
    expect(fake.calls()).toEqual([]);
    expect(deliver).not.toHaveBeenCalled();
  });

  it('refuses by default, without being told', async () => {
    const svc = createPrExplainService({ projectPaths: () => [world.project], userData, language: () => 'English', run: { prepareLaunch: (args) => ({ command: fake.bin, args }), scratchDir: path.join(tools, 'scratch') }, log: () => {} });
    expect(await svc.start(request(), () => {})).toEqual({ ok: false, error: EXPLAINER_OFF });
    expect(fake.calls()).toEqual([]);
  });
});

describe('request validation', () => {
  it.each([
    ['an unregistered project', { project: tools }],
    ['a relative project', { project: 'project' }],
    ['a non-string pr id', { pr: 7 }],
    ['a pr id that is not a number', { pr: '7; rm -rf' }],
    ['a path that escapes the project', { path: '../secret.txt' }],
    ['an absolute path', { path: '/etc/passwd' }],
  ])('refuses %s without starting anything', async (_name, bad) => {
    const svc = service();
    expect(await svc.start(request(bad), () => {})).toEqual({ ok: false, error: 'Invalid explain request' });
    expect(fake.calls()).toHaveLength(0);
    expect(svc.running()).toBe(0);
  });

  it('refuses a request that is not an object', async () => {
    expect(await service().start('src/app.ts', () => {})).toEqual({ ok: false, error: 'Invalid explain request' });
  });

  it('refuses a pull request that does not exist', async () => {
    expect(await service().start(request({ pr: '99' }), () => {})).toEqual({ ok: false, error: 'pull request not found' });
  });

  it('refuses a path that is not one of the pull request files', async () => {
    const svc = service();
    expect(await svc.start(request({ path: 'src/other.ts' }), () => {})).toEqual({ ok: false, error: 'this file is not part of the pull request' });
    expect(fake.calls()).toHaveLength(0);
    expect(svc.running()).toBe(0);
  });
});

describe('a successful run', () => {
  it('saves the text under the pull request head and leaves the project untouched', async () => {
    const svc = service();
    const result = await runOnce(svc);
    if (!result.ok) throw new Error('expected a success');
    expect(result).toMatchObject({ pr: '7', path: 'src/app.ts' });
    expect(result.explanation).toMatchObject({ text: REPLY, head, stale: false });

    const store = createPrExplainStore(storeFile());
    expect(store.lookup('7', 'src/app.ts', head)).toMatchObject({ head, stale: false });
    expect(svc.saved({ ...request(), head })).toMatchObject({ ok: true, explanation: { head, stale: false } });
    expect(git(world.project, ['status', '--porcelain'])).toBe('');
    expect(storeFile().startsWith(userData)).toBe(true);
    expect(svc.running()).toBe(0);
  });

  it('marks the saved text stale once the pull request head moves', async () => {
    const svc = service();
    await runOnce(svc);
    expect(svc.saved({ ...request(), head: 'f'.repeat(40) })).toMatchObject({ ok: true, explanation: { head, stale: true } });
    expect(svc.saved({ ...request(), head })).toMatchObject({ ok: true, explanation: { stale: false } });
  });

  it('answers nothing for a file never explained and refuses a bad lookup', () => {
    const svc = service();
    expect(svc.saved({ ...request(), head })).toEqual({ ok: true, explanation: null });
    expect(svc.saved({ ...request({ pr: 'x' }), head })).toMatchObject({ ok: false });
    expect(svc.saved({ ...request(), head: 'not-a-sha' })).toMatchObject({ ok: false });
    expect(svc.saved({ ...request({ project: tools }), head })).toMatchObject({ ok: false });
  });

  it('launches the Sonnet model with no tools from a scratch folder and sends the change on stdin', async () => {
    await runOnce();
    const [call] = fake.calls();
    expect(call.args).toEqual(expect.arrayContaining(['-p', '--model', PR_EXPLAIN_MODEL, '--output-format', 'json']));
    const tool = call.args.indexOf('--tools');
    expect(tool).toBeGreaterThan(-1);
    expect(call.args[tool + 1]).toBe('');
    expect(call.args).not.toContain('--allowedTools');
    expect(call.args.join(' ')).not.toContain('guarded');
    expect(fs.realpathSync(call.cwd)).toBe(fs.realpathSync(path.join(tools, 'scratch')));
    expect(call.input).toContain('Pull request title: Guard the kill path');
    expect(call.input).toContain(`Reason already given for this file: ${WHY}`);
    expect(call.input).toContain('Write the answer in Polish.');
    expect(call.input).toContain('src/fresh.ts');
    expect(call.input).toContain('+// guarded');
  });

  it('sends the whole content of an added file instead of a diff', async () => {
    await runOnce(service(), { path: 'src/fresh.ts' });
    expect(fake.calls()[0].input).toContain('Content of the added file:');
    expect(fake.calls()[0].input).toContain('export const fresh = 1;');
  });

  it('logs the usage of the run and nothing of the text', async () => {
    await runOnce();
    expect(logs).toEqual([`[pr-explain] #7 src/app.ts model=${PR_EXPLAIN_MODEL} cost_usd=0.0123 input_tokens=100 output_tokens=30 ms=42`]);
  });

  it('replaces the saved text when it is run again', async () => {
    const svc = service();
    await runOnce(svc);
    process.env.FAKE_CLAUDE_MODE = 'second';
    await runOnce(svc);
    expect(createPrExplainStore(storeFile()).lookup('7', 'src/app.ts', head)?.text).toBe('Second explanation.');
    const saved = JSON.parse(fs.readFileSync(storeFile(), 'utf8')) as { entries: unknown[] };
    expect(saved.entries).toHaveLength(1);
  });

  it('keeps the earlier text when a later run fails', async () => {
    const svc = service();
    await runOnce(svc);
    process.env.FAKE_CLAUDE_MODE = 'error';
    expect(await runOnce(svc)).toMatchObject({ ok: false });
    expect(svc.saved({ ...request(), head })).toMatchObject({ explanation: { text: REPLY } });
  });
});

describe('failures', () => {
  it.each([
    ['error', /boom from fake claude/],
    ['apierror', /Credit balance is too low/],
    ['garbage', /unreadable/],
    ['empty', /empty/],
  ])('reports a failing agent (%s) and saves nothing', async (mode, message) => {
    process.env.FAKE_CLAUDE_MODE = mode;
    const svc = service();
    const result = await runOnce(svc);
    if (result.ok) throw new Error('expected a failure');
    expect(result).toMatchObject({ cancelled: false });
    expect(result.error).toMatch(message);
    expect(svc.saved({ ...request(), head })).toEqual({ ok: true, explanation: null });
    expect(svc.running()).toBe(0);
  });

  it('keeps a reply as plain text and caps its length', async () => {
    process.env.FAKE_CLAUDE_MODE = 'html';
    const html = await runOnce();
    if (!html.ok) throw new Error('expected a success');
    expect(html.explanation.text).toBe('<img src=x onerror=alert(1)> <b>bold</b>');
    process.env.FAKE_CLAUDE_MODE = 'long';
    const long = await runOnce(service(), { path: 'src/fresh.ts' });
    if (!long.ok) throw new Error('expected a success');
    expect(long.explanation.text.length).toBeLessThanOrEqual(2000);
  });

  it('says that no Claude binary was found, in the existing words, without running anything', async () => {
    const svc = service({ missing: true });
    expect(await svc.start(request(), () => {})).toEqual({ ok: false, error: NO_BINARY });
    expect(svc.running()).toBe(0);
    expect(fake.calls()).toHaveLength(0);
  });
});

describe('single flight, cancel and timeout', () => {
  beforeEach(() => {
    process.env.FAKE_CLAUDE_MODE = 'hang';
  });

  async function startHanging(svc = service()) {
    const { done, deliver } = waiting();
    expect(await svc.start(request(), deliver)).toEqual({ ok: true });
    expect(await until(() => fake.calls().length > 0)).toBe(true);
    return { done, pid: fake.calls()[0].pid };
  }

  const gone = (pid: number) => until(() => !isAlive(pid));

  it('does nothing for a second press on the same file while the first is running', async () => {
    const svc = service();
    const { done, pid } = await startHanging(svc);
    expect(await svc.start(request(), () => {})).toMatchObject({ ok: false, busy: true });
    expect(fake.calls()).toHaveLength(1);
    svc.cancel(request());
    await done;
    expect(await gone(pid)).toBe(true);
  });

  it('kills the run on cancel and reports it as cancelled', async () => {
    const svc = service();
    const { done, pid } = await startHanging(svc);
    expect(isAlive(pid)).toBe(true);
    expect(svc.cancel(request())).toBe(true);
    expect(await done).toMatchObject({ ok: false, cancelled: true });
    expect(await gone(pid)).toBe(true);
    expect(svc.running()).toBe(0);
    expect(svc.cancel(request())).toBe(false);
  });

  it('refuses to cancel with an invalid request', () => {
    expect(service().cancel({ project: tools, pr: '7', path: 'src/app.ts' })).toBe(false);
  });

  it('gives up on a hung agent after the timeout and frees the file', async () => {
    const svc = service({ timeoutMs: 400 });
    const { done, pid } = await startHanging(svc);
    const result = await done;
    if (result.ok) throw new Error('expected a failure');
    expect(result).toMatchObject({ cancelled: false });
    expect(result.error).toMatch(/Timed out/);
    expect(await gone(pid)).toBe(true);
    expect(svc.running()).toBe(0);
  });

  it('can be run again once the cancelled run is gone', async () => {
    const svc = service();
    const { done } = await startHanging(svc);
    svc.cancel(request());
    await done;
    process.env.FAKE_CLAUDE_MODE = '';
    expect(await runOnce(svc)).toMatchObject({ ok: true });
  });
});
