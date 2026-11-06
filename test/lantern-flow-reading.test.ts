// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import type { LanternFlowStory } from '../src/main/lantern';
import { mountLanternView } from '../src/renderer/lib/lanternview';
import type { ViewOptions } from '../src/renderer/lib/lanternview';
import { mapOf, node, pr } from './helpers/lantern-map';

const PR_ID = '7';
const A = 'src/a.ts';
const B = 'src/b.ts';
const C = 'src/c.ts';
const D = 'src/d.ts';
const files = [A, B, C, D].map((path) => ({ path, kind: 'modified' as const, mapped: true }));

const story: LanternFlowStory = {
  title: 'Alice checks out',
  steps: [
    { kind: 'actor', text: 'Alice', files: [A, B] },
    { kind: 'action', text: 'pays' },
    { kind: 'subject', text: 'the cart', files: [B] },
  ],
  below: [{ kind: 'consequence', old: 'EUR 1', new: '€1', files: [C] }],
};

const readers: ViewOptions = {
  readFile: async (path) => ({ exists: true, text: `live ${path}\n`, truncated: 0 }),
  readPrFile: async (_pr, path) => ({ ok: true, text: `branch ${path}\n`, truncated: false, binary: false, version: 'branch' }),
  readPrDiff: async (_pr, path) => ({ ok: true, diff: `@@ -1 +1 @@\n-old ${path}\n+new ${path}`, truncated: false, binary: false }),
};

const mounted: ReturnType<typeof mountLanternView>[] = [];
afterEach(() => {
  mounted.splice(0).forEach((one) => { one.dispose(); });
  document.body.replaceChildren();
});

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

async function mountFlow() {
  const root = document.createElement('div');
  document.body.appendChild(root);
  const map = mapOf({ project: 'demo', nodes: files.map((f) => node(f.path, 'service')), prs: [pr(PR_ID, { ordered: true, files, flow: [story] })] });
  mounted.push(mountLanternView(root, map, { pr: PR_ID, ...readers }));
  await flush();
  control(root, 'flow').click();
  return root;
}

const control = (root: HTMLElement, which: 'files' | 'macro' | 'flow') => root.querySelector<HTMLButtonElement>(`.lt-viewbar [data-view="${which}"]`) as HTMLButtonElement;
const pane = (root: HTMLElement) => root.querySelector('.lt-review') as HTMLElement;
const shown = (root: HTMLElement) => pane(root).querySelector('.lt-code-path')?.getAttribute('data-tip');
const listRow = (root: HTMLElement, path: string) => root.querySelector(`.lt-side [data-pr-go="${path}"]`) as HTMLElement;
const steps = (root: HTMLElement) => [...root.querySelectorAll<HTMLElement>('.lt-flow-step')];
const label = (step: HTMLElement) => step.querySelector('.lt-flow-text, .lt-flow-new strong')?.textContent;
const readingSteps = (root: HTMLElement) => steps(root).filter((step) => step.classList.contains('lt-flow-reading')).map(label);
const badges = (root: HTMLElement) => [...root.querySelectorAll('.lt-flow-reading-badge')];
const calm = (root: HTMLElement) => root.querySelector('.lt-flow-view')?.classList.contains('lt-flow-calm');
const note = (root: HTMLElement) => root.querySelector<HTMLElement>('.lt-viewbar .lt-flow-note');
const noteText = (root: HTMLElement) => (note(root)?.hidden ? '' : (note(root)?.textContent ?? ''));
const next = (root: HTMLElement) => pane(root).querySelector<HTMLElement>('.lt-step-next') as HTMLElement;
const arrow = (root: HTMLElement, key: string) => pane(root).dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
const chip = (root: HTMLElement, path: string) => root.querySelector<HTMLElement>(`.lt-flow-file[data-flow-open="${path}"]`) as HTMLElement;
const pickable = (root: HTMLElement) => [...root.querySelectorAll<HTMLElement>('.lt-flow-block[data-flow-step]')];

describe('the Flow view while a file is open in the review pane', () => {
  it('marks and greys nothing, and says nothing, while no file is open', async () => {
    const root = await mountFlow();

    expect(readingSteps(root)).toEqual([]);
    expect(badges(root)).toHaveLength(0);
    expect(calm(root)).toBe(false);
    expect(noteText(root)).toBe('');
  });

  it('marks exactly the steps that reference the open file and greys the others', async () => {
    const root = await mountFlow();

    listRow(root, B).click();
    await flush();

    expect(shown(root)).toBe(B);
    expect(readingSteps(root)).toEqual(['Alice', 'the cart']);
    expect(badges(root)).toHaveLength(2);
    expect(calm(root)).toBe(true);
    const dimmed = steps(root).filter((step) => !step.classList.contains('lt-flow-reading')).map(label);
    expect(dimmed).toEqual(['pays', '€1']);
  });

  it('gives the marker an accessible name and the READING text of the Macro view', async () => {
    const root = await mountFlow();

    listRow(root, A).click();
    await flush();

    const badge = badges(root)[0];
    expect(badge.textContent).toBe('READING');
    expect(badge.getAttribute('aria-label')).toMatch(/^Reading:/);
    expect(badge.closest('.lt-flow-block')?.getAttribute('data-flow-step')).toBe('0:steps:0');
  });

  it('moves the marker to the new step when the stepper goes to the next file, and leaves nothing on the old one', async () => {
    const root = await mountFlow();
    listRow(root, A).click();
    await flush();
    expect(readingSteps(root)).toEqual(['Alice']);

    next(root).click();
    await flush();
    expect(shown(root)).toBe(B);
    expect(readingSteps(root)).toEqual(['Alice', 'the cart']);

    next(root).click();
    await flush();
    expect(shown(root)).toBe(C);
    expect(readingSteps(root)).toEqual(['€1']);
    expect(badges(root)).toHaveLength(1);
    expect(steps(root)[0].querySelector('.lt-flow-reading-badge')).toBeNull();
  });

  it('moves the marker with the arrow keys of the review pane', async () => {
    const root = await mountFlow();
    listRow(root, B).click();
    await flush();

    arrow(root, 'ArrowRight');
    await flush();
    expect(shown(root)).toBe(C);
    expect(readingSteps(root)).toEqual(['€1']);

    arrow(root, 'ArrowLeft');
    await flush();
    expect(shown(root)).toBe(B);
    expect(readingSteps(root)).toEqual(['Alice', 'the cart']);
  });

  it('moves the marker when a chip opens another file', async () => {
    const root = await mountFlow();
    listRow(root, A).click();
    await flush();

    chip(root, C).click();
    await flush();

    expect(shown(root)).toBe(C);
    expect(readingSteps(root)).toEqual(['€1']);
  });

  it('marks no step and greys none for a file that no step references, and names that file in the note', async () => {
    const root = await mountFlow();
    listRow(root, C).click();
    await flush();
    expect(noteText(root)).toBe('');

    next(root).click();
    await flush();

    expect(shown(root)).toBe(D);
    expect(readingSteps(root)).toEqual([]);
    expect(badges(root)).toHaveLength(0);
    expect(calm(root)).toBe(false);
    expect(noteText(root)).toBe('No flow step mentions d.ts');
  });

  it('shows the note only on Flow, and the marker returns when Flow is shown again', async () => {
    const root = await mountFlow();
    listRow(root, D).click();
    await flush();
    expect(noteText(root)).toContain('d.ts');

    control(root, 'files').click();
    expect(root.querySelector('.lt-flow-reading')).toBeNull();
    expect(noteText(root)).toBe('');

    listRow(root, B).click();
    await flush();
    control(root, 'flow').click();
    expect(readingSteps(root)).toEqual(['Alice', 'the cart']);
    expect(noteText(root)).toBe('');
  });

  it('shows the picked step and the reading step together, even when they are the same step', async () => {
    const root = await mountFlow();
    listRow(root, A).click();
    await flush();

    pickable(root)[0].click();

    const actor = steps(root)[0];
    expect(actor.classList.contains('lt-flow-picked')).toBe(true);
    expect(actor.classList.contains('lt-flow-reading')).toBe(true);
    expect(actor.querySelector('.lt-flow-block')?.getAttribute('aria-pressed')).toBe('true');
    expect(actor.querySelector('.lt-flow-reading-badge')).not.toBeNull();
    expect(readingSteps(root)).toEqual(['Alice']);
  });

  it('keeps the marker on its step while another step is picked', async () => {
    const root = await mountFlow();
    listRow(root, A).click();
    await flush();

    pickable(root)[2].click();

    expect(readingSteps(root)).toEqual(['Alice']);
    expect(steps(root).filter((step) => step.classList.contains('lt-flow-picked')).map(label)).toEqual(['€1']);
  });
});
