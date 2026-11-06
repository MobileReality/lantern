// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LanternMap, LanternNode, LanternPlanView, LanternPr, LanternRelation } from '../src/main/lantern';
import { parsePlanFile } from '../src/main/lantern-plan';
import { planView } from '../src/main/lantern-plan-view';
import type { MacroLoad } from '../src/main/lantern-macro-load';
import { mountLanternView } from '../src/renderer/lib/lanternview';
import { macroGraph } from '../src/renderer/lib/lanternmacro';
import { areasPayload } from './helpers/lantern-macro-areas-payload';
import { macroFixtureBlocks, macroFixtureRecords, macroFixtureView, repoFeatureTexts } from './helpers/lantern-macro-fixture';
import { mapOf, node, pr } from './helpers/lantern-map';

const PLAN = [
  'lantern-plan 1',
  '# demo',
  '#title Show the plans in the app',
  '#opened 2026-10-26',
  '#goal Plans are read and drawn.',
  '#scope-in The stage view.',
  '#scope-out Editing a plan.',
  '#impact feature notifications Because the plan lights a feature.',
  '#impact file src/main/lantern-git.ts Because it reads the pull requests.',
  '#stage s1 Read the plans',
  '#item s1.1 Load the plans',
  '#touch file src/main/lantern-git.ts',
  '#accept The plans load.',
  '#stage s2 Draw the plans',
  '#item s2.1 Mark the stage',
  '#touch feature notifications',
  '#accept The stage is marked.',
  '#question s2.q1 Where does the view sit?',
  '#approved goal jun 2026-10-26 000000000000',
].join('\n');

const records = macroFixtureRecords();
const nodes = records.map((r): LanternNode => node(r.path, r.role, { feature: r.feature }));
const relations = records.flatMap((r): LanternRelation[] => r.relations.map((x) => ({ from: r.path, arrow: x.arrow, to: x.to, ext: x.ext, symbol: null, label: '' })));
const ticking = pr('50', { title: 'Load the plans', state: 'open', plans: [{ slug: 'demo', item: 's1.1' }] });

function planFrom(text: string, prs: LanternPr[] = [ticking]): LanternPlanView {
  const parsed = parsePlanFile(`${text}\n`, 'demo.plan');
  if (!parsed.plan) throw new Error(parsed.error ?? 'plan');
  return planView(parsed.plan, prs, parsed.problems);
}

const withPlans = (plans: LanternPlanView[], prs: LanternPr[] = [ticking]): LanternMap => mapOf({ project: 'demo', nodes, relations, prs, plans });

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const mounted: ReturnType<typeof mountLanternView>[] = [];

beforeEach(() => {
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

async function open(map: LanternMap, loaded: MacroLoad = areasPayload(), withMacro = true) {
  const root = document.createElement('div');
  document.body.appendChild(root);
  mounted.push(mountLanternView(root, map, withMacro ? { readMacro: () => Promise.resolve(loaded) } : {}));
  await flush();
  return root;
}

const strip = (root: HTMLElement) => root.querySelector('.lt-plans') as HTMLElement;
const chip = (root: HTMLElement) => root.querySelector('.lt-plans [data-plan="demo"]') as HTMLButtonElement;
const panel = (root: HTMLElement) => root.querySelector('.lt-planpane .pl-panel') as HTMLElement | null;
const press = (root: HTMLElement, selector: string) => (root.querySelector(selector) as HTMLButtonElement).click();
const macroRoot = (root: HTMLElement) => root.querySelector('.lt-macroview-host .lt-macroview') as HTMLElement;
const lit = (root: HTMLElement) => [...macroRoot(root).querySelectorAll('.mv-item.is-lit')].map((item) => item.getAttribute('data-key')).sort();

describe('the entry point', () => {
  it('shows nothing when the project has no plans', async () => {
    const root = await open(withPlans([]));
    expect(strip(root).hidden).toBe(true);
    expect(strip(root).textContent).toBe('');
  });

  it('shows one chip per plan, with its state and how far it is', async () => {
    const root = await open(withPlans([planFrom(PLAN)]));
    expect(strip(root).hidden).toBe(false);
    expect(strip(root).getAttribute('aria-label')).toBe('Plans');
    expect(chip(root).textContent).toContain('Show the plans in the app');
    expect(chip(root).textContent).toContain('stale');
    expect(chip(root).textContent).toContain('0/2');
    expect(chip(root).getAttribute('aria-pressed')).toBe('false');
  });
});

describe('the stage view', () => {
  it('opens as the Planning view beside the Macro view with the stages in order, items, status, questions and approval marks', async () => {
    const root = await open(withPlans([planFrom(PLAN)]));
    chip(root).click();
    await flush();

    expect(chip(root).getAttribute('aria-pressed')).toBe('true');
    expect(macroRoot(root)).not.toBeNull();
    const view = panel(root)!;
    expect(view).not.toBeNull();
    expect([...view.querySelectorAll('.pl-stage')].map((stage) => stage.getAttribute('data-stage'))).toEqual(['s1', 's2']);
    expect([...view.querySelectorAll('.pl-item .pl-pick')].map((pick) => pick.getAttribute('data-plan-item'))).toEqual(['s1.1', 's2.1']);
    expect(view.querySelector('[data-stage="s1"] .pl-status')?.textContent).toBe('in progress');
    expect(view.querySelector('[data-stage="s2"] .pl-status')?.textContent).toBe('planned');
    expect(view.querySelector('[data-stage="s2"]')?.classList.contains('pl-blocked')).toBe(true);
    expect(view.querySelector('[data-stage="s1"]')?.classList.contains('pl-blocked')).toBe(false);
    expect(view.querySelector('[data-stage="s2"] .pl-unanswered')?.textContent).toContain('Where does the view sit?');
    expect(view.querySelector('[data-stage="s2"] header .pl-flag')?.textContent).toBe('blocked');
    expect(view.querySelector('[data-stage="s1"] header .pl-state')?.textContent).toBe('pending');
    expect(view.querySelector('.pl-approvals')?.textContent).toContain('Goal');
    expect(view.querySelector('.pl-edited')?.textContent).toContain('no longer holds');
    expect(view.querySelector('.pl-readonly')?.textContent).toContain('Read only');
  });

  it('links the pull request that ticks an item and opens it in Lantern', async () => {
    const root = await open(withPlans([planFrom(PLAN)]));
    chip(root).click();
    await flush();

    const link = panel(root)!.querySelector('[data-stage="s1"] [data-plan-pr="50"]') as HTMLButtonElement;
    expect(link.textContent).toBe('#50 open');
    link.click();
    await flush();
    expect(panel(root)).toBeNull();
    expect(chip(root).getAttribute('aria-pressed')).toBe('false');
    expect(root.querySelector('.lt-prs [data-pr="50"]')?.getAttribute('aria-pressed')).toBe('true');
  });

  it('does not link a pull request the strip no longer lists', async () => {
    const quiet = pr('51', { title: 'Old', state: 'closed', opened: '2020-01-01', plans: [{ slug: 'demo', item: 's2.1' }] });
    const root = await open(withPlans([planFrom(PLAN, [ticking, quiet])], [ticking, quiet]));
    chip(root).click();
    await flush();

    expect(panel(root)!.querySelector('[data-plan-pr="51"]')).toBeNull();
    expect(panel(root)!.querySelector('[data-stage="s2"] .pl-pr')?.textContent).toBe('#51 closed');
  });

  it('closes with its button and goes back to the view it came from', async () => {
    const root = await open(withPlans([planFrom(PLAN)]));
    chip(root).click();
    await flush();
    press(root, '[data-plan-close]');
    await flush();

    expect(panel(root)).toBeNull();
    expect(chip(root).getAttribute('aria-pressed')).toBe('false');
  });
});

describe('selecting a stage draws its impact on the Macro view', () => {
  it('lights what a stage names and nothing else, and clears again', async () => {
    const root = await open(withPlans([planFrom(PLAN)]));
    chip(root).click();
    await flush();
    expect(lit(root)).toEqual([]);

    press(root, '[data-plan-stage="s1"]');
    await flush();
    expect(lit(root)).toEqual(['block:pull-request-review', 'block:pull-requests']);
    expect(panel(root)!.querySelector('[data-plan-stage="s1"]')?.getAttribute('aria-pressed')).toBe('true');
    expect(panel(root)!.querySelector('.pl-pickrow')?.textContent).toContain('1 file');

    press(root, '[data-plan-stage="s2"]');
    await flush();
    expect(lit(root)).toEqual(['block:agent-sessions', 'block:notifications']);

    press(root, '[data-plan-clear]');
    await flush();
    expect(lit(root)).toEqual([]);
    expect(panel(root)!.querySelector('.pl-pickrow')).toBeNull();
  });

  it('lights only the item that is picked, and the plan impact for the plan as a whole', async () => {
    const root = await open(withPlans([planFrom(PLAN)]));
    chip(root).click();
    await flush();

    press(root, '[data-plan-item="s2.1"]');
    await flush();
    expect(lit(root)).toEqual(['block:agent-sessions', 'block:notifications']);

    press(root, '[data-plan-impact]');
    await flush();
    expect(lit(root)).toEqual(['block:agent-sessions', 'block:notifications', 'block:pull-request-review', 'block:pull-requests']);
  });

  it('says in the label of a lit block why it is lit', async () => {
    const root = await open(withPlans([planFrom(PLAN)]));
    chip(root).click();
    await flush();
    press(root, '[data-plan-stage="s1"]');
    await flush();

    const feature = macroRoot(root).querySelector('[data-key="block:pull-requests"]')!;
    expect(feature.getAttribute('aria-label')).toContain('named by the plan, stage s1');
    expect(macroRoot(root).querySelector('[data-key="block:notifications"]')?.getAttribute('aria-label')).not.toContain('named by the plan');
  });

  it('starts from the Files view by switching to the Macro view', async () => {
    const root = await open(withPlans([planFrom(PLAN)]));
    expect(macroRoot(root)).toBeNull();
    chip(root).click();
    await flush();
    expect(macroRoot(root)).not.toBeNull();
  });

  it('drops the marks when the plan stops existing after a reload', async () => {
    const root = await open(withPlans([planFrom(PLAN)]));
    chip(root).click();
    await flush();
    press(root, '[data-plan-stage="s1"]');
    await flush();
    mounted[0].update(withPlans([]));
    await flush();

    expect(strip(root).hidden).toBe(true);
    expect(panel(root)).toBeNull();
    expect(lit(root)).toEqual([]);
  });

  it('keeps the marks and the open stage through a reload that still has the plan', async () => {
    const root = await open(withPlans([planFrom(PLAN)]));
    chip(root).click();
    await flush();
    press(root, '[data-plan-stage="s1"]');
    await flush();
    mounted[0].update(withPlans([planFrom(PLAN)]));
    await flush();

    expect(lit(root)).toEqual(['block:pull-request-review', 'block:pull-requests']);
    expect(panel(root)!.querySelector('[data-plan-stage="s1"]')?.getAttribute('aria-pressed')).toBe('true');
  });
});

describe('a pick the right side cannot show', () => {
  it('opens on the Files view when the project has no Macro view, and marks the named files there', async () => {
    const root = await open(withPlans([planFrom(PLAN)]), areasPayload(), false);
    chip(root).click();
    await flush();
    press(root, '[data-plan-stage="s1"]');
    await flush();

    expect(panel(root)!.querySelector('.pl-pickrow')?.textContent).toContain('Marked on the right');
    expect(panel(root)!.querySelectorAll('.pl-stage')).toHaveLength(2);
  });

  it('says the Files view marks files only when a pick names none', async () => {
    const root = await open(withPlans([planFrom(PLAN)]), areasPayload(), false);
    chip(root).click();
    await flush();
    press(root, '[data-plan-stage="s2"]');
    await flush();

    expect(panel(root)!.querySelector('.pl-pickrow')?.textContent).toContain('marks files only');
    expect(panel(root)!.querySelector('.pl-pickrow')?.textContent).not.toContain('Switch to the Macro view');
  });

  it('says so when a stage names nothing, and dims nothing', async () => {
    const bare = PLAN.replace('#touch file src/main/lantern-git.ts\n', '').replace('#touch feature notifications\n', '');
    const root = await open(withPlans([planFrom(bare)]));
    chip(root).click();
    await flush();
    press(root, '[data-plan-stage="s1"]');
    await flush();

    expect(panel(root)!.querySelector('.pl-pickrow')?.textContent).toContain('names no area, feature or file');
    expect(macroRoot(root).classList.contains('is-dimmed')).toBe(false);
  });
});

describe('the flat Macro view of a map without areas', () => {
  const view = macroFixtureView();
  const flat: MacroLoad = { ok: true, view, texts: repoFeatureTexts(), blockByPath: macroFixtureBlocks(), minStrongEdge: 8 };
  const names = new Map(macroGraph(view).blocks.map((block) => [block.id, block.name]));
  const buttons = (root: HTMLElement) => [...root.querySelectorAll<HTMLButtonElement>('.lt-pixi-node-access')];
  const hits = (root: HTMLElement) => buttons(root).filter((button) => button.classList.contains('pr-hit')).map((button) => button.textContent);

  it('marks the block of a named file and counts the named files in it', async () => {
    const root = await open(withPlans([planFrom(PLAN)]), flat);
    chip(root).click();
    await flush();
    press(root, '[data-plan-stage="s1"]');
    await flush();

    expect(hits(root)).toEqual([names.get('pull-requests')]);
    const block = buttons(root).find((button) => button.textContent === names.get('pull-requests'))!;
    expect(block.getAttribute('aria-description')).toContain('named by the plan, stage s1: 1 of');
  });
});
