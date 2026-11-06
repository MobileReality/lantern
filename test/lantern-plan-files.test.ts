// @vitest-environment jsdom
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { LanternPlanView } from '../src/main/lantern';
import { parsePlanFile } from '../src/main/lantern-plan';
import { planView } from '../src/main/lantern-plan-view';
import { mountLanternView } from '../src/renderer/lib/lanternview';
import { planFileMarks, planFocus, planPick, stagePick } from '../src/renderer/lib/lanternplanfocus';
import { mapOf, node } from './helpers/lantern-map';

const NEW_FILE = 'src/main/lantern-plans.ts';
const NAMED = ['src/main/lantern-prs.ts', 'src/main/lantern.ts', 'src/main/main.ts'];
const DERIVED = ['src/main/lantern-pr-parse.ts', 'src/main/lantern-types.ts', 'src/main/menu.ts'];
const OTHERS = ['src/far.ts', 'src/unrelated.ts'];

const rel = (from: string, to: string) => ({ from, arrow: '>' as const, to, ext: null, symbol: null, label: '' });
const NODES = [...NAMED, ...DERIVED, ...OTHERS].map((file) => node(file, 'service'));
const RELATIONS = [
  rel('src/main/lantern-prs.ts', 'src/main/lantern-pr-parse.ts'),
  rel('src/main/lantern-prs.ts', 'src/main/lantern-types.ts'),
  rel('src/main/lantern.ts', 'src/main/lantern-prs.ts'),
  rel('src/main/main.ts', 'src/main/lantern.ts'),
  rel('src/main/menu.ts', 'src/main/main.ts'),
  rel('src/far.ts', 'src/main/lantern-pr-parse.ts'),
];

const PLAN_TEXT = fs.readFileSync(path.join(__dirname, 'fixtures', 'lantern-plans', 'plan-on-the-map.plan'), 'utf8');

function plan(): LanternPlanView {
  const parsed = parsePlanFile(PLAN_TEXT, 'plan-on-the-map.plan');
  if (!parsed.plan) throw new Error(parsed.error ?? 'plan');
  return planView(parsed.plan, [], parsed.problems);
}

const map = () => mapOf({ project: 'demo', nodes: NODES, relations: RELATIONS, plans: [plan()] });
const everything = [...NAMED, ...DERIVED, ...OTHERS].sort();
const mounted: { root: HTMLElement; view: ReturnType<typeof mountLanternView> }[] = [];

function mount() {
  const root = document.createElement('div');
  document.body.appendChild(root);
  mounted.push({ root, view: mountLanternView(root, map()) });
  return root;
}

afterEach(() => {
  for (const entry of mounted.splice(0)) {
    entry.view.dispose();
    entry.root.remove();
  }
});

const click = (root: HTMLElement, selector: string) => (root.querySelector(selector) as HTMLElement).click();
const toggle = (root: HTMLElement) => root.querySelector('.lt-pronly') as HTMLButtonElement;
const shown = (root: HTMLElement) => [...root.querySelectorAll<HTMLElement>('.lt-pixi-node-access')].map((n) => n.dataset.tip.split(' — ')[0]).sort();
const withClass = (root: HTMLElement, name: string) => [...root.querySelectorAll<HTMLElement>(`.lt-pixi-node-access.${name}`)].map((n) => n.dataset.tip.split(' — ')[0]).sort();

function planning() {
  const root = mount();
  click(root, '.lt-plans [data-plan="plan-on-the-map"]');
  return root;
}

describe('the impacted files of a plan stage', () => {
  const view = plan();
  const asLists = (files: readonly { path: string; origin: string; purpose: string }[]) => files.map((f) => [f.path, f.origin, f.purpose]);

  it('are the files it names, its new files, and the direct dependents and dependencies of the named ones, each with its origin', () => {
    const focus = planFocus(view, stagePick(view.slug, 's1'), map());
    expect(asLists(focus!.files)).toEqual([
      ...NAMED.map((file) => [file, 'named', '']),
      [NEW_FILE, 'new', 'Loads every plan file with the pull requests that tick its items.'],
      ...[...DERIVED].sort().map((file) => [file, 'derived', '']),
    ]);
  });

  it('leave out what is two hops away and what is unrelated', () => {
    const paths = planFocus(view, stagePick(view.slug, 's1'), map())!.files.map((f) => f.path);
    for (const file of OTHERS) expect(paths).not.toContain(file);
  });

  it('give distinct marks to new, named and related files', () => {
    const marks = planFileMarks(planFocus(view, stagePick(view.slug, 's1'), map()));
    expect(marks?.get(NEW_FILE)).toBe('+');
    expect(marks?.get(NAMED[0])).toBe('~');
    expect(marks?.get(DERIVED[0])).toBe('related');
    expect(marks?.has('src/far.ts')).toBe(false);
  });

  it('are only the named and new files when there is no map to derive from', () => {
    const focus = planFocus(view, stagePick(view.slug, 's1'), null);
    expect(focus!.files.map((f) => f.origin)).toEqual(['named', 'named', 'named', 'new']);
  });

  it('are the same for the Macro marks, the Files filter and the impact list: one derivation', () => {
    const focus = planFocus(view, planPick(view.slug), map())!;
    expect([...focus.paths].sort()).toEqual(['src/main/lantern-prs.ts', 'src/main/lantern.ts']);
    expect([...focus.fresh.keys()]).toEqual([NEW_FILE]);
    expect([...focus.related].sort()).toEqual(['src/main/lantern-pr-parse.ts', 'src/main/lantern-types.ts', 'src/main/main.ts']);
  });
});

describe('the Files view with a plan', () => {
  it('shows every file, and no proposed one, until a stage is picked', () => {
    const root = planning();
    expect(shown(root)).toEqual(everything);
    expect(toggle(root).hidden).toBe(false);
    expect(toggle(root).getAttribute('aria-pressed')).toBe('false');
  });

  it('draws a new file as a proposed node under its directory, marked as new, when its stage is picked', () => {
    const root = planning();
    click(root, '[data-plan-stage="s1"]');
    expect(shown(root)).toEqual([...everything, NEW_FILE].sort());
    expect(withClass(root, 'pr-new')).toEqual([NEW_FILE]);
    const proposed = [...root.querySelectorAll<HTMLElement>('.lt-pixi-node-access')].find((n) => n.dataset.tip.startsWith(NEW_FILE)) as HTMLElement;
    expect(proposed.dataset.tip).toContain('new in the plan');
    expect(proposed.dataset.tip).toContain('Loads every plan file with the pull requests that tick its items.');
    expect(withClass(root, 'pr-hit')).toEqual([...NAMED, ...DERIVED, NEW_FILE].sort());
  });

  it('with the plan filter on shows exactly the named, new and related files, and off brings everything back', () => {
    const root = planning();
    click(root, '[data-plan-stage="s1"]');
    toggle(root).click();
    expect(toggle(root).getAttribute('aria-pressed')).toBe('true');
    expect(toggle(root).textContent).toContain('Showing only plan files · 7');
    expect(shown(root)).toEqual([...NAMED, ...DERIVED, NEW_FILE].sort());
    toggle(root).click();
    expect(toggle(root).getAttribute('aria-pressed')).toBe('false');
    expect(shown(root)).toEqual([...everything, NEW_FILE].sort());
  });

  it('follows the pick while the filter is on', () => {
    const root = planning();
    click(root, '[data-plan-stage="s1"]');
    toggle(root).click();
    click(root, '[data-plan-item="s1.2"]');
    expect(shown(root)).toEqual(['src/main/lantern.ts', 'src/main/main.ts', 'src/main/menu.ts'].sort());
    click(root, '[data-plan-item="s1.1"]');
    expect(shown(root)).toEqual(['src/main/lantern-pr-parse.ts', 'src/main/lantern-prs.ts', 'src/main/lantern-types.ts', 'src/main/lantern.ts', 'src/main/main.ts', NEW_FILE].sort());
  });

  it('filters to the whole plan when nothing is picked', () => {
    const root = planning();
    toggle(root).click();
    expect(shown(root)).toEqual(['src/main/lantern-pr-parse.ts', 'src/main/lantern-prs.ts', 'src/main/lantern-types.ts', 'src/main/lantern.ts', 'src/main/main.ts', NEW_FILE].sort());
    toggle(root).click();
    expect(shown(root)).toEqual(everything);
  });

  it('turns the filter off and drops the proposed files when the plan is closed', () => {
    const root = planning();
    click(root, '[data-plan-stage="s1"]');
    toggle(root).click();
    click(root, '[data-plan-close]');
    expect(shown(root)).toEqual(everything);
    expect(toggle(root).hidden).toBe(true);
    expect(toggle(root).getAttribute('aria-pressed')).toBe('false');
  });

  it('lists the new and related files in the impact section of the panel', () => {
    const root = planning();
    click(root, '[data-plan-fold="sec:impact"]');
    const body = root.querySelector('[data-sec="sec:impact"] .pl-sec-body') as HTMLElement;
    const newRow = body.querySelector('.pl-k-new') as HTMLElement;
    expect([...newRow.children].map((c) => c.tagName)).toEqual(['EM', 'SPAN', 'SMALL']);
    expect(newRow.querySelector('em')?.textContent).toBe('new');
    expect(newRow.querySelector('small')?.textContent).toBe('Loads every plan file with the pull requests that tick its items.');
    expect([...body.querySelectorAll('h3')].map((h) => h.textContent)).toContain('Related files (3)');
    expect([...body.querySelectorAll('.pl-k-related')].map((row) => row.querySelector('.file-name')?.textContent).sort()).toEqual(['lantern-pr-parse.ts', 'lantern-types.ts', 'main.ts']);
  });
});
