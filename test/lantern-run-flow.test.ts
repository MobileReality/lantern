import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAreasProject } from '../scripts/skill-test/areas-fixtures.mjs';
import * as agent from '../src/main/agent';
import { installFakeClaude } from './helpers/fake-claude';
import type { FakeClaude } from './helpers/fake-claude';

vi.setConfig({ testTimeout: 60_000, hookTimeout: 30_000 });

const ROOT = path.join(__dirname, '..');
const SKILL = path.join(ROOT, 'skills', 'lantern-setup');
const HELPER = path.join(__dirname, 'helpers', 'fake-lantern-agent.mjs');

const script = (name: string, project: string, ...args: string[]) => {
  const res = spawnSync(process.execPath, [path.join(SKILL, 'scripts', name), project, ...args], { encoding: 'utf8' });
  return { status: res.status, out: `${res.stdout}${res.stderr}` };
};

describe('a Lantern map run on a project over the Areas thresholds', () => {
  let tools: string;
  let home: string;
  let project: string;
  let fake: FakeClaude;

  beforeEach(() => {
    tools = fs.mkdtempSync(path.join(os.tmpdir(), 'lantern-flow-tools-'));
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'lantern-flow-home-'));
    project = fs.mkdtempSync(path.join(os.tmpdir(), 'lantern-flow-project-'));
    fake = installFakeClaude(tools);
    agent.setConfiguredBin(() => fake.bin);
    vi.stubEnv('HOME', home);
    vi.stubEnv('USERPROFILE', home);
    vi.stubEnv('LANTERN_CLAUDE_BIN', '');
    vi.stubEnv('CLAUDE_BIN', '');
    vi.stubEnv('FAKE_CLAUDE_MODE', 'lantern');
    vi.stubEnv('FAKE_CLAUDE_LANTERN', HELPER);
    vi.stubEnv('FAKE_LANTERN_SKILL', SKILL);
    vi.stubEnv('FAKE_LANTERN_PROJECT', project);
    vi.stubEnv('FAKE_LANTERN_SCENARIO', '');
    createAreasProject(project);
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await agent.cancel();
    agent.setConfiguredBin(() => '');
    for (const dir of [tools, home, project]) fs.rmSync(dir, { recursive: true, force: true });
  });

  function run(kind: 'lantern' | 'lantern-refresh') {
    const events: agent.AgentEvent[] = [];
    const finished = new Promise<agent.AgentEvent>((resolve) => {
      const res = agent.start({
        project,
        kind,
        onEvent: (event) => {
          events.push(event);
          if (event.kind === 'done' || event.kind === 'error') resolve(event);
        },
      });
      if (!res.ok) resolve({ kind: 'error', text: res.error });
    });
    return { events, finished };
  }

  const scenario = (name: string) => vi.stubEnv('FAKE_LANTERN_SCENARIO', name);
  const freshProject = () => fs.rmSync(path.join(project, '.lantern'), { recursive: true, force: true });
  const lookupCalls = () => fake.calls().filter((call) => call.args.includes('--output-format') && call.args[call.args.indexOf('--output-format') + 1] === 'json');

  function expectFullMap() {
    expect(fs.existsSync(path.join(project, '.lantern', 'areas'))).toBe(true);
    expect(fs.existsSync(path.join(project, '.lantern', 'lang', 'en', 'areas.json'))).toBe(true);
    expect(script('areas.mjs', project, 'check')).toMatchObject({ status: 0 });
    expect(script('validate.mjs', project, '--settled')).toMatchObject({ status: 0 });
    expect(script('validate.mjs', project, '--settled', '--require-areas')).toMatchObject({ status: 0 });
    expect(script('areas.mjs', project, 'required').out).toContain('required and done');
  }

  it('Set up on a fresh project ends with the areas, check and settled green, and a blind lookup per feature', async () => {
    freshProject();
    const { events, finished } = run('lantern');
    expect(await finished).toMatchObject({ kind: 'done', ok: true });
    expectFullMap();
    expect(lookupCalls()).toHaveLength(12);
    expect(events.filter((e) => e.kind === 'error')).toEqual([]);
  });

  it('Refresh of a flat map over the thresholds ends with the areas too', async () => {
    expect(script('areas.mjs', project, 'required').status).toBe(1);
    expect(fs.existsSync(path.join(project, '.lantern', 'areas'))).toBe(false);
    expect(await run('lantern-refresh').finished).toMatchObject({ kind: 'done', ok: true });
    expectFullMap();
  });

  it('hands the run the paths, the step and the scratch folder it needs, and keeps the scratch folder ignored', async () => {
    freshProject();
    await run('lantern').finished;
    const [main] = fake.calls();
    const prompt = main.args[1];
    expect(prompt).toContain(`Project root: ${project}.`);
    expect(prompt).toContain('areas (step 4a)');
    expect(prompt).toContain('--settled --require-areas');
    expect(main.args.slice(main.args.indexOf('--allowedTools') + 1)).toEqual(agent.allowedToolsFor('lantern'));
    expect(fs.readFileSync(path.join(project, '.lantern', '.project', '.gitignore'), 'utf8')).toBe('*\n');
    expect(fs.existsSync(path.join(project, '.lantern', '.project', 'areas', 'manifest.json'))).toBe(true);
  });

  it('does not report done when the model skips step 4a: the run fails and names the step, the files and the tree that is missing', async () => {
    scenario('skip-areas');
    freshProject();
    const { events, finished } = run('lantern');
    const last = await finished;
    expect(last.kind).toBe('error');
    expect(last.text).toContain('step 4a');
    expect(last.text).toContain('121 records and 12 features');
    expect(last.text).toContain('.lantern/areas does not exist');
    expect(events.filter((e) => e.kind === 'done')).toEqual([]);
    expect(script('validate.mjs', project, '--settled').status).toBe(0);
    const gate = script('validate.mjs', project, '--settled', '--require-areas');
    expect(gate.status).toBe(1);
    expect(gate.out).toContain('step 4a');
  });

  it('fails the same way when the tree is there but does not pass areas.mjs check', async () => {
    scenario('skip-areas');
    fs.writeFileSync(path.join(project, '.lantern', 'areas'), 'only-area\n  catalog\n');
    fs.mkdirSync(path.join(project, '.lantern', 'lang', 'en'), { recursive: true });
    fs.writeFileSync(path.join(project, '.lantern', 'lang', 'en', 'areas.json'), JSON.stringify({ text: { 'only-area': 'a single area for one feature here' } }));
    const last = await run('lantern-refresh').finished;
    expect(last.kind).toBe('error');
    expect(last.text).toContain('areas.mjs check');
  });

  it('fails loudly when a mapper worker is refused a call: no done event, the refused command named', async () => {
    scenario('worker-denied');
    freshProject();
    const { events, finished } = run('lantern');
    const last = await finished;
    expect(last.kind).toBe('error');
    expect(last.text).toContain('A mapper worker call was refused permission');
    expect(last.text).toContain('Bash `cd /project; L=.claude/skills/lantern-setup; node $L/scripts/plan.mjs . chunk 3`');
    expect(last.text).toContain('Resume maps only what is still missing');
    expect(events.filter((e) => e.kind === 'done')).toEqual([]);
  });

  it('does not fail a run for the main agent being refused a call it worked around', async () => {
    scenario('main-denied');
    freshProject();
    expect(await run('lantern').finished).toMatchObject({ kind: 'done', ok: true });
    expectFullMap();
  });

  it('leaves a map under the thresholds flat, exactly as before', async () => {
    for (const feature of fs.readdirSync(path.join(project, 'src')).slice(3)) fs.rmSync(path.join(project, 'src', feature), { recursive: true });
    freshProject();
    expect(await run('lantern').finished).toMatchObject({ kind: 'done', ok: true });
    expect(fs.existsSync(path.join(project, '.lantern', 'areas'))).toBe(false);
    expect(script('areas.mjs', project, 'required').out).toContain('not required (31 records, 3 features)');
    expect(script('validate.mjs', project, '--settled', '--require-areas').status).toBe(0);
  });
});
