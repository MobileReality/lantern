import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { costFailure, runAgent } from '../scripts/skill-test/agent.mjs';
import { actionFor, parseAgentArgs, resultLine, runFakeAgent, writeFakeClaude } from '../scripts/skill-test/fake-agent.mjs';
import { changedSources, createTinyProject, mapProject, snapshotSources, validateSettled } from '../scripts/skill-test/fixtures.mjs';
import { buildReport, exitCodeFor, renderReport } from '../scripts/skill-test/report.mjs';
import { main, parseArgs, renderPlan, resolveCap, runSkill } from '../scripts/skill-test/run.mjs';
import { SETUP_PROMPT, SKILLS, SYNC_PROMPT } from '../scripts/skill-test/slices.mjs';

const exec = promisify(execFile);
const RUN = path.join(__dirname, '..', 'scripts', 'skill-test', 'run.mjs');
const SKILL_NAMES = ['lantern-setup', 'lantern-sync', 'lantern-delegate', 'lantern-vocabulary', 'lantern-areas'];

const dirs: string[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

function tmp(prefix = 'skill-test-') {
  const d = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), prefix));
  dirs.push(d);
  return d;
}

function quiet() {
  const lines: string[] = [];
  return { lines, log: (...a: unknown[]) => void lines.push(a.join(' ')), err: (...a: unknown[]) => void lines.push(a.join(' ')) };
}

async function runJson(argv: string[], env: Record<string, string | undefined> = {}) {
  const out = quiet();
  const code = await main([...argv, '--json'], env, out);
  const jsonLine = out.lines.find((l) => l.startsWith('{'));
  return { code, report: jsonLine ? JSON.parse(jsonLine) : null, lines: out.lines };
}

describe('arguments and the cost cap', () => {
  it('takes exactly one known skill and gives each its own default cap', () => {
    for (const skill of SKILL_NAMES) expect(parseArgs(['--', skill], {})).toMatchObject({ skill, live: false, capUsd: SKILLS[skill as keyof typeof SKILLS].defaultCapUsd });
    expect(() => parseArgs([], {})).toThrow(/skill must be one of/);
    expect(() => parseArgs(['nope'], {})).toThrow(/skill must be one of/);
    expect(() => parseArgs(['lantern-setup', 'lantern-sync'], {})).toThrow(/one skill at a time/);
    expect(() => parseArgs(['lantern-setup', '--budget', '1'], {})).toThrow(/unknown argument/);
  });

  it('reads the cap from --max-usd or SKILL_TEST_MAX_USD and rejects nonsense', () => {
    expect(parseArgs(['lantern-setup', '--max-usd', '0.25'], {}).capUsd).toBe(0.25);
    expect(parseArgs(['lantern-setup'], { SKILL_TEST_MAX_USD: '2' }).capUsd).toBe(2);
    expect(parseArgs(['lantern-setup', '--max-usd', '0.5'], { SKILL_TEST_MAX_USD: '2' }).capUsd).toBe(0.5);
    for (const bad of ['0', '-1', 'abc']) expect(() => resolveCap(bad, 1)).toThrow(/positive number/);
    expect(() => parseArgs(['lantern-setup', '--max-usd'], {})).toThrow(/needs a value/);
  });

  it('keeps the fake agent options out of the live path', () => {
    expect(() => parseArgs(['lantern-setup', '--live', '--fake', 'broken'], {})).toThrow(/offline mode only/);
    expect(() => parseArgs(['lantern-setup', '--live', '--fake-cost', '1'], {})).toThrow(/offline mode only/);
    expect(() => parseArgs(['lantern-setup', '--fake', 'weird'], {})).toThrow(/--fake must be/);
    expect(() => parseArgs(['lantern-setup', '--fake-cost', '-1'], {})).toThrow(/--fake-cost/);
  });

  it('treats a spend equal to the cap as fine and anything above as a failure', () => {
    expect(costFailure(1, 1)).toBeNull();
    expect(costFailure(1.01, 1)).toContain('cost cap exceeded');
  });

  it('prints the cap and the mode in the plan, marking the live path as paid', () => {
    const offline = renderPlan(parseArgs(['lantern-delegate'], {}), 'claude');
    expect(offline).toContain('cost cap: $3.00');
    expect(offline).toContain('nothing is spent');
    const live = renderPlan(parseArgs(['lantern-delegate', '--live', '--max-usd', '1.5'], {}), '/bin/claude');
    expect(live).toContain('LIVE');
    expect(live).toContain('cost cap: $1.50');
    expect(live).toContain('agent, paid');
    expect(live).toContain('--max-budget-usd');
  });
});

describe('the agent call and the cap', () => {
  function budgetStopClaude(costUsd: number) {
    const file = path.join(tmp('budget-claude-'), 'claude');
    fs.writeFileSync(file, `#!/usr/bin/env node\nconsole.log(JSON.stringify({ type: 'result', subtype: 'error_max_budget_usd', is_error: true, total_cost_usd: ${costUsd} }));\n`, { mode: 0o755 });
    return file;
  }

  it('marks a stop on the agent budget as a cap failure even when the spend stays under the cap', async () => {
    const ctx = { bin: budgetStopClaude(0.05), capUsd: 0.1, spentUsd: 0, logsDir: tmp('logs-'), children: new Set() };
    const outcome = await runAgent(ctx, { name: 'x', cwd: ctx.logsDir, prompt: 'p' });
    expect(outcome).toMatchObject({ ok: false, capExceeded: true, costUsd: 0.05 });
    expect(outcome.reason).toContain('cost cap exceeded');
    const report = buildReport({ skill: 's', mode: 'm', capUsd: 0.1, slices: [{ name: 'a', ...outcome }], spentUsd: ctx.spentUsd });
    expect(report.overCap).toBe(true);
    expect(renderReport(report)).toContain('(CAP EXCEEDED)');
  });

  it('refuses to start a call when nothing is left of the cap', async () => {
    const ctx = { bin: '/definitely/not/claude', capUsd: 0.1, spentUsd: 0.1, logsDir: tmp('logs-'), children: new Set() };
    expect(await runAgent(ctx, { name: 'x', cwd: ctx.logsDir, prompt: 'p' })).toMatchObject({ ok: false, capExceeded: true });
  });
});

describe('the report', () => {
  const slice = (over = {}) => ({ name: 'a', ok: true, reason: 'fine', costUsd: 0, ...over });

  it('passes only when every slice passed, and renders PASS or FAIL per slice', () => {
    const pass = buildReport({ skill: 's', mode: 'm', capUsd: 1, slices: [slice(), slice({ name: 'b', costUsd: 0.5 })], spentUsd: 0.5 });
    expect(exitCodeFor(pass)).toBe(0);
    expect(renderReport(pass)).toMatch(/PASS a[\s\S]*PASS b[\s\S]*RESULT: PASS/);
    const fail = buildReport({ skill: 's', mode: 'm', capUsd: 1, slices: [slice(), slice({ name: 'b', ok: false, reason: 'boom' })], spentUsd: 0 });
    expect(exitCodeFor(fail)).toBe(1);
    expect(renderReport(fail)).toContain('RESULT: FAIL (b: boom)');
    expect(exitCodeFor(buildReport({ skill: 's', mode: 'm', capUsd: 1, slices: [], spentUsd: 0 }))).toBe(1);
  });

  it('marks a run over its cap, even when every slice passed', () => {
    const over = buildReport({ skill: 's', mode: 'm', capUsd: 1, slices: [slice({ capExceeded: true, ok: false, reason: 'cost cap exceeded' })], spentUsd: 1.2 });
    expect(over.overCap).toBe(true);
    expect(renderReport(over)).toContain('(CAP EXCEEDED)');
  });
});

describe('the fake agent', () => {
  it('knows the skill a prompt asks for and reads the budget flag', () => {
    expect(actionFor(SETUP_PROMPT)).toBe('setup');
    expect(actionFor(SYNC_PROMPT)).toBe('sync');
    expect(actionFor('Use the lantern-delegate skill to delegate this task: x')).toBe('delegate');
    expect(actionFor('do something else')).toBeNull();
    expect(parseAgentArgs(['-p', 'hi', '--max-budget-usd', '0.5'])).toEqual({ prompt: 'hi', budgetUsd: 0.5 });
    expect(parseAgentArgs(['-p', 'hi']).budgetUsd).toBe(Infinity);
  });

  it('stops with error_max_budget_usd before touching anything when its cost passes the budget', () => {
    const cwd = tmp('fake-cwd-');
    const out: string[] = [];
    const code = runFakeAgent(['-p', SETUP_PROMPT, '--max-budget-usd', '0.01'], { costUsd: 0.05 }, cwd, (l: string) => out.push(l));
    expect(code).toBe(1);
    expect(JSON.parse(out[0])).toMatchObject({ type: 'result', subtype: 'error_max_budget_usd', is_error: true, total_cost_usd: 0.05 });
    expect(fs.readdirSync(cwd)).toEqual([]);
  });

  it('fails on a prompt it does not know and reports its cost on success', () => {
    const cwd = tmp('fake-cwd-');
    const out: string[] = [];
    expect(runFakeAgent(['-p', 'hello'], {}, cwd, (l: string) => out.push(l))).toBe(1);
    expect(JSON.parse(out[0]).subtype).toBe('error_during_execution');
    createTinyProject(cwd);
    const done: string[] = [];
    expect(runFakeAgent(['-p', SETUP_PROMPT, '--max-budget-usd', '1'], { costUsd: 0.07 }, cwd, (l: string) => done.push(l))).toBe(0);
    expect(JSON.parse(done[0])).toMatchObject({ subtype: 'success', is_error: false, total_cost_usd: 0.07 });
    expect(JSON.parse(resultLine({ costUsd: 1 })).permission_denials).toEqual([]);
  });

  it('writes an executable stand-in for the claude binary', () => {
    const file = writeFakeClaude(path.join(tmp(), 'claude'), { scenario: 'good', costUsd: 0.01 });
    expect(fs.statSync(file).mode & 0o111).not.toBe(0);
    expect(fs.readFileSync(file, 'utf8')).toContain('"costUsd":0.01');
  });
});

describe('the fixtures', () => {
  it('maps every enumerated file so validate --settled passes, and sees a later edit as stale', () => {
    const root = tmp('fixture-');
    createTinyProject(root);
    expect(validateSettled(root).status).toBe(1);
    const before = snapshotSources(root);
    expect(mapProject(root)).toEqual(Object.keys(before).sort());
    expect(validateSettled(root)).toMatchObject({ status: 0 });
    expect(changedSources(root, before)).toEqual([]);
    fs.appendFileSync(path.join(root, 'src', 'greet.mjs'), '// edit\n');
    expect(changedSources(root, before)).toEqual(['src/greet.mjs']);
    expect(validateSettled(root).stdout).toContain('stale');
  });

  it('leaves a skipped file unmapped', () => {
    const root = tmp('fixture-');
    createTinyProject(root);
    mapProject(root, { skip: ['src/shout.mjs'] });
    expect(validateSettled(root).stdout).toContain('unmapped: src/shout.mjs');
  });
});

describe.skipIf(process.platform === 'win32')('offline runs, one command per skill', () => {
  for (const skill of SKILL_NAMES) {
    it(`${skill} passes with the fake agent and spends only what the fake reports`, async () => {
      const { code, report, lines } = await runJson([skill]);
      expect(lines.join('\n')).not.toContain('crashed');
      expect(code).toBe(0);
      expect(report).toMatchObject({ skill, passed: true, overCap: false });
      expect(report.slices.every((s: { ok: boolean }) => s.ok)).toBe(true);
      expect(report.spentUsd).toBeGreaterThan(0);
      expect(report.spentUsd).toBeLessThanOrEqual(report.capUsd);
    }, 180_000);

    it(`${skill} fails and exits 1 when the fake agent leaves the fixture broken`, async () => {
      const { code, report } = await runJson([skill, '--fake', 'broken']);
      expect(code).toBe(1);
      expect(report.passed).toBe(false);
      const paid = SKILLS[skill as keyof typeof SKILLS].slices.filter((s) => s.paid).map((s) => s.name);
      expect(report.slices.filter((s: { ok: boolean }) => !s.ok).map((s: { name: string }) => s.name)).toEqual(paid);
    }, 180_000);
  }

  it('fails with the reason when the spend passes the cap, and runs nothing after it', async () => {
    const { code, report } = await runJson(['lantern-setup', '--max-usd', '0.01']);
    expect(code).toBe(1);
    expect(report).toMatchObject({ passed: false, overCap: true });
    const failed = report.slices.find((s: { ok: boolean }) => !s.ok);
    expect(failed.name).toBe('map-fixture');
    expect(failed.reason).toContain('cost cap exceeded');
  }, 120_000);

  it('skips later slices once one fails, and still reports FAIL', async () => {
    const { report } = await runJson(['lantern-delegate', '--max-usd', '0.01']);
    expect(report.passed).toBe(false);
    expect(report.slices.map((s: { name: string; ok: boolean }) => `${s.name}:${s.ok}`)).toEqual(['rig-ready:true', 'extra-skills:true', 'delegate-run:false']);
    expect(report.slices[2].reason).toMatch(/cost cap/);
  }, 120_000);

  it('removes its fixture and temp files, and keeps them with --keep', async () => {
    const base = tmp('skill-test-tmp-');
    vi.stubEnv('TMPDIR', base);
    await runSkill(parseArgs(['lantern-setup'], {}), {});
    expect(fs.readdirSync(base)).toEqual([]);
    const out = quiet();
    await runSkill(parseArgs(['lantern-setup', '--keep'], {}), { log: out.log });
    expect(fs.readdirSync(base)).toHaveLength(1);
    expect(out.lines.join('\n')).toContain('kept ');
  }, 120_000);

  it('works as a command: a dry run exits 0 and creates nothing, a bad skill exits 2', async () => {
    const base = tmp('skill-test-tmp-');
    const env = { ...process.env, TMPDIR: base };
    const dry = await exec(process.execPath, [RUN, 'lantern-sync', '--dry-run'], { env });
    expect(dry.stdout).toContain('cost cap: $1.00');
    expect(fs.readdirSync(base)).toEqual([]);
    await expect(exec(process.execPath, [RUN, 'nope'], { env })).rejects.toMatchObject({ code: 2 });
    expect(fs.readdirSync(base)).toEqual([]);
  });
});

describe('the live path, wired to a stand-in binary so nothing is spent', () => {
  function recordingClaude() {
    const dir = tmp('live-claude-');
    const log = path.join(dir, 'argv.jsonl');
    const module = path.join(__dirname, '..', 'scripts', 'skill-test', 'fake-agent.mjs');
    const file = path.join(dir, 'claude');
    fs.writeFileSync(
      file,
      `#!/usr/bin/env node
import fs from 'node:fs';
import { runFakeAgent } from ${JSON.stringify(`file://${module}`)};
if (process.argv[2] === '--version') { console.log('0.0.0-test'); process.exit(0); }
fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify(process.argv.slice(2)) + '\\n');
process.exitCode = runFakeAgent(process.argv.slice(2), { costUsd: 0.2 });
`,
      { mode: 0o755 },
    );
    return { file, log };
  }

  it('shows the cap before starting, hands each call what is left of it and passes', async () => {
    const claude = recordingClaude();
    const out = quiet();
    const code = await main(['lantern-setup', '--live', '--max-usd', '0.5'], { CLAUDE_BIN: claude.file }, out);
    expect(code).toBe(0);
    const text = out.lines.join('\n');
    expect(text.indexOf('cost cap: $0.50')).toBeGreaterThan(-1);
    expect(text.indexOf('cost cap: $0.50')).toBeLessThan(text.indexOf('RESULT: PASS'));
    expect(text).toContain('LIVE');
    const calls = fs.readFileSync(claude.log, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    expect(calls).toHaveLength(1);
    expect(calls[0][calls[0].indexOf('--max-budget-usd') + 1]).toBe('0.5');
    expect(calls[0]).toContain('--output-format');
  }, 120_000);

  it('fails the run when the binary reports a spend over the cap', async () => {
    const claude = recordingClaude();
    const out = quiet();
    const code = await main(['lantern-setup', '--live', '--max-usd', '0.1'], { CLAUDE_BIN: claude.file }, out);
    expect(code).toBe(1);
    expect(out.lines.join('\n')).toContain('cost cap exceeded');
  }, 120_000);

  it('refuses to start without a runnable claude binary, before any fixture exists', async () => {
    const base = tmp('skill-test-tmp-');
    vi.stubEnv('TMPDIR', base);
    const out = quiet();
    expect(await main(['lantern-setup', '--live'], { CLAUDE_BIN: '/definitely/not/claude' }, out)).toBe(2);
    expect(out.lines.join('\n')).toContain('cannot run');
    expect(fs.readdirSync(base)).toEqual([]);
  });

  it('still shows the plan and the cap, on stderr, before a --live --json run starts', async () => {
    const claude = recordingClaude();
    const events: string[] = [];
    const code = await main(['lantern-setup', '--live', '--json', '--max-usd', '0.5'], { CLAUDE_BIN: claude.file }, {
      log: (line: string) => void events.push(`out:${line}`),
      err: (line: string) => void events.push(`err:${line}`),
    });
    expect(code).toBe(0);
    const planAt = events.findIndex((e) => e.startsWith('err:') && e.includes('cost cap: $0.50') && e.includes('LIVE'));
    const reportAt = events.findIndex((e) => e.startsWith('out:{'));
    expect(planAt).toBeGreaterThan(-1);
    expect(reportAt).toBeGreaterThan(planAt);
    expect(events.filter((e) => e.startsWith('out:'))).toHaveLength(1);
  }, 120_000);

  it('prints the plan and the cap for --live --json --dry-run and starts nothing', async () => {
    const claude = recordingClaude();
    const events: string[] = [];
    const code = await main(['lantern-delegate', '--live', '--json', '--dry-run'], { CLAUDE_BIN: claude.file }, {
      log: (line: string) => void events.push(`out:${line}`),
      err: (line: string) => void events.push(`err:${line}`),
    });
    expect(code).toBe(0);
    expect(events.filter((e) => e.startsWith('out:'))).toEqual([]);
    expect(events.join('\n')).toContain('cost cap: $3.00');
    expect(fs.existsSync(claude.log)).toBe(false);
  });

  it('never starts live without the flag, even with a binary configured', async () => {
    const claude = recordingClaude();
    const code = await main(['lantern-setup'], { CLAUDE_BIN: claude.file }, quiet());
    expect(code).toBe(0);
    expect(fs.existsSync(claude.log)).toBe(false);
  }, 120_000);
});
