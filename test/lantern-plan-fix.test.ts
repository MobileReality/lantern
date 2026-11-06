import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as agent from '../src/main/agent';
import { safeAgentRequest } from '../src/main/agent-request';
import { parsePlanFile } from '../src/main/lantern-plan';
import { planFixPrompt } from '../src/main/lantern-plan-fix';
import { loadPlans } from '../src/main/lantern-plans';
import { brokenPlan, isPlanFixTarget, planFixText } from '../src/shared/lantern-plan-fix';
import { VIEW, say } from '../src/shared/lantern-plan-messages';
import { installFakeClaude } from './helpers/fake-claude';
import type { FakeClaude } from './helpers/fake-claude';
import { makeTmp, write } from './helpers/git-repo';
import { EXAMPLE, fixtureText, importScript, makeProject, removeDir } from './helpers/lantern-plan-world';

vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });

const FILE = `${EXAMPLE}.plan`;
const WHERE = `.lantern/plans/${FILE}`;
const TWO_PROBLEMS = `${fixtureText(EXAMPLE)}not a plan line\n#touch kind\n`;
const WRONG_HEADER = 'lantern-plan 2\n';
const SCRIPT = 'node .claude/skills/lantern-plan/scripts/plan.mjs';

let parsePlan: (text: string, file: string) => { errors: string[]; warnings: string[] };

beforeAll(async () => {
  parsePlan = (await importScript<{ parsePlan: typeof parsePlan }>('plan-parse.mjs')).parsePlan;
});

const problemsOf = (source: string) => parsePlanFile(source, FILE).problems;
const lineOf = (message: string) => message.replace(/^.*?:(\d+): /, 'line $1: ');

describe('the text to hand to an agent for a plan with problems', () => {
  const text = planFixText({ file: FILE, problems: problemsOf(TWO_PROBLEMS), error: null });

  it('names the plan file and the slug', () => {
    expect(text).toContain(`Lantern plan ${EXAMPLE}: fix the problems in ${WHERE}`);
    expect(text).toContain(`Plan file: ${WHERE}`);
    expect(text).toContain(`Slug: ${EXAMPLE}`);
  });

  it('lists every problem with its line number and its message', () => {
    expect(text).toContain('Lantern found 2 problems in this plan file:');
    expect(text).toContain('- line 66: not a plan line (every line is "#tag ..."), got "not a plan line"');
    expect(text).toContain('- line 67: #touch unknown kind "kind" (known: area, feature, file, new)');
  });

  it('tells the agent to use the lantern-plan skill, edit only what the problems name, run the check and report what is left', () => {
    expect(text).toContain('Fix it with the lantern-plan skill');
    expect(text).toContain(`edit only what the problems name in ${WHERE} and change nothing else in the project`);
    expect(text).toContain(`run ${SCRIPT} check ${EXAMPLE} and report what is still wrong`);
  });

  it('says "1 problem" for one', () => {
    expect(planFixText({ file: FILE, problems: ['line 3: x'], error: null })).toContain('Lantern found 1 problem in this plan file:');
  });

  it('carries no credential and no text of the plan beyond the problems', () => {
    expect(text).not.toMatch(/token|password|secret|Bearer|BITBUCKET|GITHUB/i);
    expect(text).not.toContain('#goal');
  });
});

describe('the text for a plan file that does not load', () => {
  it('carries the parse error of the app and no problem list', () => {
    const error = parsePlanFile(WRONG_HEADER, FILE).error ?? '';
    const text = planFixText({ file: FILE, problems: [], error });
    expect(error).toBe('first line must be "lantern-plan 1"');
    expect(text).toContain(`Lantern could not read this plan file at all: ${error}`);
    expect(text).toContain(`Plan file: ${WHERE}`);
    expect(text).not.toContain('Lantern found');
    expect(text).toContain(`run ${SCRIPT} check ${EXAMPLE}`);
  });

  it('carries a parse error that names a line, as the app words it', () => {
    const error = parsePlanFile('lantern-plan 1\n#not an id\n', FILE).error ?? '';
    expect(error).toMatch(/^line 2: /);
    expect(planFixText({ file: FILE, problems: [], error })).toContain(error);
  });
});

describe('both parsers give the agent the same words', () => {
  it('builds one text from the problems of the app and the errors of plan.mjs check', () => {
    const fromApp = problemsOf(TWO_PROBLEMS);
    const fromSkill = parsePlan(TWO_PROBLEMS, WHERE).errors.map(lineOf);
    expect(fromSkill).toHaveLength(2);
    expect(planFixText({ file: FILE, problems: fromSkill, error: null })).toBe(planFixText({ file: FILE, problems: fromApp, error: null }));
  });

  it('agrees on the fault of a file that does not load', () => {
    const fromApp = parsePlanFile(WRONG_HEADER, FILE).error ?? '';
    const fromSkill = parsePlan(WRONG_HEADER, WHERE).errors[0];
    expect(fromSkill).toContain(fromApp);
  });
});

describe('a plan that does not load is still reachable', () => {
  let root: string;
  afterEach(() => removeDir(root));

  it('is listed by file and slug with the warning that names the file', async () => {
    root = makeProject([EXAMPLE]);
    write(root, '.lantern/plans/torn.plan', WRONG_HEADER);
    const loaded = await loadPlans(root);
    expect(loaded.plans.map((plan) => plan.slug)).toEqual([EXAMPLE]);
    expect(loaded.broken).toEqual([brokenPlan('torn.plan', 'first line must be "lantern-plan 1"')]);
    expect(loaded.broken[0]).toMatchObject({ file: 'torn.plan', slug: 'torn' });
    expect(loaded.warnings).toEqual([loaded.broken[0].warning]);
    expect(loaded.warnings[0]).toBe('.lantern/plans/torn.plan cannot be read as a plan: first line must be "lantern-plan 1"');
  });

  it('keeps a plan with problems as a plan, not as a broken file', async () => {
    root = makeProject([]);
    write(root, `.lantern/plans/${FILE}`, TWO_PROBLEMS);
    const loaded = await loadPlans(root);
    expect(loaded.broken).toEqual([]);
    expect(loaded.plans[0].problems).toHaveLength(2);
  });
});

describe('which plan files an agent may be asked to fix', () => {
  it.each(['plan-on-the-map.plan', 'a.plan', 'Torn_1.plan'])('accepts %s', (file) => {
    expect(isPlanFixTarget(file)).toBe(true);
  });

  it.each(['', 'x.md', '../x.plan', 'dir/x.plan', '.hidden.plan', 'a*.plan', 'a b.plan', 'x.plan.md', 'a\0.plan'])('refuses %j', (file) => {
    expect(isPlanFixTarget(file)).toBe(false);
  });

  it('is checked for an agent request too', () => {
    const project = makeTmp('plan-fix-request-');
    try {
      expect(safeAgentRequest({ project, kind: 'plan-fix', target: FILE }, [project])?.target).toBe(FILE);
      for (const target of [undefined, '../x.plan', 'x.md']) expect(safeAgentRequest({ project, kind: 'plan-fix', target }, [project])).toBeNull();
    } finally {
      removeDir(project);
    }
  });
});

describe('the prompt the main process hands the agent', () => {
  let root: string;
  afterEach(() => removeDir(root));

  it('is the same text the person can copy, built from the file as it is now', () => {
    root = makeProject([]);
    write(root, `.lantern/plans/${FILE}`, TWO_PROBLEMS);
    expect(planFixPrompt(root, FILE)).toEqual({ prompt: planFixText({ file: FILE, problems: problemsOf(TWO_PROBLEMS), error: null }) });
  });

  it('is built from the parse error for a file that does not load', () => {
    root = makeProject([]);
    write(root, `.lantern/plans/${FILE}`, WRONG_HEADER);
    expect(planFixPrompt(root, FILE)).toEqual({ prompt: planFixText({ file: FILE, problems: [], error: 'first line must be "lantern-plan 1"' }) });
  });

  it('refuses a plan with nothing left to fix, a missing file and a name that is not a plan file', () => {
    root = makeProject([EXAMPLE]);
    expect(planFixPrompt(root, FILE)).toEqual({ error: say(VIEW.FIX_NOTHING, { file: WHERE }) });
    expect(planFixPrompt(root, 'gone.plan')).toMatchObject({ error: expect.stringContaining('Could not read .lantern/plans/gone.plan') });
    expect(planFixPrompt(root, '../x.plan')).toEqual({ error: say(VIEW.FIX_BAD_TARGET, { file: '../x.plan' }) });
    expect(planFixPrompt(root, undefined)).toEqual({ error: say(VIEW.FIX_BAD_TARGET, { file: '' }) });
  });
});

describe('the permissions of a plan fix', () => {
  const tools = agent.allowedToolsFor('plan-fix', FILE);

  it('allow reading the map and the planning skills, editing that one plan file and running the plan check', () => {
    expect(tools).toEqual([
      'Read(./.lantern/**)',
      'Read(./.claude/skills/lantern-plan*/**)',
      'Read(./.claude/skills/lantern-setup/references/**)',
      `Edit(./${WHERE})`,
      `Bash(${SCRIPT} check:*)`,
    ]);
  });

  it('allow no other edit, no wider shell, no sub-agent and no unscoped read', () => {
    expect(tools).not.toContain('Read');
    expect(tools).not.toContain('Agent');
    expect(tools.filter((tool) => tool.startsWith('Edit'))).toEqual([`Edit(./${WHERE})`]);
    expect(tools.filter((tool) => tool.startsWith('Bash'))).toEqual([`Bash(${SCRIPT} check:*)`]);
    expect(tools).not.toContain('Bash(node:*)');
  });

  it('start the CLI in the default permission mode, never acceptEdits, with exactly those tools', () => {
    const args = agent.buildArgs('plan-fix', 'the text', null, FILE);
    expect(args).toEqual(['-p', 'the text', '--output-format', 'stream-json', '--verbose', '--permission-mode', 'default', '--allowedTools', ...tools]);
    expect(args).not.toContain('acceptEdits');
    expect(args.join(' ')).not.toMatch(/bypass|dangerously|--model/);
  });

  it('leave every other kind exactly as it was', () => {
    expect(agent.buildArgs('fix', 'p')).toEqual(['-p', 'p', '--output-format', 'stream-json', '--verbose', '--permission-mode', 'acceptEdits']);
    expect(agent.allowedToolsFor('fix')).toEqual([]);
    expect(agent.allowedToolsFor('lantern')).toContain('Bash(node:*)');
  });
});

describe('Fix with an agent starts the agent on that text through the one agent path', () => {
  let tools: string;
  let fake: FakeClaude;
  let project: string;

  beforeEach(() => {
    tools = makeTmp('plan-fix-claude-');
    fake = installFakeClaude(tools);
    agent.setConfiguredBin(() => fake.bin);
    project = makeProject([]);
    write(project, `.lantern/plans/${FILE}`, TWO_PROBLEMS);
    write(project, '.claude/skills/lantern-plan/SKILL.md', '# lantern-plan\n');
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await agent.cancel();
    agent.setConfiguredBin(() => '');
    removeDir(tools);
    removeDir(project);
  });

  function run(overrides: Partial<Parameters<typeof agent.start>[0]> = {}) {
    const events: agent.AgentEvent[] = [];
    const finished = new Promise<agent.AgentEvent>((resolve) => {
      const res = agent.start({
        project,
        kind: 'plan-fix',
        target: FILE,
        onEvent: (event) => {
          events.push(event);
          if (event.kind === 'done' || event.kind === 'error') resolve(event);
        },
        ...overrides,
      });
      if (!res.ok) resolve({ kind: 'error', text: res.error });
    });
    return { events, finished };
  }

  it('calls the CLI once, in the project, with the prepared text and the narrow tool list', async () => {
    vi.stubEnv('FAKE_CLAUDE_MODE', 'stream');
    const { events, finished } = run();
    expect(await finished).toMatchObject({ kind: 'done', ok: true });
    const [call, ...others] = fake.calls();
    expect(others).toEqual([]);
    expect(fs.realpathSync(call.cwd)).toBe(fs.realpathSync(project));
    expect(call.args[0]).toBe('-p');
    expect(call.args[1]).toBe(planFixText({ file: FILE, problems: problemsOf(TWO_PROBLEMS), error: null }));
    expect(call.args.slice(call.args.indexOf('--permission-mode'), call.args.indexOf('--permission-mode') + 2)).toEqual(['--permission-mode', 'default']);
    expect(call.args.slice(call.args.indexOf('--allowedTools') + 1)).toEqual(agent.allowedToolsFor('plan-fix', FILE));
    expect(events.map((event) => event.kind)).toEqual(['start', 'text', 'tool', 'done']);
  });

  it('puts no credential in what it hands the CLI', async () => {
    vi.stubEnv('FAKE_CLAUDE_MODE', 'stream');
    await run().finished;
    const [call] = fake.calls();
    expect(JSON.stringify(call.args)).not.toMatch(/token|password|secret|Bearer/i);
  });

  it('reports a run that did not complete as not ok, with its permission denials', async () => {
    vi.stubEnv('FAKE_CLAUDE_MODE', 'stream-fail');
    expect(await run().finished).toMatchObject({ kind: 'done', ok: false, denials: 2 });
  });

  it('reports a CLI that exits with an error', async () => {
    vi.stubEnv('FAKE_CLAUDE_MODE', 'error');
    expect(await run().finished).toEqual({ kind: 'error', text: 'boom from fake claude' });
  });

  it('does not start when the plan has nothing left to fix, and starts nothing', async () => {
    write(project, `.lantern/plans/${FILE}`, fixtureText(EXAMPLE));
    expect(await run().finished).toEqual({ kind: 'error', text: say(VIEW.FIX_NOTHING, { file: WHERE }) });
    expect(fake.calls()).toEqual([]);
  });

  it('does not start for a name that could widen the tool list', async () => {
    expect(await run({ target: 'a*.plan' }).finished).toEqual({ kind: 'error', text: say(VIEW.FIX_BAD_TARGET, { file: 'a*.plan' }) });
    expect(fake.calls()).toEqual([]);
  });

  it('does not start without the lantern-plan skill in the project', async () => {
    fs.rmSync(path.join(project, '.claude', 'skills'), { recursive: true });
    expect(await run().finished).toMatchObject({ kind: 'error', text: expect.stringContaining('lantern-plan skill is not linked') });
    expect(fake.calls()).toEqual([]);
  });

  it('is refused for Codex, whose sandbox cannot be narrowed to one file', async () => {
    expect(await run({ provider: 'codex' }).finished).toEqual({ kind: 'error', text: say(VIEW.FIX_CODEX) });
    expect(fake.calls()).toEqual([]);
  });

  it('does not start a second run while one is going', async () => {
    vi.stubEnv('FAKE_CLAUDE_MODE', 'hang');
    expect(agent.start({ project, kind: 'plan-fix', target: FILE, onEvent: () => undefined }).ok).toBe(true);
    expect(await run().finished).toEqual({ kind: 'error', text: 'already running' });
  });
});
