// @vitest-environment jsdom
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { MacroLoad } from '../src/main/lantern-macro-load';
import type { LanternFlowStory, LanternMap } from '../src/main/lantern';
import { parsePrRecord } from '../src/main/lantern-pr-parse';
import { MACRO_MIN_FILES } from '../src/renderer/lib/lanternmacro';
import { mountLanternView } from '../src/renderer/lib/lanternview';
import { macroFixtureBlocks, macroFixtureView, repoFeatureTexts } from './helpers/lantern-macro-fixture';
import { FILES_MAX, FLOW_STORY, FLOW_STORY_VALUE, STEPS_MAX, STORIES_MAX, TEXT_MAX } from './helpers/lantern-flow-cases';
import { mapOf, node, pr } from './helpers/lantern-map';
import { PR_ID, demoFlow, prReviewDemo, richFlow } from './fixtures/graph/pr-review-demo';

const mounted: ReturnType<typeof mountLanternView>[] = [];
const NODES = [node('src/a.ts', 'service'), node('src/b.ts', 'util')];
const FILES = [{ path: 'src/a.ts', kind: 'modified' as const, mapped: true, reason: 'Reads the permission.' }];
const withFlow = (flow?: LanternFlowStory[], extra: Partial<Parameters<typeof pr>[1]> = {}) => mapOf({ nodes: NODES, prs: [pr('7', { files: FILES, ...(flow ? { flow } : {}), ...extra })] });
const macroLoad: MacroLoad = { ok: true, view: macroFixtureView(), texts: repoFeatureTexts(), blockByPath: macroFixtureBlocks(), minStrongEdge: 8 };

afterEach(() => {
  mounted.splice(0).forEach((one) => { one.dispose(); });
  document.body.replaceChildren();
});

function mount(map: LanternMap, opts: Parameters<typeof mountLanternView>[2] = {}) {
  const root = document.createElement('div');
  document.body.appendChild(root);
  const view = mountLanternView(root, map, { pr: '7', ...opts });
  mounted.push(view);
  return { root, view };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const control = (root: HTMLElement, which: 'files' | 'macro' | 'flow') => root.querySelector<HTMLButtonElement>(`.lt-viewbar [data-view="${which}"]`);
const rows = (root: HTMLElement) => [...root.querySelectorAll<HTMLElement>('.lt-flow .lt-flow-row')];
const kindsOf = (row: HTMLElement) => [...row.querySelectorAll<HTMLElement>(':scope > .lt-flow-step')].map((step) => step.dataset.kind);
const blockText = (step: Element) => step.querySelector('.lt-flow-text')?.textContent ?? '';

describe('the Flow switch', () => {
  it('is offered next to Files and Macro when a pull request is open', () => {
    const { root } = mount(withFlow([FLOW_STORY_VALUE as LanternFlowStory]));

    expect([...root.querySelectorAll('.lt-viewbar [data-view]')].map((button) => button.getAttribute('data-view'))).toEqual(['files', 'flow']);
    expect(control(root, 'files')?.getAttribute('aria-pressed')).toBe('true');
    expect(control(root, 'flow')?.disabled).toBe(false);
    expect(control(root, 'flow')?.getAttribute('aria-pressed')).toBe('false');
  });

  it('sits between Macro and the rest on a map big enough for Macro', () => {
    const big = mapOf({ nodes: Array.from({ length: MACRO_MIN_FILES + 1 }, (_, i) => node(`src/f${i}.ts`, 'util')), prs: [pr('7', { files: FILES, flow: [FLOW_STORY_VALUE as LanternFlowStory] })] });
    const { root } = mount(big, { readMacro: () => Promise.resolve(macroLoad) });

    expect([...root.querySelectorAll('.lt-viewbar [data-view]')].map((button) => button.getAttribute('data-view'))).toEqual(['files', 'macro', 'flow']);
  });

  it('is not there outside pull request mode', () => {
    const { root } = mount(withFlow([FLOW_STORY_VALUE as LanternFlowStory]), { pr: '' });

    expect(control(root, 'flow')).toBeNull();
    expect(root.querySelector<HTMLElement>('.lt-viewbar')?.hidden).toBe(true);
  });

  it('is not there for a map big enough for Macro until a pull request is picked', () => {
    const big = mapOf({ nodes: Array.from({ length: MACRO_MIN_FILES + 1 }, (_, i) => node(`src/f${i}.ts`, 'util')), prs: [pr('7', { files: FILES, flow: [FLOW_STORY_VALUE as LanternFlowStory] })] });
    const { root } = mount(big, { pr: '', readMacro: () => Promise.resolve(macroLoad) });

    expect([...root.querySelectorAll('.lt-viewbar [data-view]')].map((button) => button.getAttribute('data-view'))).toEqual(['files', 'macro']);
  });

  it('is disabled with a one-line reason when the pull request has no flow', () => {
    const { root } = mount(withFlow());

    const flow = control(root, 'flow');
    expect(flow?.disabled).toBe(true);
    expect(root.querySelector('.lt-flow-reason')?.textContent).toBe('No flow recorded for this pull request.');
    expect(flow?.getAttribute('aria-describedby')).toBe(root.querySelector('.lt-flow-reason')?.id);
    flow?.click();
    expect(root.querySelector<HTMLElement>('.lt-flow')?.hidden).toBe(true);
  });

  it('keeps the reason ids apart when two views are mounted', () => {
    const first = mount(withFlow());
    const second = mount(withFlow());

    const ids = [first, second].map(({ root }) => root.querySelector('.lt-flow-reason')?.id);
    expect(ids[0]).not.toBe(ids[1]);
    expect(control(second.root, 'flow')?.getAttribute('aria-describedby')).toBe(ids[1]);
  });

  it('says why when the record holds a flow it could not read', () => {
    const { root } = mount(withFlow(undefined, { flowError: 'line 12: #step unknown kind "person"' }));

    expect(control(root, 'flow')?.disabled).toBe(true);
    expect(root.querySelector('.lt-flow-reason')?.textContent).toBe('The flow in this record could not be read: line 12: #step unknown kind "person"');
  });
});

describe('the Flow view', () => {
  it('draws the stories as rows of blocks, in the order and with the kinds of the record', () => {
    const { root } = mount(withFlow(demoFlow));
    control(root, 'flow')?.click();

    const stories = [...root.querySelectorAll('.lt-flow-story')];
    expect(stories.map((story) => story.querySelector('.lt-flow-title')?.textContent)).toEqual(demoFlow.map((story) => story.title));
    const first = [...stories[0].querySelectorAll<HTMLElement>('.lt-flow-row')];
    expect(first.map(kindsOf)).toEqual([
      ['actor', 'action', 'subject'],
      ['actor', 'interaction', 'consequence'],
    ]);
    expect([...first[0].querySelectorAll('.lt-flow-step')].map(blockText)).toEqual(['Admin', 'changes permissions of', 'another user']);
    expect([...first[1].querySelectorAll('.lt-flow-step')].slice(0, 2).map(blockText)).toEqual(['Another user', 'can now refund orders']);
    expect(rows(root).map(kindsOf)).toEqual([
      ['actor', 'action', 'subject'],
      ['actor', 'interaction', 'consequence'],
      ['actor', 'action', 'subject'],
      ['interaction', 'consequence'],
    ]);
  });

  it('puts the row below under the first row, labelled with who it is about', () => {
    const { root } = mount(withFlow(demoFlow));
    control(root, 'flow')?.click();

    const story = root.querySelector('.lt-flow-story') as HTMLElement;
    const [top, below] = story.querySelectorAll<HTMLElement>('.lt-flow-row');
    expect(below.classList.contains('lt-flow-below')).toBe(true);
    expect(top.compareDocumentPosition(below) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const label = story.querySelector(`#${below.getAttribute('aria-labelledby')}`);
    expect(label?.textContent).toBe('↓Then, for another user');
  });

  it('draws an arrow into every block but the first of a row, hidden from screen readers', () => {
    const { root } = mount(withFlow(demoFlow));
    control(root, 'flow')?.click();

    for (const row of rows(root)) {
      const steps = [...row.querySelectorAll(':scope > .lt-flow-step')];
      const arrows = [...row.querySelectorAll(':scope > .lt-flow-step > .lt-flow-arrow')];
      expect(arrows).toHaveLength(steps.length - 1);
      expect(arrows.every((arrow) => arrow.getAttribute('aria-hidden') === 'true')).toBe(true);
      expect(steps[0].querySelector(':scope > .lt-flow-arrow')).toBeNull();
      expect(steps.slice(1).every((step) => step.firstElementChild?.classList.contains('lt-flow-arrow'))).toBe(true);
    }
  });

  it('numbers the stories in a header beside the title when there are several, hidden from screen readers', () => {
    const { root } = mount(withFlow(demoFlow));
    control(root, 'flow')?.click();

    const heads = [...root.querySelectorAll<HTMLElement>('.lt-flow-story > .lt-flow-head')];
    expect(heads).toHaveLength(demoFlow.length);
    expect(heads.map((head) => head.querySelector('.lt-flow-index')?.textContent)).toEqual(['1', '2']);
    expect(heads.every((head) => head.querySelector('.lt-flow-index')?.getAttribute('aria-hidden') === 'true')).toBe(true);
    expect(heads.every((head) => head.querySelector('.lt-flow-index')?.nextElementSibling?.tagName === 'H2')).toBe(true);
    expect(root.querySelector('.lt-flow-story')?.getAttribute('aria-labelledby')).toBe(heads[0].querySelector('h2')?.id);
  });

  it('draws a plain marker, not a number, for a flow of one story', () => {
    const { root } = mount(withFlow([demoFlow[0]]));
    control(root, 'flow')?.click();

    expect(root.querySelector('.lt-flow-index')?.textContent).toBe('');
  });

  it('gives a step the old text before the new one, each under its own tag', () => {
    const { root } = mount(withFlow(demoFlow));
    control(root, 'flow')?.click();

    const pair = root.querySelector('.lt-flow-consequence .lt-flow-pair') as HTMLElement;
    expect([...pair.children].map((part) => part.className)).toEqual(['lt-flow-old', 'lt-flow-new']);
  });

  it('gives an actor a person icon, and no other block', () => {
    const { root } = mount(withFlow(demoFlow));
    control(root, 'flow')?.click();

    const steps = [...root.querySelectorAll<HTMLElement>('.lt-flow-step')];
    for (const step of steps) expect(step.querySelector('.lt-flow-person') !== null).toBe(step.dataset.kind === 'actor');
    expect(root.querySelector('.lt-flow-person')?.getAttribute('aria-hidden')).toBe('true');
  });

  it('shows a consequence as an old and a new text, the old one struck and the new one emphasised', () => {
    const { root } = mount(withFlow(demoFlow));
    control(root, 'flow')?.click();

    const consequence = root.querySelector('.lt-flow-consequence') as HTMLElement;
    expect(consequence.querySelector('.lt-flow-old del')?.textContent).toBe('could only view orders');
    expect(consequence.querySelector('.lt-flow-new strong')?.textContent).toBe('can refund orders');
    expect(consequence.querySelector('.lt-flow-old .lt-flow-tag')?.textContent).toBe('Old');
    expect(consequence.querySelector('.lt-flow-new .lt-flow-tag')?.textContent).toBe('New');
  });

  it('writes text as text, never as markup', () => {
    const { root } = mount(withFlow([{ title: '<img src=x onerror=alert(1)>', steps: [{ kind: 'actor', text: '<b>Admin</b>' }], below: [{ kind: 'consequence', old: '"a" & b', new: '<i>c</i>' }] }]));
    control(root, 'flow')?.click();

    expect(root.querySelector('.lt-flow img, .lt-flow b, .lt-flow i')).toBeNull();
    expect(root.querySelector('.lt-flow-title')?.textContent).toBe('<img src=x onerror=alert(1)>');
    expect(root.querySelector('.lt-flow-new strong')?.textContent).toBe('<i>c</i>');
  });

  it('is a labelled region that reads as headings and lists', () => {
    const { root } = mount(withFlow(demoFlow));
    control(root, 'flow')?.click();

    expect(root.querySelector('.lt-flow-view')?.getAttribute('aria-label')).toBe('Flow of pull request #7');
    const story = root.querySelector('.lt-flow-story') as HTMLElement;
    expect(story.getAttribute('aria-labelledby')).toBe(story.querySelector('h2')?.id);
    expect(rows(root).every((row) => row.tagName === 'OL')).toBe(true);
  });

  it('replaces the graph while it is on, and Files brings it back', () => {
    const { root } = mount(withFlow(demoFlow));
    const host = root.querySelector('.lt-pixi-host') as HTMLElement;

    control(root, 'flow')?.click();
    expect(control(root, 'flow')?.getAttribute('aria-pressed')).toBe('true');
    expect(control(root, 'files')?.getAttribute('aria-pressed')).toBe('false');
    expect(root.querySelector<HTMLElement>('.lt-flow')?.hidden).toBe(false);
    expect(host.hidden).toBe(true);
    expect(root.querySelector<HTMLElement>('.lt-rvbar')?.hidden).toBe(true);
    expect(root.querySelector<HTMLElement>('.lt-tabs')?.hidden).toBe(true);
    expect(root.querySelector('.lt-main')?.classList.contains('lt-flow-on')).toBe(true);

    control(root, 'files')?.click();
    expect(control(root, 'files')?.getAttribute('aria-pressed')).toBe('true');
    expect(root.querySelector<HTMLElement>('.lt-flow')?.hidden).toBe(true);
    expect(host.hidden).toBe(false);
    expect(root.querySelector('.lt-main')?.classList.contains('lt-flow-on')).toBe(false);
  });

  it('keeps the keyboard on the switch after it is pressed', () => {
    const { root } = mount(withFlow(demoFlow));

    control(root, 'flow')?.click();

    expect(document.activeElement).toBe(control(root, 'flow'));
  });

  it('turns Macro off when Flow is picked, and the other way round', async () => {
    const big = mapOf({ nodes: Array.from({ length: MACRO_MIN_FILES + 1 }, (_, i) => node(`src/f${i}.ts`, 'util')), prs: [pr('7', { files: FILES, flow: demoFlow })] });
    const { root } = mount(big, { readMacro: () => Promise.resolve(macroLoad) });

    control(root, 'macro')?.click();
    await flush();
    control(root, 'flow')?.click();
    expect(control(root, 'macro')?.getAttribute('aria-pressed')).toBe('false');
    expect(control(root, 'flow')?.getAttribute('aria-pressed')).toBe('true');
    expect(root.querySelectorAll('.lt-flow-story')).toHaveLength(demoFlow.length);

    control(root, 'macro')?.click();
    await flush();
    expect(control(root, 'flow')?.getAttribute('aria-pressed')).toBe('false');
    expect(root.querySelector<HTMLElement>('.lt-flow')?.hidden).toBe(true);
  });

  it('steps back to Files when the pull request changes to one without a flow, and when it is left', () => {
    const map = mapOf({ nodes: NODES, prs: [pr('7', { files: FILES, flow: demoFlow }), pr('8', { files: FILES })] });
    const { root } = mount(map);
    control(root, 'flow')?.click();

    (root.querySelector('.pr-chip[data-pr="8"]') as HTMLElement).click();

    expect(control(root, 'flow')?.disabled).toBe(true);
    expect(control(root, 'files')?.getAttribute('aria-pressed')).toBe('true');
    expect(root.querySelector<HTMLElement>('.lt-flow')?.hidden).toBe(true);

    (root.querySelector('.pr-chip[data-pr="7"]') as HTMLElement).click();
    control(root, 'flow')?.click();
    (root.querySelector('.pr-chip[data-pr="7"]') as HTMLElement).click();
    expect(control(root, 'flow')).toBeNull();
    expect(root.querySelector<HTMLElement>('.lt-flow')?.hidden).toBe(true);
  });

  it('follows the pull request when the app reloads it with a new flow', () => {
    const { root, view } = mount(withFlow(demoFlow));
    control(root, 'flow')?.click();

    view.update(withFlow([demoFlow[1]]));

    expect(root.querySelectorAll('.lt-flow-story')).toHaveLength(1);
    expect(root.querySelector('.lt-flow-title')?.textContent).toBe(demoFlow[1].title);

    view.update(withFlow());
    expect(control(root, 'flow')?.disabled).toBe(true);
    expect(root.querySelector<HTMLElement>('.lt-flow')?.hidden).toBe(true);
  });

  it('keeps the file list and the review pane of the pull request beside it', () => {
    const { root } = mount(withFlow(demoFlow));
    control(root, 'flow')?.click();

    expect(root.querySelectorAll('.lt-side .pr-file')).toHaveLength(FILES.length);
    expect(root.querySelector('.lt-review')).not.toBeNull();
  });
});

describe('the demo pull request', () => {
  it('carries the example flow: an admin, what they change, who it is done to, then what that user can do', () => {
    const { root } = mount(prReviewDemo, { pr: PR_ID });
    control(root, 'flow')?.click();

    const [top, below] = [...root.querySelectorAll('.lt-flow-story')][0].querySelectorAll<HTMLElement>('.lt-flow-row');
    expect([...top.querySelectorAll('.lt-flow-step')].map((step) => [step.getAttribute('data-kind'), blockText(step)])).toEqual([
      ['actor', 'Admin'],
      ['action', 'changes permissions of'],
      ['subject', 'another user'],
    ]);
    expect(kindsOf(below)).toEqual(['actor', 'interaction', 'consequence']);
    expect(below.querySelector('.lt-flow-old')?.textContent).toContain('could only view orders');
    expect(below.querySelector('.lt-flow-new')?.textContent).toContain('can refund orders');
  });
});

describe('the rich demo flow', () => {
  const paths = new Set(prReviewDemo.prs[0].files.map((file) => file.path));
  const everyStep = richFlow.flatMap((story) => [...story.steps, ...story.below]);

  it('stays inside the limits of the record format, so the demo shows what an agent can write', () => {
    expect(richFlow.length).toBeLessThanOrEqual(STORIES_MAX);
    for (const story of richFlow) {
      expect(story.steps.length).toBeLessThanOrEqual(STEPS_MAX);
      expect(story.below.length).toBeLessThanOrEqual(STEPS_MAX);
      expect(story.title.length).toBeLessThanOrEqual(TEXT_MAX);
    }
    for (const step of everyStep) {
      const texts = step.kind === 'consequence' ? [step.old, step.new] : [step.text];
      for (const text of texts) expect(text.length).toBeLessThanOrEqual(TEXT_MAX);
      expect(step.files?.length ?? 0).toBeLessThanOrEqual(FILES_MAX);
      for (const file of step.files ?? []) expect(paths.has(file)).toBe(true);
    }
  });

  it('draws a story with five steps in a row and long texts, numbered after the others', () => {
    const { root } = mount(mapOf({ nodes: NODES, prs: [pr('7', { files: FILES, flow: richFlow })] }));
    control(root, 'flow')?.click();

    expect([...root.querySelectorAll('.lt-flow-index')].map((mark) => mark.textContent)).toEqual(['1', '2', '3']);
    expect(kindsOf(rows(root)[4])).toEqual(['actor', 'action', 'subject', 'action', 'subject']);
    expect(root.querySelectorAll('.lt-flow-story')).toHaveLength(richFlow.length);
  });
});

describe('from the record to the view', () => {
  const record = `${[
    'lantern-pr 1',
    '# 7',
    '#title Refunds',
    '#url https://x.test/7',
    '#branch feat/refunds',
    '#base main',
    '#opened 2026-10-21',
    `#head ${'a'.repeat(40)}`,
    '~ src/a.ts',
    '#reason src/a.ts Reads the permission.',
    ...FLOW_STORY,
  ].join('\n')}\n`;

  it('draws every block of the record in the order it was written, with its kind', () => {
    const parsed = parsePrRecord(record, '7.pr').pr;
    const { root } = mount(mapOf({ nodes: NODES, prs: [pr('7', { files: FILES, flow: parsed?.flow })] }));
    control(root, 'flow')?.click();

    expect(rows(root).map(kindsOf)).toEqual([
      ['actor', 'action', 'subject'],
      ['actor', 'interaction', 'consequence'],
    ]);
    expect([...root.querySelectorAll('.lt-flow-step')].map((step) => step.querySelector('.lt-flow-text')?.textContent ?? `${step.querySelector('.lt-flow-old')?.textContent}|${step.querySelector('.lt-flow-new')?.textContent}`)).toEqual([
      'Admin',
      'changes permissions of',
      'another user',
      'Another user',
      'can now refund orders',
      'Old could only view orders|New can refund orders',
    ]);
  });

  it('loses nothing when two steps swap places in the record: the view swaps them too', () => {
    const swapped = record.replace('#step action changes permissions of\n#step subject another user', '#step subject another user\n#step action changes permissions of');
    const parsed = parsePrRecord(swapped, '7.pr').pr;
    const { root } = mount(mapOf({ nodes: NODES, prs: [pr('7', { files: FILES, flow: parsed?.flow })] }));
    control(root, 'flow')?.click();

    expect(kindsOf(rows(root)[0])).toEqual(['actor', 'subject', 'action']);
  });
});

describe('the flow at the narrowest right pane', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'lantern-flow.css'), 'utf8');
  const rule = (selector: string) => new RegExp(`(?:^|\\n)${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`).exec(css)?.[1] ?? '';

  it('wraps a row onto the next line instead of overflowing the pane', () => {
    expect(rule('.lt-flow-row')).toMatch(/display:\s*flex/);
    expect(rule('.lt-flow-row')).toMatch(/flex-wrap:\s*wrap/);
  });

  it('lets a block and the old and new pair shrink and break long words', () => {
    expect(rule('.lt-flow-step')).toMatch(/min-width:\s*0/);
    expect(rule('.lt-flow-step')).toMatch(/max-width:\s*100%/);
    expect(rule('.lt-flow-block')).toMatch(/min-width:\s*0/);
    expect(rule('.lt-flow-block')).toMatch(/overflow-wrap:\s*anywhere/);
    expect(rule('.lt-flow-pair')).toMatch(/flex-wrap:\s*wrap/);
  });

  it('takes its colours, type sizes and radius from the app tokens, never fixed values', () => {
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(css).not.toMatch(/\b\d+px\s*\/|font-size:\s*\d/);
    expect(css).toMatch(/var\(--lt-surface\)/);
    expect(css).toMatch(/var\(--fs-base\)/);
    expect(css).toMatch(/var\(--radius-sm\)/);
  });

  it('stacks the steps of a row into one column when the pane is narrow, measured on the flow and not on the window', () => {
    expect(css).toMatch(/\.lt-flow-view\s*\{[^}]*container:\s*lt-flow\s*\/\s*inline-size/);
    const narrow = /@container lt-flow \(max-width:\s*\d+px\)\s*\{([\s\S]*?)\n\}/.exec(css)?.[1] ?? '';
    expect(narrow).toMatch(/\.lt-flow-row\s*\{[^}]*flex-direction:\s*column/);
    expect(narrow).toMatch(/\.lt-flow-step\s*\{[^}]*flex-direction:\s*column/);
  });

  it('shows keyboard focus on a step and on a file with the amber ring, and stills its motion on request', () => {
    expect(rule('.lt-flow-block[data-flow-step]:focus-visible')).toMatch(/outline:\s*2px solid var\(--lt-glow\)/);
    expect(rule('.lt-flow-file:focus-visible')).toMatch(/outline:\s*2px solid var\(--lt-glow\)/);
    expect(rule('.pr-flowmark button:focus-visible')).toMatch(/outline:\s*2px solid var\(--lt-glow\)/);
    const calm = /@media \(prefers-reduced-motion: reduce\)\s*\{([\s\S]*?)\n\}/.exec(css)?.[1] ?? '';
    for (const moving of ['.lt-flow-block', '.lt-flow-file', '.lt-flow-calm']) expect(calm).toContain(moving);
    expect(calm).toMatch(/transition:\s*none/);
  });

  it('hides the graph zoom beside the flow in the review layout, where it is a child of the grid', () => {
    expect(css).toMatch(/\.lt-grid:has\(\.lt-main\.lt-flow-on\) \.lt-zoom/);
  });

  it('marks a file chip by what happened to it with the signs the review list uses', () => {
    expect(rule('.lt-flow-file-added::before')).toContain('"+"');
    expect(rule('.lt-flow-file-modified::before')).toContain('"~"');
    expect(rule('.lt-flow-file-removed::before')).toContain('"−"');
  });

  it('is loaded by the app window', () => {
    expect(fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'workspace.html'), 'utf8')).toContain('lantern-flow.css');
    expect(fs.readFileSync(path.join(__dirname, '..', 'scripts', 'esbuild.mjs'), 'utf8')).toContain("'lantern-flow.css'");
  });
});
