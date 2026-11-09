// @vitest-environment jsdom
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LanternMap, LanternNode, LanternPlanView, LanternRelation } from '../src/main/lantern';
import { parsePlanFile } from '../src/main/lantern-plan';
import { planView } from '../src/main/lantern-plan-view';
import { mountLanternView } from '../src/renderer/lib/lanternview';
import { areasPayload } from './helpers/lantern-macro-areas-payload';
import { macroFixtureBlocks, macroFixtureRecords } from './helpers/lantern-macro-fixture';
import { mapOf, node } from './helpers/lantern-map';

const S1_FILES = ['src/main/lantern-prs.ts', 'src/main/lantern.ts', 'src/main/main.ts'];
const NEW_FILE = 'src/main/lantern-plans.ts';
const PLAN_TEXT = fs.readFileSync(path.join(__dirname, 'fixtures', 'lantern-plans', 'plan-on-the-map.plan'), 'utf8');

const records = macroFixtureRecords();
const role = records[0].role;
const nodes = [...records.map((r): LanternNode => node(r.path, r.role, { feature: r.feature })), ...S1_FILES.map((file) => node(file, role, { feature: 'pull-requests' }))];
const relations = records.flatMap((r): LanternRelation[] => r.relations.map((x) => ({ from: r.path, arrow: x.arrow, to: x.to, ext: x.ext, symbol: null, label: '' })));
const blockByPath = { ...macroFixtureBlocks(), 'src/main/lantern-prs.ts': 'pull-requests', 'src/main/lantern.ts': 'lantern-map', 'src/main/main.ts': 'projects-hub' };
const loaded = { ...areasPayload(), blockByPath };

const neighboursOf = (named: string[]) => [...new Set(relations.flatMap((r) => (r.to && named.includes(r.from) && !named.includes(r.to) ? [r.to] : r.to && named.includes(r.to) && !named.includes(r.from) ? [r.from] : [])))].filter((path) => nodes.some((n) => n.path === path));

function plan(): LanternPlanView {
  const parsed = parsePlanFile(PLAN_TEXT, 'plan-on-the-map.plan');
  if (!parsed.plan) throw new Error(parsed.error ?? 'plan');
  return planView(parsed.plan, [], parsed.problems);
}

const map = (plans: LanternPlanView[]): LanternMap => mapOf({ project: 'demo', nodes, relations, plans });
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
let opened = 0;
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

async function open() {
  const root = document.createElement('div');
  document.body.appendChild(root);
  mounted.push(mountLanternView(root, map([plan()]), { project: `planning-test-${++opened}`, readMacro: () => Promise.resolve(loaded) }));
  await flush();
  return root;
}

const click = (root: HTMLElement, selector: string) => (root.querySelector(selector) as HTMLButtonElement).click();
const planPane = (root: HTMLElement) => root.querySelector('.lt-grid > .lt-planpane') as HTMLElement;
const macroRoot = (root: HTMLElement) => root.querySelector('.lt-macroview-host .lt-macroview');
const lit = (root: HTMLElement) => [...(macroRoot(root)?.querySelectorAll('.mv-item.is-lit') ?? [])].map((item) => item.getAttribute('data-key')).sort();
const hitFiles = (root: HTMLElement) => [...root.querySelectorAll<HTMLButtonElement>('.lt-pixi-node-access.pr-hit')].map((button) => button.dataset.tip.split(' — ')[0]).sort();
const view = (root: HTMLElement, name: string) => root.querySelector<HTMLButtonElement>(`.lt-viewbar [data-view="${name}"]`);

async function planning() {
  const root = await open();
  click(root, '.lt-plans [data-plan="plan-on-the-map"]');
  await flush();
  return root;
}

describe('the Planning view', () => {
  it('is a top-level view that fills the workspace, with the plan on the left and nothing else with it', async () => {
    const root = await planning();
    const grid = root.querySelector('.lt-grid') as HTMLElement;
    expect(grid.classList.contains('lt-planning')).toBe(true);
    expect(planPane(root).hidden).toBe(false);
    expect(planPane(root).parentElement).toBe(grid);
    expect([...planPane(root).children].map((child) => child.className)).toEqual(['pl-panel']);
    expect([...planPane(root).querySelectorAll('.pl-stage')].map((stage) => stage.getAttribute('data-stage'))).toEqual(['s1', 's2']);
    expect(planPane(root).querySelector('.pr-panel, .pr-head, .search, .stats')).toBeNull();
    expect(root.querySelector('.lt-side:not(.lt-overview)')?.innerHTML).toBe('');
    expect(root.querySelector('.lt-side .pl-panel')).toBeNull();
    expect(grid.contains(root.querySelector('.lt-main'))).toBe(true);
  });

  it('shows Macro or Files on the right and the switch changes it, remembering the choice', async () => {
    const root = await planning();
    expect(macroRoot(root)).not.toBeNull();
    view(root, 'files')!.click();
    await flush();
    expect(macroRoot(root)).toBeNull();
    expect(planPane(root).hidden).toBe(false);

    click(root, '[data-plan-close]');
    await flush();
    click(root, '.lt-plans [data-plan="plan-on-the-map"]');
    await flush();
    expect(macroRoot(root)).toBeNull();
    view(root, 'macro')!.click();
    await flush();
    expect(macroRoot(root)).not.toBeNull();
  });

  it('marks exactly the files and features of stage s1 in Macro, and its files in Files', async () => {
    const root = await planning();
    click(root, '[data-plan-stage="s1"]');
    await flush();
    expect(lit(root)).toEqual(['block:lantern-map', 'block:project-map', 'block:projects-hub', 'block:pull-request-review', 'block:pull-requests', 'block:workspace-setup']);

    view(root, 'files')!.click();
    await flush();
    expect(hitFiles(root)).toEqual([...S1_FILES, NEW_FILE, ...neighboursOf(S1_FILES)].sort());

    click(root, '[data-plan-stage="s2"]');
    await flush();
    expect(hitFiles(root)).toEqual([]);

    view(root, 'macro')!.click();
    await flush();
    click(root, '[data-plan-clear]');
    await flush();
    expect(lit(root)).toEqual([]);
  });

  it('leaves to the view the person came from, and the side pane holds no plan panel at any point', async () => {
    const root = await open();
    expect(macroRoot(root)).toBeNull();
    click(root, '.lt-plans [data-plan="plan-on-the-map"]');
    await flush();
    click(root, '[data-plan-close]');
    await flush();
    expect(macroRoot(root)).toBeNull();
    expect(planPane(root).hidden).toBe(true);
    expect(root.querySelector('.lt-side .pl-panel')).toBeNull();
    expect(root.querySelector('.lt-grid')!.classList.contains('lt-planning')).toBe(false);
  });

  it('keeps the overview drawer working beside the plan', async () => {
    const root = await planning();
    click(root, '.lt-viewbar [data-overview]');
    await flush();
    const drawer = root.querySelector('.lt-overview') as HTMLElement;
    expect(drawer.hidden).toBe(false);
    expect(planPane(root).querySelector('.pl-panel')).not.toBeNull();
  });
});

const press = (target: HTMLElement, key: string, init: KeyboardEventInit = {}) => target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }));
const pointer = (target: HTMLElement, type: string, clientX: number) => target.dispatchEvent(new MouseEvent(type, { clientX, bubbles: true, cancelable: true }));

describe('the divider between the plan and the map', () => {
  async function resizable(width = 1200) {
    const root = await open();
    const grid = root.querySelector('.lt-grid') as HTMLElement;
    Object.defineProperty(grid, 'clientWidth', { configurable: true, value: width });
    click(root, '.lt-plans [data-plan="plan-on-the-map"]');
    await flush();
    const handle = root.querySelector('.lt-grid > .lt-plansplit') as HTMLElement;
    const column = () => grid.style.getPropertyValue('--lt-plan-col');
    return { root, grid, handle, column };
  }

  it('is a focusable vertical separator between the plan and the map, only while a plan is open', async () => {
    const { root, handle } = await resizable();
    expect(handle.classList.contains('lt-split')).toBe(true);
    expect(handle.getAttribute('role')).toBe('separator');
    expect(handle.getAttribute('aria-orientation')).toBe('vertical');
    expect(handle.getAttribute('aria-label')).toBe('Resize the plan and the map');
    expect(handle.tabIndex).toBe(0);
    expect(handle.getAttribute('aria-valuemin')).toBe('320');
    expect(handle.getAttribute('aria-valuemax')).toBe(String(1200 - 6 - 300));
    expect(handle.previousElementSibling).toBe(planPane(root));

    click(root, '[data-plan-close]');
    await flush();
    expect(root.querySelector('.lt-plansplit')).toBeNull();
  });

  it('follows a pointer drag, never past the minimum plan or the minimum map, and stops on release', async () => {
    const { handle, column } = await resizable();
    vi.spyOn(planPane(handle.parentElement!.parentElement as HTMLElement), 'getBoundingClientRect').mockReturnValue({ width: 500 } as DOMRect);

    pointer(handle, 'pointerdown', 500);
    pointer(handle, 'pointermove', 560);
    expect(column()).toBe('560px');
    pointer(handle, 'pointermove', 10);
    expect(column()).toBe('320px');
    pointer(handle, 'pointermove', 5000);
    expect(column()).toBe(`${1200 - 6 - 300}px`);
    pointer(handle, 'pointerup', 5000);
    pointer(handle, 'pointermove', 600);
    expect(column()).toBe(`${1200 - 6 - 300}px`);
  });

  it('moves with the arrow keys, further with Shift, and jumps with Home and End', async () => {
    const { handle, column } = await resizable();
    press(handle, 'Home');
    expect(column()).toBe('320px');
    press(handle, 'ArrowRight');
    expect(column()).toBe('336px');
    press(handle, 'ArrowRight', { shiftKey: true });
    expect(column()).toBe('400px');
    press(handle, 'ArrowLeft');
    expect(column()).toBe('384px');
    press(handle, 'End');
    expect(column()).toBe(`${1200 - 6 - 300}px`);
    press(handle, 'a');
    expect(column()).toBe(`${1200 - 6 - 300}px`);
  });

  it('remembers the width for the session when the plan is left and opened again', async () => {
    const { root, grid, column } = await resizable();
    press(root.querySelector('.lt-plansplit') as HTMLElement, 'Home');
    press(root.querySelector('.lt-plansplit') as HTMLElement, 'ArrowRight', { shiftKey: true });
    expect(column()).toBe('384px');

    click(root, '[data-plan-close]');
    await flush();
    expect(grid.style.getPropertyValue('--lt-plan-col')).toBe('');
    click(root, '.lt-plans [data-plan="plan-on-the-map"]');
    await flush();
    expect(column()).toBe('384px');
    expect(root.querySelector('.lt-plansplit')!.getAttribute('aria-valuenow')).toBe('384');
  });
});
