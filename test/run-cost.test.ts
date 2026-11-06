import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { analyseRun } from '../scripts/run-cost/analysis.mjs';
import { BASELINE_VERSION, buildBaseline, compareBaselines, parseBaseline, serializeBaseline } from '../scripts/run-cost/baseline.mjs';
import { assignPhases, classifyTool } from '../scripts/run-cost/phases.mjs';
import { main } from '../scripts/run-cost/run.mjs';
import { TOKEN_ESTIMATOR, readRunTree } from '../scripts/run-cost/transcripts.mjs';
import { CALL_USD, DELEGATE_ID, VERDICT_RED, agentTranscript, tmpRoot, toolUse, writeRun } from './helpers/run-cost-fixture';

const RUN = path.join(__dirname, '..', 'scripts', 'run-cost', 'run.mjs');
const roots: string[] = [];

afterEach(() => {
  vi.restoreAllMocks();
  for (const r of roots.splice(0)) fs.rmSync(r, { recursive: true, force: true });
});

function fixture(options?: Parameters<typeof writeRun>[1]) {
  const root = tmpRoot();
  roots.push(root);
  return { root, dir: writeRun(root, options) };
}

const analyse = (dir: string) => analyseRun(readRunTree(dir, DELEGATE_ID));

function quiet() {
  const lines: string[] = [];
  return { lines, log: (...a: unknown[]) => void lines.push(a.join(' ')), err: (...a: unknown[]) => void lines.push(a.join(' ')) };
}

describe('tool-output counter', () => {
  it('sums tool_result text per tool and per agent with bytes/4', () => {
    const { dir } = fixture();
    const analysis = analyse(dir);
    expect(TOKEN_ESTIMATOR).toBe('bytes/4');
    expect(analysis.tools.Bash).toEqual({ calls: 5, outputTokens: 8 + 100 + 50 + 10 + 10 });
    expect(analysis.tools.Read).toEqual({ calls: 1, outputTokens: 200 });
    expect(analysis.tools.Grep).toEqual({ calls: 1, outputTokens: 30 });
    expect(analysis.tools.Edit).toEqual({ calls: 1, outputTokens: 2 });
    const byType = Object.fromEntries(analysis.agents.map((a: { type: string; toolOutputTokens: number }) => [a.type, a.toolOutputTokens]));
    expect(byType).toEqual({ 'lantern-delegate-medium': 8 + 200 + 2 + 100 + 2 + 50 + 10, reviewer: 10 + 30 });
  });

  it('counts only text parts and keeps one call per streamed message id', () => {
    const { dir } = fixture();
    const analysis = analyse(dir);
    expect(analysis.total.calls).toBe(9);
    expect(analysis.total.output).toBe(9 * 50);
    expect(analysis.total.usd).toBeCloseTo(9 * CALL_USD, 10);
  });
});

describe('phase attribution', () => {
  it('puts the brief, work, review and handover calls and their tool output where the boundaries say', () => {
    const { dir } = fixture();
    const { phases } = analyse(dir);
    expect(phases.brief).toMatchObject({ calls: 2, toolOutputTokens: 8 + 200, tokens: 2 * 1160 });
    expect(phases.work).toMatchObject({ calls: 1, toolOutputTokens: 2 + 100 });
    expect(phases.review).toMatchObject({ calls: 4, toolOutputTokens: 2 + 10 + 30 });
    expect(phases.handover).toMatchObject({ calls: 2, toolOutputTokens: 50 + 10 });
    expect(phases.review.usd).toBeCloseTo(4 * CALL_USD, 10);
  });

  it('puts the Fable reviewer in the review phase and the Opus and Fable delegates through the usual phases', () => {
    expect(classifyTool({ name: 'Agent', input: { subagent_type: 'reviewer-complex' } })).toBe('review');
    expect(classifyTool({ name: 'Agent', input: { subagent_type: 'lantern-mapper' } })).toBe('work');
    const calls = [{ tools: [toolUse('Read', { file_path: 'a.ts' })] }, { tools: [toolUse('Edit', { file_path: 'src/a.ts' })] }, { tools: [toolUse('Edit', { file_path: '.lantern/map/a.lantern' })] }];
    expect(assignPhases('reviewer-complex', calls)).toEqual(['review', 'review', 'review']);
    for (const type of ['lantern-delegate-complex-fable-high', 'lantern-delegate-complex-opus-medium']) {
      expect(assignPhases(type, calls)).toEqual(['brief', 'work', 'handover']);
    }
  });

  it('classifies by tool and agent type', () => {
    expect(classifyTool({ name: 'Agent', input: { subagent_type: 'reviewer' } })).toBe('review');
    expect(classifyTool({ name: 'Agent', input: { subagent_type: 'Explore' } })).toBe('work');
    expect(classifyTool({ name: 'Bash', input: { command: 'git push origin HEAD:refs/heads/feat/x' } })).toBe('handover');
    expect(classifyTool({ name: 'Bash', input: { command: 'node a/lantern-sync/scripts/sync.mjs verify' } })).toBe('handover');
    expect(classifyTool({ name: 'Bash', input: { command: 'pnpm exec vitest run' } })).toBe('work');
    expect(classifyTool({ name: 'Bash', input: { command: 'ls .lantern/prs/120.pr' } })).toBe('neutral');
    expect(classifyTool({ name: 'Bash', input: { command: 'ls a && cat b' } })).toBe('neutral');
    expect(classifyTool({ name: 'Bash', input: { command: 'cat x && pnpm exec vitest run' } })).toBe('work');
    const linker = (name: string) => `/opt/tools/${name}`;
    for (const name of ['my-linker', 'skill-linker']) {
      expect(classifyTool({ name: 'Bash', input: { command: `${linker(name)} . --skill typescript` } }, linker(name))).toBe('neutral');
      expect(classifyTool({ name: 'Bash', input: { command: `ls && ${name} --list` } }, linker(name))).toBe('neutral');
    }
    expect(classifyTool({ name: 'Bash', input: { command: '/opt/tools/skill-linker . --skill typescript' } }, linker('my-linker'))).toBe('work');
    expect(classifyTool({ name: 'Bash', input: { command: '/opt/tools/skill-linker . --skill typescript' } })).toBe('work');
    expect(classifyTool({ name: 'Edit', input: { file_path: '/p/.lantern/map/x.lantern' } })).toBe('handover');
    expect(classifyTool({ name: 'Edit', input: { file_path: '/p/src/a.ts' } })).toBe('work');
    expect(classifyTool({ name: 'Read', input: { file_path: '/p/src/a.ts' } })).toBe('neutral');
  });
});

describe('pass result', () => {
  it('reads the last reviewer verdict', () => {
    expect(analyse(fixture().dir).pass).toEqual({ value: true, source: 'reviewer-verdict' });
    expect(analyse(fixture({ verdict: VERDICT_RED }).dir).pass).toEqual({ value: false, source: 'reviewer-verdict' });
    expect(analyse(fixture({ verdict: null }).dir).pass).toEqual({ value: null, source: 'none' });
  });
});

describe('baseline file', () => {
  const make = (options?: Parameters<typeof writeRun>[1], passOverride?: boolean) =>
    buildBaseline({ analysis: analyse(fixture(options).dir), label: 'synthetic fixture', runId: 'run-1', project: 'fixture', passOverride });

  it('round-trips and carries the version, run, estimators, phases and tools', () => {
    const baseline = make();
    const parsed = parseBaseline(serializeBaseline(baseline));
    expect(parsed).toEqual(baseline);
    expect(parsed.version).toBe(BASELINE_VERSION);
    expect(parsed.run).toEqual({ id: 'run-1', project: 'fixture', model: 'claude-sonnet-5-5', effort: 'medium' });
    expect(Object.keys(parsed.phases)).toEqual(['brief', 'work', 'review', 'handover']);
    expect(parsed.estimators.toolOutputTokens).toBe('bytes/4');
    expect(parsed.tools.Bash.outputTokens).toBe(178);
    expect(serializeBaseline(parseBaseline(serializeBaseline(baseline)))).toBe(serializeBaseline(baseline));
  });

  it('stores no transcript text', () => {
    const text = serializeBaseline(make());
    expect(text).not.toContain('git fetch');
    expect(text).not.toContain('xxxx');
  });

  it('refuses another schema version, a missing label and a foreign file', () => {
    const baseline = make();
    expect(() => parseBaseline(JSON.stringify({ ...baseline, version: BASELINE_VERSION + 1 }))).toThrow(/version/);
    expect(() => parseBaseline(JSON.stringify({ ...baseline, label: '' }))).toThrow(/label/);
    expect(() => parseBaseline(JSON.stringify({ schema: 'other' }))).toThrow(/not a lantern-run-cost-baseline/);
    expect(() => parseBaseline('nope')).toThrow(/not valid JSON/);
  });

  it('compare prints the delta and flags a changed pass result', () => {
    const a = make();
    const slimmer = structuredClone(a);
    slimmer.phases.work.toolOutputTokens = 2;
    slimmer.tools.Bash.outputTokens = 78;
    const same = compareBaselines(a, slimmer);
    expect(same.samePass).toBe(true);
    expect(same.text).toContain('102 -> 2 (-98.0%)');
    expect(same.text).toContain('Bash           178 -> 78 (-100, -56.2%)');
    const changed = compareBaselines(a, make(undefined, false));
    expect(changed.samePass).toBe(false);
    expect(changed.text).toContain('pass result: pass -> fail (DIFFERENT)');
  });

  it('compare refuses baselines made with different estimators', () => {
    const a = make();
    const b = structuredClone(a);
    b.estimators.toolOutputTokens = 'api-count';
    expect(() => compareBaselines(a, b)).toThrow(/different estimators/);
  });
});

describe('command', () => {
  function baselinePaths() {
    const { root } = fixture();
    const green = path.join(root, 'green.json');
    const red = path.join(root, 'red.json');
    const dir = path.join(root, 'transcripts');
    expect(main([dir, '--agent-id', DELEGATE_ID, '--label', 'fixture', '--out', green], quiet())).toBe(0);
    expect(main([dir, '--agent-id', DELEGATE_ID, '--label', 'fixture', '--fail', '--out', red], quiet())).toBe(0);
    return { green, red };
  }

  it('prints the per-phase table and writes a baseline', () => {
    const { root, dir } = fixture();
    const out = quiet();
    const file = path.join(root, 'b.json');
    expect(main([dir, '--agent-id', DELEGATE_ID, '--project', 'fixture', '--label', 'synthetic', '--out', file], out)).toBe(0);
    const text = out.lines.join('\n');
    for (const phase of ['brief', 'work', 'review', 'handover', 'total']) expect(text).toContain(phase);
    expect(text).toContain('bytes/4');
    expect(parseBaseline(fs.readFileSync(file, 'utf8')).run.project).toBe('fixture');
  });

  it('refuses --out without a label and a path-like agent id', () => {
    const { dir } = fixture();
    expect(main([dir, '--agent-id', DELEGATE_ID, '--out', 'x.json'], quiet())).toBe(2);
    expect(main([dir, '--agent-id', '../x'], quiet())).toBe(2);
  });

  it('--compare exits 0 for the same pass result and 1 for a changed one', () => {
    const { green, red } = baselinePaths();
    const same = quiet();
    expect(main(['--compare', green, green], same)).toBe(0);
    expect(same.lines.join('\n')).toContain('(same)');
    const changed = quiet();
    expect(main(['--compare', green, red], changed)).toBe(1);
    expect(changed.lines.join('\n')).toContain('DIFFERENT');
    expect(main(['--compare', green, path.join(path.dirname(green), 'missing.json')], quiet())).toBe(2);
  });

  it('exits non-zero as a process when the pass result differs', () => {
    const { green, red } = baselinePaths();
    const run = (a: string, b: string) => spawnSync(process.execPath, [RUN, '--compare', a, b], { encoding: 'utf8' });
    expect(run(green, green).status).toBe(0);
    const diff = run(green, red);
    expect(diff.status).toBe(1);
    expect(diff.stdout).toContain('DIFFERENT');
  });

  it('reads nothing outside the transcripts directory it is given', () => {
    const { root, dir } = fixture();
    const outside = path.join(root, 'outside.txt');
    fs.writeFileSync(outside, agentTranscript([{ tools: [toolUse('OutsideTool', {})], results: ['secret'] }]));
    fs.symlinkSync(outside, path.join(dir, 'agent-aevil.jsonl'));
    fs.writeFileSync(path.join(dir, 'agent-aevil.meta.json'), JSON.stringify({ agentType: 'reviewer', parentAgentId: DELEGATE_ID }));
    const touched: string[] = [];
    for (const name of ['readFileSync', 'readdirSync', 'lstatSync', 'statSync', 'existsSync', 'openSync', 'realpathSync', 'readlinkSync', 'accessSync'] as const) {
      const real = (fs as Record<string, (...a: unknown[]) => unknown>)[name];
      vi.spyOn(fs, name as 'readFileSync').mockImplementation(((p: unknown, ...rest: unknown[]) => {
        touched.push(String(p));
        return real.call(fs, p, ...rest);
      }) as never);
    }
    const out = quiet();
    expect(main([dir, '--agent-id', DELEGATE_ID, '--json'], out)).toBe(0);
    vi.restoreAllMocks();
    expect(touched.length).toBeGreaterThan(0);
    for (const p of touched) expect(path.resolve(p).startsWith(dir)).toBe(true);
    expect(touched).not.toContain(outside);
    expect(out.lines.join('\n')).not.toContain('OutsideTool');
  });
});
