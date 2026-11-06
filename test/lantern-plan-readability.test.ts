// @vitest-environment jsdom
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LanternMap, LanternNode, LanternPlanView, LanternPr, LanternRelation } from '../src/main/lantern';
import { parsePlanFile } from '../src/main/lantern-plan';
import { planView } from '../src/main/lantern-plan-view';
import { mountLanternView } from '../src/renderer/lib/lanternview';
import { areasPayload } from './helpers/lantern-macro-areas-payload';
import { macroFixtureBlocks, macroFixtureRecords } from './helpers/lantern-macro-fixture';
import { mapOf, node, pr } from './helpers/lantern-map';

const PLAN_TEXT = fs.readFileSync(path.join(__dirname, 'fixtures', 'lantern-plans', 'plan-on-the-map.plan'), 'utf8');
const CSS = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'lantern-plans.css'), 'utf8');

const records = macroFixtureRecords();
const nodes = records.map((r): LanternNode => node(r.path, r.role, { feature: r.feature }));
const relations = records.flatMap((r): LanternRelation[] => r.relations.map((x) => ({ from: r.path, arrow: x.arrow, to: x.to, ext: x.ext, symbol: null, label: '' })));
const loaded = { ...areasPayload(), blockByPath: macroFixtureBlocks() };

const merged = [
  pr('60', { title: 'Load plans', state: 'merged', plans: [{ slug: 'plan-on-the-map', item: 's1.1' }] }),
  pr('61', { title: 'Hand plans over', state: 'merged', plans: [{ slug: 'plan-on-the-map', item: 's1.2' }] }),
];

function plan(prs: LanternPr[]): LanternPlanView {
  const parsed = parsePlanFile(PLAN_TEXT, 'plan-on-the-map.plan');
  if (!parsed.plan) throw new Error(parsed.error ?? 'plan');
  return planView(parsed.plan, prs, parsed.problems);
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const mounted: ReturnType<typeof mountLanternView>[] = [];
let opened = 0;

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

async function open(prs: LanternPr[], project = `readability-${++opened}`) {
  const root = document.createElement('div');
  document.body.appendChild(root);
  const map: LanternMap = mapOf({ project: 'demo', nodes, relations, prs, plans: [plan(prs)] });
  mounted.push(mountLanternView(root, map, { project, readMacro: () => Promise.resolve(loaded) }));
  await flush();
  (root.querySelector('.lt-plans [data-plan="plan-on-the-map"]') as HTMLButtonElement).click();
  await flush();
  return root;
}

const pane = (root: HTMLElement) => root.querySelector('.lt-planpane') as HTMLElement;
const stage = (root: HTMLElement, id: string) => pane(root).querySelector(`[data-stage="${id}"]`) as HTMLElement;
const bodyHidden = (root: HTMLElement, id: string) => (stage(root, id).querySelector('.pl-stage-body') as HTMLElement).hidden;
const fold = (root: HTMLElement, key: string) => [...pane(root).querySelectorAll<HTMLButtonElement>('[data-plan-fold]')].find((b) => b.getAttribute('data-plan-fold') === key) as HTMLButtonElement;

describe('the plan header', () => {
  it('is sticky and holds the title, the progress and the approval state', async () => {
    const root = await open([]);
    const head = pane(root).querySelector('.pl-panel > .pl-head') as HTMLElement;
    expect(head.querySelector('h1')?.textContent).toBe("Show a plan's stages and progress on the Lantern map");
    expect(head.querySelector('progress.pl-progress')).not.toBeNull();
    expect(head.textContent).toContain('0 of 4 items implemented');
    expect(head.textContent).toContain('approved');
    expect(head.textContent).toContain('The plan was approved by jun on 2026-10-27.');
    expect(head.nextElementSibling?.className).toBe('pl-content');
    expect(CSS).toMatch(/\.pl-head \{[^}]*position: sticky;[^}]*top: 0;/);
  });
});

describe('the stage cards', () => {
  it('carry a status summary with counts as words', async () => {
    const root = await open([]);
    expect([...stage(root, 's1').querySelectorAll('.pl-sum')].map((x) => x.textContent)).toEqual(['2 planned']);
    expect([...stage(root, 's2').querySelectorAll('.pl-sum')].map((x) => x.textContent)).toEqual(['2 blocked']);
    expect(stage(root, 's2').querySelector('progress.pl-progress')).not.toBeNull();
    expect(stage(root, 's2').querySelector('header .pl-flag')?.textContent).toBe('blocked');
  });

  it('opens the current and the blocked stage and collapses a completed one', async () => {
    const root = await open([]);
    expect(bodyHidden(root, 's1')).toBe(false);
    expect(bodyHidden(root, 's2')).toBe(false);

    const done = await open(merged);
    expect([...stage(done, 's1').querySelectorAll('.pl-sum')].map((x) => x.textContent)).toEqual(['2 done']);
    expect(stage(done, 's1').querySelector('header .pl-flag.pl-done')?.textContent).toBe('done');
    expect(bodyHidden(done, 's1')).toBe(true);
    expect(fold(done, 'stage:s1').getAttribute('aria-expanded')).toBe('false');
    expect(bodyHidden(done, 's2')).toBe(false);
  });

  it('remembers a fold for the plan through a redraw and a reopen, and keeps the pick', async () => {
    const root = await open(merged, 'readability-remember');
    fold(root, 'stage:s1').click();
    await flush();
    expect(bodyHidden(root, 's1')).toBe(false);
    (stage(root, 's1').querySelector('[data-plan-item]') as HTMLButtonElement).click();
    await flush();
    expect(bodyHidden(root, 's1')).toBe(false);
    expect(pane(root).querySelector('.pl-pickrow')).not.toBeNull();
    fold(root, 'stage:s2').click();
    await flush();
    expect(bodyHidden(root, 's2')).toBe(true);
    (root.querySelector('[data-plan-close]') as HTMLButtonElement).click();
    await flush();
    (root.querySelector('.lt-plans [data-plan="plan-on-the-map"]') as HTMLButtonElement).click();
    await flush();
    expect(bodyHidden(root, 's1')).toBe(false);
    expect(bodyHidden(root, 's2')).toBe(true);
  });

  it('folds the long sections, impact closed and risks open, and leaves goal and scope plain', async () => {
    const root = await open([]);
    const sec = (key: string) => pane(root).querySelector(`[data-sec="${key}"] .pl-sec-body`) as HTMLElement;
    expect(sec('sec:impact').hidden).toBe(true);
    expect(sec('sec:risks').hidden).toBe(false);
    expect(sec('sec:approvals').hidden).toBe(true);
    fold(root, 'sec:impact').click();
    await flush();
    expect(sec('sec:impact').hidden).toBe(false);
    expect(pane(root).querySelectorAll('.pl-sec:not(.pl-fold-sec) > h2 button').length).toBe(0);
  });

  it('sets the questions apart from the items, with the answer under an answered one', async () => {
    const root = await open([]);
    const box = stage(root, 's1').querySelector('.pl-qbox') as HTMLElement;
    expect(box.parentElement?.className).toBe('pl-stage-body');
    expect(box.querySelector('.pl-items')).toBeNull();
    expect(stage(root, 's1').querySelector('.pl-items .pl-question')).toBeNull();
    const answered = box.querySelector('.pl-answered') as HTMLElement;
    expect(answered.querySelector('.pl-qtext')?.nextElementSibling?.className).toBe('pl-answer');
    expect(answered.querySelector('.pl-answer')?.textContent).toBe('jun: Only the checked-out branch for now.');
    const pending = stage(root, 's2').querySelector('.pl-unanswered') as HTMLElement;
    expect(pending.querySelector('.pl-open-tag')?.textContent).toBe('unanswered');
    expect(pending.querySelector('.pl-answer')).toBeNull();
  });

  it('keeps a stale approval as a word on the stage header, not a colour alone', async () => {
    const root = await open([]);
    expect(stage(root, 's1').querySelector('header .pl-state')?.textContent).toMatch(/^(approved|pending|stale)$/);
    expect(stage(root, 's1').querySelectorAll('header .pl-state').length).toBe(1);
  });
});

describe('the Planning view fills the Lantern area', () => {
  const rule = (selector: string) => {
    const found = [...CSS.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter((match) => match[1].split(',').some((part) => part.trim() === selector));
    return found.map((match) => match[2]).join(' ');
  };

  it('gives the grid one row that takes the rest of the height and sets no fixed height', () => {
    expect(rule('.lt-grid.lt-planning')).toContain('grid-template-rows: minmax(0, 1fr)');
    expect(rule('.lt-grid.lt-planning > .lt-main')).toContain('min-height: 0');
    expect(rule('.lt-planpane')).toMatch(/min-height: 0/);
    expect(rule('.lt-planpane')).toMatch(/overflow-y: auto/);
    expect(rule('.lt-planpane')).toMatch(/grid-row: 1/);
    for (const selector of ['.lt-planpane', '.lt-grid.lt-planning', '.pl-panel']) expect(rule(selector), selector).not.toMatch(/(?:^|[\s;])(?:max-)?height:|min-height:\s*[1-9]/);
  });

  it('lets the plan panel follow the pane width, with its inner padding on the head and content', () => {
    const panel = rule('.pl-panel');
    expect(panel).not.toMatch(/max-width/);
    expect(panel).not.toMatch(/margin:\s*0 auto/);
    expect(panel).toMatch(/width: 100%/);
    expect(rule('.pl-head')).toMatch(/padding: 12px 22px 10px/);
    expect(rule('.pl-content')).toMatch(/padding: 6px 22px 40px/);
  });

  it('chains full height up to the Lantern root, and the pane scrolls, not the page', () => {
    const base = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'lantern.css'), 'utf8');
    expect(base).toMatch(/\.lt-grid \{[^}]*flex: 1;[^}]*min-height: 0;[^}]*display: grid/);
    expect(base).toMatch(/\.lt-root \{[^}]*display: flex;[^}]*flex-direction: column;[^}]*min-height: 0;[^}]*height: 100%/);
    expect(base).toMatch(/\.lt-body > \.lt-root \{[^}]*flex: 1;[^}]*min-height: 0/);
  });

  it('renders the pane as the grid child that the layout classes address', async () => {
    const root = await open([]);
    const grid = root.querySelector('.lt-grid') as HTMLElement;
    expect(grid.classList.contains('lt-planning')).toBe(true);
    expect(pane(root).parentElement).toBe(grid);
    expect(pane(root).getAttribute('style')).toBeNull();
    expect(grid.getAttribute('style')).toBeNull();
  });
});

describe('the details the first review asked for', () => {
  it('says a blocked stage is blocked once, with the question, and dims its items instead of repeating a chip', async () => {
    const root = await open([]);
    const s2 = stage(root, 's2');
    expect(s2.querySelectorAll('.pl-flag').length).toBe(1);
    expect(s2.querySelector('.pl-reason')?.textContent).toBe('Waiting for an answer to: s2.q1');
    expect([...s2.querySelectorAll('.pl-item')].every((li) => li.classList.contains('pl-dim'))).toBe(true);
    expect(s2.querySelector('.pl-item .pl-status')?.textContent).toBe('planned');
    expect(stage(root, 's1').querySelector('.pl-reason')).toBeNull();
  });

  it('groups the plan impact by kind with a count, one aligned row each', async () => {
    const root = await open([]);
    fold(root, 'sec:impact').click();
    await flush();
    const body = pane(root).querySelector('[data-sec="sec:impact"] .pl-sec-body') as HTMLElement;
    expect([...body.querySelectorAll('h3')].map((h) => h.textContent)).toEqual(['area (2)', 'feature (2)', 'file (2)', 'new (1)']);
    const row = body.querySelector('.pl-impact .pl-k-file') as HTMLElement;
    expect([...row.children].map((c) => c.tagName)).toEqual(['EM', 'SPAN', 'SMALL']);
    expect(body.querySelector('.pl-pick-impact')?.getAttribute('aria-pressed')).toBe('false');
  });

  it('summarises the approvals in one line above a section and state list', async () => {
    const root = await open([]);
    const body = pane(root).querySelector('[data-sec="sec:approvals"] .pl-sec-body') as HTMLElement;
    expect(body.querySelector('.pl-approval-sum')?.textContent).toMatch(/^\d+ of \d+ approved\. The plan was approved by jun/);
    expect(body.querySelectorAll('.pl-approvals li').length).toBeGreaterThan(3);
  });

  it('gives a question its own default line', async () => {
    const parsed = parsePlanFile(`${PLAN_TEXT.replace('Does the stage list sit in the review pane or beside the macro view?', 'Where does it sit? Default: beside the macro view.')}`, 'plan-on-the-map.plan');
    if (!parsed.plan) throw new Error('plan');
    const view = planView(parsed.plan, []);
    const root = document.createElement('div');
    document.body.appendChild(root);
    mounted.push(mountLanternView(root, mapOf({ project: 'demo', nodes, relations, prs: [], plans: [view] }), { project: 'readability-default', readMacro: () => Promise.resolve(loaded) }));
    await flush();
    (root.querySelector('.lt-plans [data-plan="plan-on-the-map"]') as HTMLButtonElement).click();
    await flush();
    const q = stage(root, 's2').querySelector('.pl-unanswered') as HTMLElement;
    expect(q.querySelector('.pl-qtext')?.textContent).toBe('Where does it sit?');
    expect(q.querySelector('.pl-qdefault')?.textContent).toBe('Default: beside the macro view.');
  });
});
