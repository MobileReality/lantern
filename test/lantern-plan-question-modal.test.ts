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
const PLAN_TEXT = fs.readFileSync(path.join(__dirname, 'fixtures', 'lantern-plans', 'plan-on-the-map.plan'), 'utf8');

const records = macroFixtureRecords();
const role = records[0].role;
const nodes = [...records.map((r): LanternNode => node(r.path, r.role, { feature: r.feature })), ...S1_FILES.map((file) => node(file, role, { feature: 'pull-requests' }))];
const relations = records.flatMap((r): LanternRelation[] => r.relations.map((x) => ({ from: r.path, arrow: x.arrow, to: x.to, ext: x.ext, symbol: null, label: '' })));
const blockByPath = { ...macroFixtureBlocks(), 'src/main/lantern-prs.ts': 'pull-requests', 'src/main/lantern.ts': 'lantern-map', 'src/main/main.ts': 'projects-hub' };
const loaded = { ...areasPayload(), blockByPath };

function plan(text = PLAN_TEXT): LanternPlanView {
  const parsed = parsePlanFile(text, 'plan-on-the-map.plan');
  if (!parsed.plan) throw new Error(parsed.error ?? 'plan');
  return planView(parsed.plan, [], parsed.problems);
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
let opened = 0;
const mounted: ReturnType<typeof mountLanternView>[] = [];
const copies: string[] = [];

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
  vi.restoreAllMocks();
});

async function planning(text = PLAN_TEXT, project = `question-test-${++opened}`) {
  const root = document.createElement('div');
  document.body.appendChild(root);
  const map: LanternMap = mapOf({ project: 'demo', nodes, relations, plans: [plan(text)] });
  mounted.push(
    mountLanternView(root, map, {
      project,
      readMacro: () => Promise.resolve(loaded),
      copy: (copied) => {
        copies.push(copied);
        return Promise.resolve();
      },
    }),
  );
  await flush();
  (root.querySelector('.lt-plans [data-plan="plan-on-the-map"]') as HTMLButtonElement).click();
  await flush();
  return root;
}

const click = (root: ParentNode, selector: string) => (root.querySelector(selector) as HTMLElement).click();
const modal = (root: ParentNode) => root.querySelector<HTMLElement>('.pl-qmodal');
const typeInto = (input: HTMLTextAreaElement, value: string) => {
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
};
const planPane = (root: HTMLElement) => root.querySelector('.lt-grid > .lt-planpane') as HTMLElement;
const hitFiles = (root: HTMLElement) => [...root.querySelectorAll<HTMLButtonElement>('.lt-pixi-node-access.pr-hit')].map((button) => button.dataset.tip.split(' — ')[0]).sort();
const view = (root: HTMLElement, name: string) => root.querySelector<HTMLButtonElement>(`.lt-viewbar [data-view="${name}"]`);

describe('every question in the plan panel opens a modal', () => {
  it('opens for an unanswered question and for an answered one, showing the question and what the plan already holds', async () => {
    const root = await planning();
    const buttons = [...planPane(root).querySelectorAll<HTMLElement>('[data-plan-question]')];
    expect(buttons.map((button) => button.dataset.planQuestion)).toEqual(['s1.q1', 's2.q1']);

    buttons[1].click();
    const open = modal(root)!;
    expect(open.getAttribute('role')).toBe('dialog');
    expect(open.getAttribute('aria-modal')).toBe('true');
    expect(open.querySelector('.modal-title b')?.textContent).toBe('s2.q1');
    expect(open.querySelector('.pl-qtext')?.textContent).toBe('Does the stage list sit in the review pane or beside the macro view?');
    expect(open.querySelector('.pl-open-tag')).not.toBeNull();
    expect(document.activeElement).toBe(open.querySelector('textarea'));

    click(root, '.pl-qmodal [data-qm="close"]');
    expect(modal(root)).toBeNull();
    click(planPane(root), '[data-plan-question="s1.q1"]');
    expect(modal(root)!.querySelector('.pl-answer')?.textContent).toBe('jun: Only the checked-out branch for now.');
    expect(modal(root)!.querySelector('.pl-open-tag')).toBeNull();
  });

  it('shows the default of a question apart from its text', async () => {
    const root = await planning(PLAN_TEXT.replace('beside the macro view?', 'beside the macro view? Default: beside it.'));
    click(root, '[data-plan-question="s2.q1"]');
    expect(modal(root)!.querySelector('.pl-qdefault')?.textContent).toBe('Default: beside it.');
    expect(modal(root)!.querySelector('.pl-qtext')?.textContent).toBe('Does the stage list sit in the review pane or beside the macro view?');
  });

  it('offers the three helps, a text area and a copy button', async () => {
    const root = await planning();
    click(root, '[data-plan-question="s1.q1"]');
    expect([...modal(root)!.querySelectorAll('.pl-qhelp button')].map((button) => button.textContent)).toEqual(['Explain more', 'Show on the plan', 'Show flow']);
    expect(modal(root)!.querySelector('textarea')?.getAttribute('maxlength')).toBe('2000');
    expect(modal(root)!.querySelector('[data-qm-count]')?.textContent).toBe('0 / 2000');
    expect(modal(root)!.querySelector<HTMLButtonElement>('[data-qm="copy"]')!.disabled).toBe(true);
  });

  it('counts the typed characters and says when the cap is reached', async () => {
    const root = await planning();
    click(root, '[data-plan-question="s1.q1"]');
    const count = () => modal(root)!.querySelector('[data-qm-count]')!.textContent;
    typeInto(modal(root)!.querySelector('textarea')!, 'abc');
    expect(count()).toBe('3 / 2000');
    typeInto(modal(root)!.querySelector('textarea')!, 'a'.repeat(2000));
    expect(count()).toBe('2000 / 2000, the most an answer can hold');
  });

  it('closes on Escape and gives the focus back to the question', async () => {
    const root = await planning();
    const opener = planPane(root).querySelector<HTMLElement>('[data-plan-question="s2.q1"]')!;
    opener.focus();
    opener.click();
    modal(root)!.querySelector('textarea')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    expect(modal(root)).toBeNull();
    expect(document.activeElement).toBe(planPane(root).querySelector('[data-plan-question="s2.q1"]'));
    expect(planPane(root).hidden).toBe(false);
  });
});

describe('answering and copying', () => {
  it('keeps what was typed, counts it in the panel and in the modal, and copies it with the plan and the question id', async () => {
    const root = await planning();
    click(root, '[data-plan-question="s2.q1"]');
    typeInto(modal(root)!.querySelector('textarea')!, 'Beside the macro view.');
    expect(modal(root)!.querySelector('[data-qm-ready]')?.textContent).toBe('Ready to copy: 1 answer');
    click(modal(root)!, '[data-qm="copy"]');
    await flush();
    expect(copies).toHaveLength(1);
    expect(copies[0]).toContain('Lantern plan plan-on-the-map');
    expect(copies[0]).toContain('s2.q1: Does the stage list sit in the review pane or beside the macro view?\nAnswer: Beside the macro view.');
    expect(copies[0]).not.toContain('s1.q1:');
    expect(modal(root)!.querySelector('[data-qm="copy"]')?.textContent).toBe('Copied');

    click(modal(root)!, '[data-qm="done"]');
    const bar = planPane(root).querySelector('.pl-askbar')!;
    expect(bar.querySelector('.pl-askcount b')?.textContent).toBe('2 of 2 questions answered');
    expect(bar.querySelector('[role="status"]')?.textContent).toBe('Ready to copy: 1 answer');
    expect(bar.querySelector('.lt-cm-count')?.textContent).toBe('1');
    expect(planPane(root).querySelector('[data-plan-question="s2.q1"] .pl-draft')?.textContent).toBe('Your answer: Beside the macro view.');
  });

  it('puts the typed answer back when the question is opened again, and copies from the panel too', async () => {
    const root = await planning();
    click(root, '[data-plan-question="s2.q1"]');
    typeInto(modal(root)!.querySelector('textarea')!, 'Beside it.');
    click(modal(root)!, '[data-qm="done"]');
    click(root, '[data-plan-question="s2.q1"]');
    expect(modal(root)!.querySelector('textarea')!.value).toBe('Beside it.');
    click(modal(root)!, '[data-qm="done"]');

    click(planPane(root), '[data-plan-copy]');
    await flush();
    expect(copies[0]).toContain('Answer: Beside it.');
    expect(planPane(root).querySelector('[data-plan-copy]')?.textContent).toContain('Copied');
  });

  it('keeps the answers per project and plan: another project starts empty', async () => {
    const first = await planning(PLAN_TEXT, 'question-same-project');
    click(first, '[data-plan-question="s2.q1"]');
    typeInto(modal(first)!.querySelector('textarea')!, 'Remember me.');
    click(modal(first)!, '[data-qm="done"]');
    const again = await planning(PLAN_TEXT, 'question-same-project');
    expect(planPane(again).querySelector('.pl-askcount [role="status"]')?.textContent).toBe('Ready to copy: 1 answer');
    const other = await planning(PLAN_TEXT, 'question-other-project');
    expect(planPane(other).querySelector('.pl-askcount [role="status"]')?.textContent).toBe('Nothing to copy yet. Click a question to answer it.');
  });

  it('writes nothing: the copy button is the only way the answer leaves the view', async () => {
    const root = await planning();
    click(root, '[data-plan-question="s2.q1"]');
    typeInto(modal(root)!.querySelector('textarea')!, 'Beside it.');
    click(modal(root)!, '[data-qm="done"]');
    expect(copies).toEqual([]);
  });
});

describe('Explain more and Show flow', () => {
  it('shows the explanation and draws the flow the plan holds, with the pull request flow renderer', async () => {
    const root = await planning();
    click(root, '[data-plan-question="s2.q1"]');
    const explanation = [...modal(root)!.querySelectorAll('[data-qm-box="explain"] p')].map((p) => p.textContent);
    expect(explanation).toHaveLength(2);
    expect(explanation[0]).toContain('The review pane is the narrow column');
    const flow = modal(root)!.querySelector('[data-qm-box="flow"] section.lt-flow-view')!;
    expect(flow.getAttribute('aria-label')).toBe('Flow of question s2.q1');
    expect(flow.querySelector('.lt-flow-title')?.textContent).toBe('Reader opens a plan on the map');
    expect([...flow.querySelectorAll('.lt-flow-row:not(.lt-flow-below) .lt-flow-block')].map((block) => block.textContent)).toEqual(['WhoReader', 'Doesopens', 'Toa plan']);
    expect(flow.querySelector('.lt-flow-below .lt-flow-old del')?.textContent).toBe('the list sits in the review pane');
    expect(flow.querySelector('.lt-flow-below .lt-flow-new strong')?.textContent).toBe('the list sits beside the map');
    expect(flow.querySelector('.lt-flow-files .lt-flow-file')?.getAttribute('data-tip')).toBe('src/renderer/lib/macroview/mount.ts');
    expect(flow.querySelector('[data-flow-step], [data-flow-open]')).toBeNull();
    expect(modal(root)!.querySelector('[data-qm="flow"]')?.hasAttribute('aria-pressed')).toBe(false);
  });

  it('asks the agent when the plan holds neither: the buttons add the request and the modal says so', async () => {
    const root = await planning();
    click(root, '[data-plan-question="s1.q1"]');
    const open = modal(root)!;
    expect(open.querySelector('[data-qm-box]')).toBeNull();
    click(open, '[data-qm="explain"]');
    click(open, '[data-qm="flow"]');
    expect(open.querySelector('[data-qm="explain"]')?.getAttribute('aria-pressed')).toBe('true');
    expect(open.querySelector('[data-qm="flow"]')?.getAttribute('aria-pressed')).toBe('true');
    expect(open.querySelector<HTMLElement>('[data-qm-note="explain"]')).toMatchObject({ hidden: false, textContent: 'The agent will explain this after you paste the copied text.' });
    expect(open.querySelector<HTMLElement>('[data-qm-note="flow"]')).toMatchObject({ hidden: false, textContent: 'The agent will draw the flow after you paste the copied text.' });
    expect(open.querySelector('[data-qm-ready]')?.textContent).toBe('Ready to copy: 2 requests');

    click(open, '[data-qm="copy"]');
    await flush();
    expect(copies[0]).toContain('s1.q1: Do plans on other branches show, or only the checked-out one?\nRequest: explain s1.q1 more\nRequest: draw the flow for s1.q1');
  });

  it('takes a request back when the button is pressed again', async () => {
    const root = await planning();
    click(root, '[data-plan-question="s1.q1"]');
    click(modal(root)!, '[data-qm="flow"]');
    click(modal(root)!, '[data-qm="flow"]');
    expect(modal(root)!.querySelector<HTMLElement>('[data-qm-note="flow"]')!.hidden).toBe(true);
    expect(modal(root)!.querySelector<HTMLButtonElement>('[data-qm="copy"]')!.disabled).toBe(true);
  });

  it('can still ask for more when the plan already explains the question', async () => {
    const root = await planning();
    click(root, '[data-plan-question="s2.q1"]');
    click(modal(root)!, '[data-qm="explain"]');
    expect(modal(root)!.querySelector('[data-qm-note="explain"]')?.textContent).toBe('The agent will add to this explanation after you paste the copied text.');
    click(modal(root)!, '[data-qm="copy"]');
    await flush();
    expect(copies[0]).toContain('Request: explain s2.q1 more');
  });

  it('keeps a request in the panel count after the modal closes', async () => {
    const root = await planning();
    click(root, '[data-plan-question="s1.q1"]');
    click(modal(root)!, '[data-qm="flow"]');
    click(modal(root)!, '[data-qm="done"]');
    expect(planPane(root).querySelector('.pl-askcount [role="status"]')?.textContent).toBe('Ready to copy: 1 request');
  });
});

describe('copying one answer', () => {
  const one = (root: ParentNode) => modal(root)!.querySelector<HTMLButtonElement>('[data-qm="copy-one"]')!;

  it('is disabled with the reason in its title while there is nothing to copy, and the count is unchanged', async () => {
    const root = await planning();
    click(root, '[data-plan-question="s1.q1"]');
    expect(one(root).textContent).toBe('Copy this answer');
    expect(one(root).disabled).toBe(true);
    expect(one(root).dataset.tip).toContain('Nothing to copy yet');
    typeInto(modal(root)!.querySelector('textarea')!, 'Only the checked-out one.');
    expect(one(root).disabled).toBe(false);
    expect(one(root).dataset.tip).toContain('only this question');
    expect(modal(root)!.querySelector('[data-qm-ready]')?.textContent).toBe('Ready to copy: 1 answer');
  });

  it('copies only this question with its answer and requests through the copy option, unsaved text included', async () => {
    const root = await planning();
    click(root, '[data-plan-question="s2.q1"]');
    typeInto(modal(root)!.querySelector('textarea')!, 'Beside it.');
    click(modal(root)!, '[data-qm="done"]');
    click(root, '[data-plan-question="s1.q1"]');
    typeInto(modal(root)!.querySelector('textarea')!, 'Only the checked-out one.');
    click(modal(root)!, '[data-qm="flow"]');
    one(root).click();
    await flush();
    expect(copies).toHaveLength(1);
    expect(copies[0]).toContain('Lantern plan plan-on-the-map');
    expect(copies[0]).toContain('lantern-plan skill');
    expect(copies[0]).toContain('s1.q1: Do plans on other branches show, or only the checked-out one?\nAnswer: Only the checked-out one.\nRequest: draw the flow for s1.q1');
    expect(copies[0]).not.toContain('s2.q1:');
    expect(one(root).textContent).toBe('Copied');
    expect(modal(root)!.querySelector('[data-qm="copy"]')?.textContent).toBe('Copy for the agent');
  });

  it('does not make the panel copy button say Copied after the modal closes', async () => {
    const root = await planning();
    click(root, '[data-plan-question="s1.q1"]');
    typeInto(modal(root)!.querySelector('textarea')!, 'Only one.');
    one(root).click();
    await flush();
    click(modal(root)!, '[data-qm="done"]');
    expect(planPane(root).querySelector('[data-plan-copy]')?.textContent).not.toContain('Copied');
  });

  it('leaves the combined copy carrying every question', async () => {
    const root = await planning();
    click(root, '[data-plan-question="s2.q1"]');
    typeInto(modal(root)!.querySelector('textarea')!, 'Beside it.');
    click(modal(root)!, '[data-qm="done"]');
    click(root, '[data-plan-question="s1.q1"]');
    typeInto(modal(root)!.querySelector('textarea')!, 'Only one.');
    click(modal(root)!, '[data-qm="copy"]');
    await flush();
    expect(copies[0]).toContain('s1.q1:');
    expect(copies[0]).toContain('s2.q1:');
  });
});

describe('Show on the plan', () => {
  it('closes the modal and marks the files the question names in the Files view', async () => {
    const root = await planning();
    view(root, 'files')!.click();
    await flush();
    expect(hitFiles(root)).toEqual([]);
    click(root, '[data-plan-question="s1.q1"]');
    click(modal(root)!, '[data-qm="show"]');
    await flush();
    expect(modal(root)).toBeNull();
    expect(hitFiles(root)).toContain('src/main/lantern.ts');
    expect(hitFiles(root)).not.toContain('src/main/main.ts');
    expect(planPane(root).querySelector('.pl-pickrow')?.textContent).toContain('Marked on the right. Names 0 areas, 0 features, 1 file');
  });

  it('marks the blocks of the question in the Macro view, and keeps the mark when pressed twice', async () => {
    const root = await planning();
    click(root, '[data-plan-question="s1.q1"]');
    click(modal(root)!, '[data-qm="show"]');
    await flush();
    const lit = () => [...root.querySelectorAll('.lt-macroview-host .lt-macroview .mv-item.is-lit')].map((item) => item.getAttribute('data-key')).sort();
    expect(lit()).toContain('block:lantern-map');
    click(root, '[data-plan-question="s1.q1"]');
    click(modal(root)!, '[data-qm="show"]');
    await flush();
    expect(lit()).toContain('block:lantern-map');
  });

  it('falls back to the files of the stage when the question names none', async () => {
    const root = await planning(PLAN_TEXT.replace('#touch file src/main/lantern.ts\n#answer', '#answer'));
    view(root, 'files')!.click();
    await flush();
    click(root, '[data-plan-question="s1.q1"]');
    click(modal(root)!, '[data-qm="show"]');
    await flush();
    expect(hitFiles(root)).toEqual(expect.arrayContaining(['src/main/lantern-prs.ts', 'src/main/lantern.ts', 'src/main/main.ts', 'src/main/lantern-plans.ts']));
  });
});

describe('the modal and the rest of the view', () => {
  it('closes when the plan is left, and leaves the plan panel as its only child of the pane', async () => {
    const root = await planning();
    click(root, '[data-plan-question="s1.q1"]');
    expect([...planPane(root).children].map((child) => child.className)).toEqual(['pl-panel']);
    click(root, '[data-plan-close]');
    await flush();
    expect(modal(root)).toBeNull();
  });
});
