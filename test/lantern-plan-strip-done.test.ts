// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LanternMap, LanternNode, LanternPlanView, LanternPr, LanternRelation } from '../src/main/lantern';
import { parsePlanFile } from '../src/main/lantern-plan';
import { planView } from '../src/main/lantern-plan-view';
import type { MacroLoad } from '../src/main/lantern-macro-load';
import { mountLanternView } from '../src/renderer/lib/lanternview';
import { areasPayload } from './helpers/lantern-macro-areas-payload';
import { macroFixtureRecords } from './helpers/lantern-macro-fixture';
import { mapOf, node, pr } from './helpers/lantern-map';

const planText = (slug: string, title: string) =>
  [
    'lantern-plan 1',
    `# ${slug}`,
    `#title ${title}`,
    '#opened 2026-10-26',
    '#goal Plans are read and drawn.',
    '#scope-in The stage view.',
    '#scope-out Editing a plan.',
    '#impact feature notifications Because the plan lights a feature.',
    '#stage s1 Read the plans',
    '#item s1.1 Load the plans',
    '#touch file src/main/lantern-git.ts',
    '#accept The plans load.',
    '#stage s2 Draw the plans',
    '#item s2.1 Mark the stage',
    '#touch feature notifications',
    '#accept The stage is marked.',
    '#approved goal jun 2026-10-26 000000000000',
  ].join('\n');

const records = macroFixtureRecords();
const nodes = records.map((r): LanternNode => node(r.path, r.role, { feature: r.feature }));
const relations = records.flatMap((r): LanternRelation[] => r.relations.map((x) => ({ from: r.path, arrow: x.arrow, to: x.to, ext: x.ext, symbol: null, label: '' })));

const merged = (slug: string, item: string) => pr(`${slug}-${item}`, { title: item, state: 'merged', plans: [{ slug, item }] });
const open1 = pr('50', { title: 'Load', state: 'open', plans: [{ slug: 'running', item: 's1.1' }] });

function viewOf(slug: string, title: string, prs: LanternPr[]): LanternPlanView {
  const parsed = parsePlanFile(`${planText(slug, title)}\n`, `${slug}.plan`);
  if (!parsed.plan) throw new Error(parsed.error ?? 'plan');
  return planView(parsed.plan, prs, parsed.problems);
}

const running = () => viewOf('running', 'Still going', [open1]);
const shipped = (slug = 'shipped', title = 'Ship the plans') => viewOf(slug, title, [merged(slug, 's1.1'), merged(slug, 's2.1')]);
const allPrs = (...slugs: string[]) => slugs.flatMap((slug) => [merged(slug, 's1.1'), merged(slug, 's2.1')]);

const withPlans = (plans: LanternPlanView[], prs: LanternPr[]): LanternMap => mapOf({ project: 'demo', nodes, relations, prs, plans });
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

async function open(map: LanternMap, loaded: MacroLoad = areasPayload()) {
  const root = document.createElement('div');
  document.body.appendChild(root);
  mounted.push(mountLanternView(root, map, { readMacro: () => Promise.resolve(loaded) }));
  await flush();
  return root;
}

const strip = (root: HTMLElement) => root.querySelector('.lt-plans') as HTMLElement;
const inStrip = (root: HTMLElement) => [...strip(root).querySelectorAll('.pr-chips [data-plan]')].map((c) => c.getAttribute('data-plan'));
const control = (root: HTMLElement) => strip(root).querySelector('.pl-list-done') as HTMLButtonElement;
const listed = (root: HTMLElement) => [...strip(root).querySelectorAll('.pl-list-done-pop [data-plan]')].map((c) => c.getAttribute('data-plan'));
const panel = (root: HTMLElement) => root.querySelector('.lt-planpane .pl-panel') as HTMLElement | null;

const going = (count: number) => Array.from({ length: count }, (_, at) => viewOf(`going-${at + 1}`, `Going ${at + 1}`, []));
const more = (root: HTMLElement) => strip(root).querySelector('.pl-list-more') as HTMLButtonElement;
const inMore = (root: HTMLElement) => [...strip(root).querySelectorAll('.pl-list-more-pop [data-plan]')].map((c) => c.getAttribute('data-plan'));

describe('the plans in progress in the strip', () => {
  it('shows five chips and puts the rest behind a More control placed before Done', async () => {
    const root = await open(withPlans([...going(7), shipped()], allPrs('shipped')));
    expect(inStrip(root)).toEqual(['going-1', 'going-2', 'going-3', 'going-4', 'going-5']);
    expect(more(root).hidden).toBe(false);
    expect(more(root).textContent).toBe('More 2');
    expect(more(root).nextElementSibling?.nextElementSibling).toBe(control(root));
  });

  it('lists the other plans in the More list and opens a picked one', async () => {
    const root = await open(withPlans(going(7), []));
    more(root).click();
    expect(more(root).getAttribute('aria-expanded')).toBe('true');
    expect(inMore(root)).toEqual(['going-6', 'going-7']);
    (strip(root).querySelector('.pl-list-more-pop [data-plan="going-7"]') as HTMLButtonElement).click();
    await flush();
    expect(panel(root)).not.toBeNull();
    expect(more(root).getAttribute('aria-expanded')).toBe('false');
    expect(more(root).getAttribute('aria-pressed')).toBe('true');
  });

  it('keeps More unpressed while the selected plan is one of the chips', async () => {
    const root = await open(withPlans(going(7), []));
    (strip(root).querySelector('.pr-chips [data-plan="going-1"]') as HTMLButtonElement).click();
    await flush();
    expect(more(root).getAttribute('aria-pressed')).toBe('false');
  });

  it('shows no More control with five plans in progress', async () => {
    const root = await open(withPlans(going(5), []));
    expect(inStrip(root)).toHaveLength(5);
    expect(more(root).hidden).toBe(true);
  });
});

describe('the finished plans in the strip', () => {
  it('keeps a finished plan out of the strip and counts it in one control', async () => {
    const view = shipped();
    expect(view.finished).toBe(view.total);
    const root = await open(withPlans([running(), view], [open1, ...allPrs('shipped')]));
    expect(inStrip(root)).toEqual(['running']);
    expect(control(root).hidden).toBe(false);
    expect(control(root).textContent).toBe('Done 1');
  });

  it('shows no control when no plan is finished', async () => {
    const root = await open(withPlans([running()], [open1]));
    expect(inStrip(root)).toEqual(['running']);
    expect(control(root).hidden).toBe(true);
  });

  it('shows just the control when every plan is finished', async () => {
    const root = await open(withPlans([shipped(), shipped('later', 'Ship later')], allPrs('shipped', 'later')));
    expect(strip(root).hidden).toBe(false);
    expect(inStrip(root)).toEqual([]);
    expect(control(root).textContent).toBe('Done 2');
  });

  it('lists the finished plans with name, approval and count, and closes on Escape', async () => {
    const root = await open(withPlans([running(), shipped(), shipped('later', 'Ship later')], [open1, ...allPrs('shipped', 'later')]));
    control(root).click();
    expect(control(root).getAttribute('aria-expanded')).toBe('true');
    expect(listed(root)).toEqual(['shipped', 'later']);
    const first = strip(root).querySelector('.pl-list-done-pop [data-plan="shipped"]') as HTMLElement;
    expect(first.textContent).toContain('Ship the plans');
    expect(first.textContent).toContain('stale');
    expect(first.textContent).toContain('2/2');
    expect(document.activeElement).toBe(first);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(control(root).getAttribute('aria-expanded')).toBe('false');
  });

  it('closes on a press outside', async () => {
    const root = await open(withPlans([running(), shipped()], [open1, ...allPrs('shipped')]));
    control(root).click();
    document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(control(root).getAttribute('aria-expanded')).toBe('false');
  });

  it('opens a picked finished plan in the Planning view', async () => {
    const root = await open(withPlans([running(), shipped()], [open1, ...allPrs('shipped')]));
    control(root).click();
    (strip(root).querySelector('.pl-list-done-pop [data-plan="shipped"]') as HTMLButtonElement).click();
    await flush();
    expect(panel(root)).not.toBeNull();
    expect(control(root).getAttribute('aria-expanded')).toBe('false');
    expect(strip(root).querySelector('.pl-list-done-pop [data-plan="shipped"]')?.getAttribute('aria-pressed')).toBe('true');
  });
});
