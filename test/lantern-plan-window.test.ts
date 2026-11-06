// @vitest-environment jsdom
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LanternMap, LanternNode, LanternPlanView } from '../src/main/lantern';
import { parsePlanFile } from '../src/main/lantern-plan';
import { planView } from '../src/main/lantern-plan-view';
import { mountLanternView } from '../src/renderer/lib/lanternview';
import { syncPlanWindow } from '../src/renderer/lib/lanternplanwindow';
import { VIEW, say } from '../src/shared/lantern-plan-messages';
import { macroFixtureRecords } from './helpers/lantern-macro-fixture';
import { mapOf, node } from './helpers/lantern-map';

const RENDERER = path.join(__dirname, '..', 'src', 'renderer');
const CSS = ['workspace.css', 'lantern.css', 'lantern-plans.css'].map((name) => fs.readFileSync(path.join(RENDERER, name), 'utf8')).join('\n');
const PLAN_TEXT = fs.readFileSync(path.join(__dirname, 'fixtures', 'lantern-plans', 'plan-on-the-map.plan'), 'utf8');
const SLUG = 'plan-on-the-map';

const records = macroFixtureRecords();
const nodes = records.map((r): LanternNode => node(r.path, r.role, { feature: r.feature }));

function plan(): LanternPlanView {
  const parsed = parsePlanFile(PLAN_TEXT, `${SLUG}.plan`);
  if (!parsed.plan) throw new Error(parsed.error ?? 'plan');
  return planView(parsed.plan, [], parsed.problems);
}

const map = (plans: LanternPlanView[]): LanternMap => mapOf({ project: 'demo', nodes, relations: [], plans });
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const mounted: ReturnType<typeof mountLanternView>[] = [];
let opened = 0;

beforeEach(() => {
  window.matchMedia = ((query: string) => ({ matches: query.includes('reduce'), media: query, addEventListener: () => undefined, removeEventListener: () => undefined })) as never;
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);
  document.body.innerHTML =
    '<aside id="sidebar">projects</aside><main id="main"><div id="views"></div><div id="lantern-tab" class="lantern-tab"><div class="lt-panel"><div class="lt-head">head</div><div class="lt-body"></div></div></div></main>';
});

afterEach(() => {
  mounted.splice(0).forEach((one) => { one.dispose(); });
  document.head.replaceChildren();
  document.body.replaceChildren();
  document.body.className = '';
  vi.restoreAllMocks();
});

async function mount(data = map([plan()])) {
  const root = document.querySelector('.lt-body') as HTMLElement;
  const one = mountLanternView(root, data, { project: `plan-window-${++opened}` });
  mounted.push(one);
  await flush();
  return { root, one };
}

const shown = (selector: string) => getComputedStyle(document.querySelector(selector)!).display !== 'none';
const inWindow = () => document.body.classList.contains('plan-window');
const openPlan = async (root: HTMLElement) => {
  (root.querySelector(`.lt-plans [data-plan="${SLUG}"]`) as HTMLButtonElement).click();
  await flush();
};
const escape = () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));

describe('the Planning view as a full window', () => {
  it('hides the app chrome outside the Lantern area while a plan is open and shows it again on leaving', async () => {
    const { root } = await mount();
    for (const sel of ['#sidebar', '#views', '.lt-head']) expect(shown(sel), sel).toBe(true);

    await openPlan(root);
    expect(inWindow()).toBe(true);
    for (const sel of ['#sidebar', '#views', '.lt-head', '.lt-plans']) expect(shown(sel), sel).toBe(false);
    expect(shown('#lantern-tab')).toBe(true);
    expect(shown('.lt-planbar')).toBe(true);

    (root.querySelector('[data-plan-leave]') as HTMLButtonElement).click();
    await flush();
    expect(inWindow()).toBe(false);
    for (const sel of ['#sidebar', '#views', '.lt-head']) expect(shown(sel), sel).toBe(true);
  });

  it('takes its texts from the plan view catalogue', async () => {
    const { root } = await mount();
    await openPlan(root);
    const leave = root.querySelector('[data-plan-leave]') as HTMLElement;
    expect(leave.textContent).toBe(say(VIEW.WINDOW_LEAVE));
    expect(leave.dataset.tip).toBe(say(VIEW.WINDOW_LEAVE_TITLE));
    expect(root.querySelector('.lt-planbar-label')?.textContent).toBe(say(VIEW.WINDOW_LABEL));
  });

  it('leaves on Escape, returns to the view the person came from, and reopening enters again', async () => {
    const { root } = await mount();
    await openPlan(root);
    expect(inWindow()).toBe(true);
    escape();
    await flush();
    expect(inWindow()).toBe(false);
    expect(root.querySelector('.lt-grid')!.classList.contains('lt-planning')).toBe(false);
    expect(shown('#sidebar')).toBe(true);
    await openPlan(root);
    expect(inWindow()).toBe(true);
  });

  it('gives the window back when the plan disappears from the map', async () => {
    const { root, one } = await mount();
    await openPlan(root);
    one.update(map([]));
    await flush();
    expect(inWindow()).toBe(false);
    expect(shown('#sidebar')).toBe(true);
  });

  it('gives the window back when its tab is no longer in front or the view is disposed', async () => {
    const { root, one } = await mount();
    await openPlan(root);
    document.querySelector('.lt-panel')!.classList.add('hidden');
    syncPlanWindow();
    expect(inWindow()).toBe(false);
    document.querySelector('.lt-panel')!.classList.remove('hidden');
    syncPlanWindow();
    expect(inWindow()).toBe(true);
    one.dispose();
    expect(inWindow()).toBe(false);
  });

  it('keeps the plan header gutter when the command palette stylesheet is loaded after the plan one', async () => {
    const palette = document.createElement('style');
    palette.textContent = fs.readFileSync(path.join(RENDERER, 'command-palette.css'), 'utf8');
    document.head.appendChild(palette);
    const { root } = await mount();
    await openPlan(root);
    const head = getComputedStyle(root.querySelector('.lt-planpane .pl-head')!);
    expect(head.paddingLeft).toBe('22px');
  });

  it('clears the macOS traffic lights and drags the window by the plan bar only on macOS', () => {
    expect(CSS).toMatch(/body\.plan-window\.mac \.lt-planbar\s*\{[^}]*padding-left:\s*var\(--lt-controls-inset\)[^}]*-webkit-app-region:\s*drag/);
    expect(CSS).toMatch(/body\.plan-window \.lt-planbar-leave\s*\{[^}]*-webkit-app-region:\s*no-drag/);
    expect(CSS).not.toMatch(/body\.plan-window \.lt-planbar\s*\{[^}]*-webkit-app-region:\s*drag/);
  });
});
