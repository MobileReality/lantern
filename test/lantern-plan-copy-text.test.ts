// @vitest-environment jsdom
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LanternMap, LanternNode, LanternPlanView, LanternPr, LanternRelation } from '../src/main/lantern';
import { parsePlanFile } from '../src/main/lantern-plan';
import { planView } from '../src/main/lantern-plan-view';
import { mountLanternView } from '../src/renderer/lib/lanternview';
import { planText } from '../src/renderer/lib/lanternplantext';
import { areasPayload } from './helpers/lantern-macro-areas-payload';
import { macroFixtureBlocks, macroFixtureRecords } from './helpers/lantern-macro-fixture';
import { mapOf, node, pr } from './helpers/lantern-map';

const PLAN_TEXT = fs.readFileSync(path.join(__dirname, 'fixtures', 'lantern-plans', 'plan-on-the-map.plan'), 'utf8');
const read = (...parts: string[]) => fs.readFileSync(path.join(__dirname, '..', ...parts), 'utf8');

const records = macroFixtureRecords();
const nodes = records.map((r): LanternNode => node(r.path, r.role, { feature: r.feature }));
const relations = records.flatMap((r): LanternRelation[] => r.relations.map((x) => ({ from: r.path, arrow: x.arrow, to: x.to, ext: x.ext, symbol: null, label: '' })));
const loaded = { ...areasPayload(), blockByPath: macroFixtureBlocks() };
const ticking = pr('50', { title: 'Load every plan', state: 'open', plans: [{ slug: 'plan-on-the-map', item: 's1.1' }] });

function plan(prs: LanternPr[] = [ticking]): LanternPlanView {
  const parsed = parsePlanFile(PLAN_TEXT, 'plan-on-the-map.plan');
  if (!parsed.plan) throw new Error(parsed.error ?? 'plan');
  return planView(parsed.plan, prs, parsed.problems);
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const mounted: ReturnType<typeof mountLanternView>[] = [];
const copies: string[] = [];
let opened = 0;

beforeEach(() => {
  copies.length = 0;
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
  document.getSelection()?.removeAllRanges();
  vi.restoreAllMocks();
});

async function planning() {
  const root = document.createElement('div');
  document.body.appendChild(root);
  const map: LanternMap = mapOf({ project: 'demo', nodes, relations, prs: [ticking], plans: [plan()] });
  mounted.push(
    mountLanternView(root, map, {
      project: `copy-text-${++opened}`,
      readMacro: () => Promise.resolve(loaded),
      copy: (text) => {
        copies.push(text);
        return Promise.resolve();
      },
    }),
  );
  await flush();
  (root.querySelector('.lt-plans [data-plan="plan-on-the-map"]') as HTMLButtonElement).click();
  await flush();
  return root;
}

const pane = (root: HTMLElement) => root.querySelector('.lt-grid > .lt-planpane') as HTMLElement;
const item = (root: HTMLElement) => pane(root).querySelector('[data-plan-item="s1.1"]') as HTMLButtonElement;
const select = (el: Element) => document.getSelection()?.selectAllChildren(el);

describe('the plan as readable text', () => {
  it('writes the title, goal, scope, stages with items, status, files, questions and answers, impact and risks', () => {
    const text = planText(plan());
    expect(text).toBe(
      [
        "Show a plan's stages and progress on the Lantern map",
        'plan-on-the-map, opened 2026-10-26',
        '0 of 4 items implemented',
        'The plan was approved by jun on 2026-10-27.',
        '',
        'Goal',
        '- Lantern reads the plans under .lantern/plans and shows each plan\'s stages, open questions and item progress.',
        '- A selected stage lights up the features and files it changes on the macro view.',
        '',
        'Scope',
        'In scope',
        '- Read plan files and the pull requests that tick their items, in the main process.',
        '- A stage list with its open questions and item status.',
        "- Highlight a selected stage's impact on the macro view.",
        'Out of scope',
        '- Planning, approving or editing a plan from the app; the lantern-plan skill does that.',
        '',
        'Stages',
        's1: Read plans in the main process',
        '  Questions',
        '    s1.q1 (answered): Do plans on other branches show, or only the checked-out one?',
        '      Answer from jun: Only the checked-out branch for now.',
        '  s1.1 Load every plan with the pull requests that tick its items [in progress]',
        '    Done when: A test loads a repo with one plan and two PRs and gets one open and one merged item.',
        '    Changes: file src/main/lantern-prs.ts, file src/main/lantern.ts, new src/main/lantern-plans.ts',
        '    Pull requests: #50 open',
        '  s1.2 Hand the plans to the renderer next to the map [planned]',
        '    Done when: The renderer receives the plan list when a project opens, and an empty list without plans.',
        '    Changes: file src/main/main.ts',
        '',
        's2: Show the plan on the map (blocked)',
        '  Questions',
        '    s2.q1 (unanswered): Does the stage list sit in the review pane or beside the macro view?',
        '  s2.1 List a plan\'s stages with their questions and item status [planned]',
        '    Done when: A stage with an unanswered question reads as blocked in the stage list.',
        '    Changes: feature macro-view, file src/renderer/lib/macroview/model.ts',
        '  s2.2 Highlight what a selected stage changes [planned]',
        '    Done when: Selecting stage s1 marks the files s1 touches and nothing else.',
        '    Changes: file src/renderer/lib/macroview/marks.ts',
        '',
        'Plan impact',
        '- area explore-the-map: Plans are read where the map is read and drawn over it.',
        "- area review-changes: A plan's items are ticked by pull requests, so the PR objects feed it.",
        '- feature macro-view: The stage impact is drawn as a highlight on the macro view.',
        '- feature pull-requests: PR objects carry the plan item they tick.',
        '- file src/main/lantern-prs.ts: Item status comes from the PR states this file derives.',
        '- file src/main/lantern.ts: The map loader hands the plans to the renderer next to the map.',
        '- new src/main/lantern-plans.ts: Loads every plan file with the pull requests that tick its items.',
        '',
        'Risks',
        '- Reading plans from many branches could multiply the git scans; stay on the checked-out branch.',
        '- A plan edited after approval must show as changed, not as approved.',
        '',
      ].join('\n'),
    );
  });
});

describe('the Copy plan text button', () => {
  it('puts the plan text on the clipboard through the copy option and says Copied', async () => {
    const root = await planning();
    const button = pane(root).querySelector('.pl-head [data-plan-copy-text]') as HTMLButtonElement;
    expect(button.textContent).toBe('Copy plan text');
    expect(button.classList.contains('lt-cm-pill')).toBe(true);

    button.click();
    await flush();
    expect(copies).toEqual([planText(plan())]);
    expect(pane(root).querySelector('[data-plan-copy-text]')?.textContent).toBe('Copied');
  });

  it('is a different button from the one that copies answers', async () => {
    const root = await planning();
    (pane(root).querySelector('[data-plan-copy-text]') as HTMLButtonElement).click();
    await flush();
    expect(copies).toHaveLength(1);
    expect(pane(root).querySelector('[data-plan-copy]')?.textContent).toContain('Copy for the agent');
  });
});

describe('selecting the text of the plan', () => {
  it('does not pick an item when the click ends a drag over its text, and picks on a plain click', async () => {
    const root = await planning();
    select(item(root));
    item(root).click();
    expect(item(root).getAttribute('aria-pressed')).toBe('false');

    document.getSelection()?.removeAllRanges();
    item(root).click();
    expect(item(root).getAttribute('aria-pressed')).toBe('true');
  });

  it('does not open a question when the click ends a drag over its text', async () => {
    const root = await planning();
    const question = pane(root).querySelector('[data-plan-question="s2.q1"]') as HTMLButtonElement;
    select(question);
    question.click();
    expect(root.querySelector('.pl-qmodal')).toBeNull();

    document.getSelection()?.removeAllRanges();
    question.click();
    expect(root.querySelector('.pl-qmodal')).not.toBeNull();
  });

  it('leaves the panel alone when it redraws with nothing changed in the plan, so the selection and the nodes stay', async () => {
    const root = await planning();
    const copy = pane(root).querySelector('[data-plan-copy-text]') as HTMLButtonElement;
    copy.click();
    await flush();
    const goal = pane(root).querySelector('.pl-lines li') as HTMLElement;
    select(goal);
    const selected = document.getSelection()?.toString();
    expect(selected).toContain('Lantern reads the plans');

    (pane(root).querySelector('[data-plan-copy-text]') as HTMLButtonElement).click();
    await flush();
    expect(copies).toHaveLength(2);
    expect(pane(root).querySelector('.pl-lines li')).toBe(goal);
    expect(document.getSelection()?.toString()).toBe(selected);
  });

  it('puts the selection back on the same text when the panel is redrawn with a change', async () => {
    const root = await planning();
    select(pane(root).querySelector('.pl-lines li') as Element);
    const selected = document.getSelection()?.toString();

    (pane(root).querySelector('[data-plan-copy-text]') as HTMLButtonElement).click();
    await flush();
    expect(pane(root).querySelector('[data-plan-copy-text]')?.textContent).toBe('Copied');
    expect(document.getSelection()?.toString()).toBe(selected);
  });
});

describe('the stylesheet', () => {
  const css = read('src', 'renderer', 'lantern-select.css');

  it('turns text selection on for the plan panel and for the buttons that hold its titles and questions', () => {
    const rule = css.split('\n').find((line) => line.includes('.lt-planpane .pl-panel') && line.includes('user-select: text'));
    expect(rule).toBeDefined();
    expect(rule).toContain('.lt-planpane .pl-pick');
    expect(rule).toContain('.lt-planpane .pl-qopen');
  });

  it('keeps the copy buttons and the close button out of a selection', () => {
    const rule = css.split('\n').find((line) => line.includes('.lt-planpane .pl-copy-plan') && line.includes('user-select: none'));
    expect(rule).toBeDefined();
  });

  it('keeps the plan stylesheet out of the selection rules: they live in the file that opts content in', () => {
    expect(read('src', 'renderer', 'lantern-plans.css')).not.toMatch(/\.pl-panel[^{]*\{[^}]*user-select: none/);
  });
});
