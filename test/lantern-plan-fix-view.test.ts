// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LanternMap, LanternNode, LanternPlanView, LanternRelation } from '../src/main/lantern';
import { parsePlanFile } from '../src/main/lantern-plan';
import { planView } from '../src/main/lantern-plan-view';
import { planFixText } from '../src/shared/lantern-plan-fix';
import { createPlanFix } from '../src/renderer/lib/lanternplanfix';
import type { FixHandlers, FixRunner, PlanFix } from '../src/renderer/lib/lanternplanfix';
import { mountLanternView } from '../src/renderer/lib/lanternview';
import { areasPayload } from './helpers/lantern-macro-areas-payload';
import { macroFixtureBlocks, macroFixtureRecords } from './helpers/lantern-macro-fixture';
import { mapOf, node } from './helpers/lantern-map';
import { EXAMPLE, fixtureText } from './helpers/lantern-plan-world';

const FILE = `${EXAMPLE}.plan`;
const WITH_PROBLEMS = `${fixtureText(EXAMPLE)}not a plan line\n#touch kind\n`;
const S1_FILES = ['src/main/lantern-prs.ts', 'src/main/lantern.ts', 'src/main/main.ts'];

const records = macroFixtureRecords();
const role = records[0].role;
const nodes = [...records.map((r): LanternNode => node(r.path, r.role, { feature: r.feature })), ...S1_FILES.map((file) => node(file, role, { feature: 'pull-requests' }))];
const relations = records.flatMap((r): LanternRelation[] => r.relations.map((x) => ({ from: r.path, arrow: x.arrow, to: x.to, ext: x.ext, symbol: null, label: '' })));
const blockByPath = { ...macroFixtureBlocks(), 'src/main/lantern-prs.ts': 'pull-requests', 'src/main/lantern.ts': 'lantern-map', 'src/main/main.ts': 'projects-hub' };
const loaded = { ...areasPayload(), blockByPath };

function plan(text: string): LanternPlanView {
  const parsed = parsePlanFile(text, FILE);
  if (!parsed.plan) throw new Error(parsed.error ?? 'plan');
  return planView(parsed.plan, [], parsed.problems);
}

interface Runner extends FixRunner {
  started: Array<{ file: string; handlers: FixHandlers }>;
  cancels: number;
  isBusy: boolean;
}

function makeRunner(): Runner {
  const runner: Runner = {
    started: [],
    cancels: 0,
    isBusy: false,
    busy: () => runner.isBusy,
    start: (file, handlers) => void runner.started.push({ file, handlers }),
    cancel: () => void runner.cancels++,
  };
  return runner;
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
let opened = 0;
const mounted: ReturnType<typeof mountLanternView>[] = [];
const copies: string[] = [];
let copyFails = false;
const copy = (text: string) => {
  copies.push(text);
  return copyFails ? Promise.reject(new Error('denied')) : Promise.resolve();
};

beforeEach(() => {
  copies.length = 0;
  copyFails = false;
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function (this: HTMLElement) {
    return this.classList.contains('lt-macroview') ? 700 : 0;
  });
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(function (this: HTMLElement) {
    return this.classList.contains('lt-macroview') ? 880 : 0;
  });
  window.matchMedia = ((query: string) => ({ matches: query.includes('reduce'), media: query, addEventListener: () => undefined, removeEventListener: () => undefined })) as never;
});

afterEach(() => {
  mounted.splice(0).forEach((one) => { one.dispose(); });
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

const mapWith = (text: string) => mapOf({ project: 'demo', nodes, relations, plans: [plan(text)] });

async function planning(text: string, fix: PlanFix | undefined) {
  const root = document.createElement('div');
  document.body.appendChild(root);
  const view = mountLanternView(root, mapWith(text), { project: `fix-test-${++opened}`, readMacro: () => Promise.resolve(loaded), copy, planFix: fix });
  mounted.push(view);
  await flush();
  (root.querySelector('.lt-plans [data-plan="plan-on-the-map"]') as HTMLButtonElement).click();
  await flush();
  return { root, view };
}

const note = (root: ParentNode) => root.querySelector<HTMLElement>('.lt-planpane .pl-problems');
const copyButton = (root: ParentNode) => root.querySelector<HTMLButtonElement>('.pl-problems [data-plan-fix-copy]');
const runButton = (root: ParentNode) => root.querySelector<HTMLButtonElement>('.pl-problems [data-plan-fix-run]');
const status = (root: ParentNode) => root.querySelector('.pl-problems .pl-fixstate')?.textContent;

describe('the problems of a plan that loaded are listed in the plan panel', () => {
  it('lists every problem under a count, not only in a tooltip', async () => {
    const { root } = await planning(WITH_PROBLEMS, createPlanFix({ copy, runner: makeRunner() }));
    expect(note(root)?.querySelector('.pl-fold')?.textContent).toBe('2 lines of this plan file could not be read.');
    expect([...root.querySelectorAll('.pl-problems .pl-problem-list li')].map((li) => li.textContent)).toEqual([
      'line 66: not a plan line (every line is "#tag ..."), got "not a plan line"',
      'line 67: #touch unknown kind "kind" (known: area, feature, file, new)',
    ]);
    expect(note(root)?.hasAttribute('title')).toBe(false);
  });

  it('folds and unfolds the list', async () => {
    const { root } = await planning(WITH_PROBLEMS, createPlanFix({ copy }));
    const fold = () => note(root)!.querySelector<HTMLButtonElement>('.pl-fold')!;
    const body = () => note(root)!.querySelector<HTMLElement>('.pl-sec-body')!;
    expect(fold().getAttribute('aria-expanded')).toBe('true');
    expect(body().hidden).toBe(false);
    fold().click();
    expect(fold().getAttribute('aria-expanded')).toBe('false');
    expect(body().hidden).toBe(true);
    fold().click();
    expect(body().hidden).toBe(false);
  });

  it('shows no note for a plan without problems', async () => {
    const { root } = await planning(fixtureText(EXAMPLE), createPlanFix({ copy, runner: makeRunner() }));
    expect(note(root)).toBeNull();
  });
});

describe('Copy for the agent, in the plan panel', () => {
  it('is offered beside Fix with an agent, and copies the prepared text', async () => {
    const { root } = await planning(WITH_PROBLEMS, createPlanFix({ copy, runner: makeRunner() }));
    expect(copyButton(root)?.textContent).toBe('Copy for the agent');
    expect(runButton(root)?.textContent).toBe('Fix with an agent');
    expect(copyButton(root)?.classList.contains('lt-cm-pill')).toBe(true);
    copyButton(root)!.click();
    await flush();
    expect(copies).toEqual([planFixText({ file: FILE, problems: plan(WITH_PROBLEMS).problems, error: null })]);
    expect(copyButton(root)?.textContent).toBe('Copied');
  });

  it('says so when the clipboard refuses', async () => {
    const { root } = await planning(WITH_PROBLEMS, createPlanFix({ copy }));
    copyFails = true;
    copyButton(root)!.click();
    await flush();
    expect(status(root)).toBe('Could not copy');
    expect(copyButton(root)?.textContent).toBe('Copy for the agent');
  });

  it('is the only action when no agent can be started', async () => {
    const { root } = await planning(WITH_PROBLEMS, createPlanFix({ copy }));
    expect(copyButton(root)).not.toBeNull();
    expect(runButton(root)).toBeNull();
  });
});

describe('Fix with an agent, in the plan panel', () => {
  it('starts the agent on this plan file and shows it running', async () => {
    const runner = makeRunner();
    const { root } = await planning(WITH_PROBLEMS, createPlanFix({ copy, runner }));
    runButton(root)!.click();
    expect(runner.started.map((one) => one.file)).toEqual([FILE]);
    expect(status(root)).toBe('The agent is fixing this plan.');
    expect(runButton(root)?.textContent).toBe('Cancel the agent');
  });

  it('cancels the run it started', async () => {
    const runner = makeRunner();
    const { root } = await planning(WITH_PROBLEMS, createPlanFix({ copy, runner }));
    runButton(root)!.click();
    runButton(root)!.click();
    expect(runner.cancels).toBe(1);
    expect(runner.started).toHaveLength(1);
    runner.started[0].handlers.cancelled();
    expect(status(root)).toBe('The agent was cancelled.');
    expect(runButton(root)?.textContent).toBe('Fix with an agent');
  });

  it('says it is done when the agent finishes, and the problems it left stay listed', async () => {
    const runner = makeRunner();
    const { root } = await planning(WITH_PROBLEMS, createPlanFix({ copy, runner }));
    runButton(root)!.click();
    runner.started[0].handlers.done(true, 0);
    expect(status(root)).toBe('The agent finished and the plan was reloaded. Anything still listed here is still wrong.');
    expect(root.querySelectorAll('.pl-problems .pl-problem-list li')).toHaveLength(2);
  });

  it('drops the note and the state once the reloaded plan has no problems', async () => {
    const runner = makeRunner();
    const fix = createPlanFix({ copy, runner });
    const { root, view } = await planning(WITH_PROBLEMS, fix);
    runButton(root)!.click();
    runner.started[0].handlers.done(true, 0);
    view.update(mapWith(fixtureText(EXAMPLE)));
    await flush();
    expect(note(root)).toBeNull();
    expect(fix.state(FILE).phase).toBe('idle');
  });

  it('shows the failure: the agent failed, was stopped by denials, did not finish, or another run is going', async () => {
    const runner = makeRunner();
    const { root } = await planning(WITH_PROBLEMS, createPlanFix({ copy, runner }));
    runButton(root)!.click();
    runner.started[0].handlers.fail('Claude CLI not found.');
    expect(status(root)).toBe('The agent could not fix this plan: Claude CLI not found.');
    expect(root.querySelector('.pl-problems .pl-fix-failed')).not.toBeNull();

    runButton(root)!.click();
    runner.started[1].handlers.done(false, 3);
    expect(status(root)).toBe('The agent was stopped by 3 permission denials.');

    runButton(root)!.click();
    runner.started[2].handlers.done(false, 0);
    expect(status(root)).toBe('The agent did not finish its run.');

    runner.isBusy = true;
    runButton(root)!.click();
    expect(status(root)).toBe('Another agent run is in progress. Try again when it ends.');
    expect(runner.started).toHaveLength(3);
  });
});
