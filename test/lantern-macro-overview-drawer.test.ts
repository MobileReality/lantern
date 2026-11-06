// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LanternMap, LanternNode, LanternPlanView, LanternPr, LanternRelation } from '../src/main/lantern';
import { parsePlanFile } from '../src/main/lantern-plan';
import { planView } from '../src/main/lantern-plan-view';
import { mountLanternView } from '../src/renderer/lib/lanternview';
import { areasPayload } from './helpers/lantern-macro-areas-payload';
import { macroFixtureRecords, repoPrRecord } from './helpers/lantern-macro-fixture';
import { mapOf, node, pr } from './helpers/lantern-map';
import { macroViewRoot, sizeTheMacroViewPane } from './helpers/macroview-host';

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


const PR_ID = '108';
const record = repoPrRecord(PR_ID);
const changedFiles = record.files.map((f) => ({ ...f, mapped: nodes.some((n) => n.path === f.path) }));
const review = pr(PR_ID, { title: record.title, ordered: record.ordered, files: changedFiles });
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const mounted: ReturnType<typeof mountLanternView>[] = [];

beforeEach(() => sizeTheMacroViewPane({ w: 700, h: 880 }));

afterEach(() => {
  mounted.splice(0).forEach((one) => { one.dispose(); });
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

async function open(map: LanternMap, options: { pr?: string } = {}) {
  const root = document.createElement('div');
  document.body.appendChild(root);
  mounted.push(mountLanternView(root, map, { readMacro: () => Promise.resolve(areasPayload()), ...options }));
  await flush();
  return root;
}

const withPlan = (): LanternMap => mapOf({ project: 'demo', nodes, relations, prs: [ticking], plans: [planFrom(PLAN)] });
const withReview = (): LanternMap => mapOf({ project: 'demo', nodes, relations, prs: [review] });
const toggle = (root: HTMLElement) => root.querySelector<HTMLButtonElement>('.lt-viewbar [data-overview]') as HTMLButtonElement;
const drawer = (root: HTMLElement) => root.querySelector<HTMLElement>('.lt-overview') as HTMLElement;
const side = (root: HTMLElement) => root.querySelector<HTMLElement>('.lt-side:not(.lt-overview)') as HTMLElement;
const escape = (target: Element) => target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));

function boxes(root: HTMLElement) {
  const grid = root.querySelector('.lt-grid') as HTMLElement;
  const parts = [grid, side(root), root.querySelector('.lt-main'), root.querySelector('.lt-macroview-host'), macroViewRoot(root), root.querySelector('.lt-side-list'), root.querySelector('.pl-panel'), root.querySelector('.pr-head')];
  return parts.map((el) => (el ? { cls: el.className, style: el.getAttribute('style'), html: el.tagName === 'ASIDE' ? '' : el.querySelectorAll('*').length } : null));
}

describe('the overview is a drawer', () => {
  it('sits outside the side stack, behind a labelled control, and shows the project card', async () => {
    const root = await open(withPlan());
    (root.querySelector('.lt-plans [data-plan="demo"]') as HTMLButtonElement).click();
    await flush();

    expect(toggle(root).textContent).toBe('Overview');
    expect(toggle(root).getAttribute('aria-expanded')).toBe('false');
    expect(drawer(root).hidden).toBe(true);
    expect(side(root).contains(drawer(root))).toBe(false);
    expect(drawer(root).parentElement).toBe(root.querySelector('.lt-grid'));
    expect(side(root).querySelector('.stats, .chips, .lt-brand')).toBeNull();
    expect(root.querySelector('.lt-planpane .pl-panel')).not.toBeNull();
    expect(side(root).querySelector('.pl-panel')).toBeNull();

    toggle(root).click();
    expect(drawer(root).hidden).toBe(false);
    expect(drawer(root).querySelector('.lt-brand h1')?.textContent).toBe('demo');
    expect(drawer(root).querySelector('.stats')).not.toBeNull();
    expect(drawer(root).querySelector('.chips .chip')).not.toBeNull();
    expect(toggle(root).getAttribute('aria-expanded')).toBe('true');
    expect(toggle(root).textContent).toBe('Close overview');
  });

  it('leaves the plan panel and the Macro view exactly as they were while it opens and closes', async () => {
    const root = await open(withPlan());
    (root.querySelector('.lt-plans [data-plan="demo"]') as HTMLButtonElement).click();
    await flush();
    const closed = boxes(root);
    const planPanel = (root.querySelector('.pl-panel') as HTMLElement).outerHTML;

    toggle(root).click();
    expect(boxes(root)).toEqual(closed);
    expect((root.querySelector('.pl-panel') as HTMLElement).outerHTML).toBe(planPanel);

    toggle(root).click();
    expect(drawer(root).hidden).toBe(true);
    expect(boxes(root)).toEqual(closed);
  });

  it('leaves the pull request panel and the Macro view as they were in review', async () => {
    const root = await open(withReview(), { pr: PR_ID });
    (root.querySelector('.lt-viewbar [data-view="macro"]') as HTMLButtonElement).click();
    await flush();
    const closed = boxes(root);
    const list = (root.querySelector('.lt-side-list') as HTMLElement).outerHTML;

    expect(toggle(root)).not.toBeNull();
    expect(side(root).contains(drawer(root))).toBe(false);
    toggle(root).click();
    expect(drawer(root).hidden).toBe(false);
    expect(boxes(root)).toEqual(closed);
    expect((root.querySelector('.lt-side-list') as HTMLElement).outerHTML).toBe(list);
    expect(drawer(root).querySelector('.lt-prsum')).not.toBeNull();
  });

  it('gives the Macro view alone the whole width, with the drawer over it', async () => {
    const root = await open(mapOf({ project: 'demo', nodes, relations }));
    expect(root.querySelector('.lt-grid')?.classList.contains('lt-side-none')).toBe(false);
    (root.querySelector('.lt-viewbar [data-view="macro"]') as HTMLButtonElement).click();
    await flush();
    const closed = boxes(root);

    expect(root.querySelector('.lt-grid')?.classList.contains('lt-side-none')).toBe(true);
    toggle(root).click();
    expect(drawer(root).hidden).toBe(false);
    expect(boxes(root)).toEqual(closed);
  });

  it('closes with the control, the close button, Escape and a click outside', async () => {
    const root = await open(withPlan());
    (root.querySelector('.lt-plans [data-plan="demo"]') as HTMLButtonElement).click();
    await flush();
    const scrim = root.querySelector('.lt-overview-scrim') as HTMLElement;

    toggle(root).click();
    expect(scrim.hidden).toBe(false);
    toggle(root).click();
    expect(drawer(root).hidden).toBe(true);
    expect(scrim.hidden).toBe(true);

    toggle(root).click();
    escape(drawer(root));
    expect(drawer(root).hidden).toBe(true);
    expect(toggle(root).getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(toggle(root));
    expect(panelStillOpen(root)).toBe(true);

    toggle(root).click();
    scrim.click();
    expect(drawer(root).hidden).toBe(true);

    toggle(root).click();
    (drawer(root).querySelector('.lt-overview-close') as HTMLButtonElement).click();
    expect(drawer(root).hidden).toBe(true);
  });

  it('starts closed again in a fresh view and is gone outside the Macro view', async () => {
    const root = await open(withPlan());
    (root.querySelector('.lt-plans [data-plan="demo"]') as HTMLButtonElement).click();
    await flush();
    toggle(root).click();
    (root.querySelector('.lt-viewbar [data-view="files"]') as HTMLButtonElement).click();
    await flush();
    expect(drawer(root).hidden).toBe(true);
    expect(root.querySelector('.lt-viewbar [data-overview]')).toBeNull();

    const other = await open(withPlan());
    expect(drawer(other).hidden).toBe(true);
  });
});

function panelStillOpen(root: HTMLElement) {
  return !!root.querySelector('.lt-planpane .pl-panel');
}
