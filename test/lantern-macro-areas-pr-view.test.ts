// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LanternNode, LanternRelation } from '../src/main/lantern';
import type { MacroLoad } from '../src/main/lantern-macro-load';
import { areaOfFeature } from '../src/renderer/lib/lanternmacroareas';
import { mountLanternView } from '../src/renderer/lib/lanternview';
import type { ViewOptions } from '../src/renderer/lib/lanternview';
import { macroFixtureRecords, repoPrRecord } from './helpers/lantern-macro-fixture';
import { areasPayload } from './helpers/lantern-macro-areas-payload';
import { mapOf, node, pr } from './helpers/lantern-map';
import { WIDE_PANE, dive, flagged, label, pick, sizeTheMacroViewPane } from './helpers/macroview-host';

const PR_ID = '108';
const payload = areasPayload();
const areas = payload.areas!;
const records = macroFixtureRecords();
const nodes = records.map((r): LanternNode => node(r.path, r.role, { feature: r.feature }));
const relations = records.flatMap((r): LanternRelation[] => r.relations.map((x) => ({ from: r.path, arrow: x.arrow, to: x.to, ext: x.ext, symbol: null, label: '' })));
const record = repoPrRecord(PR_ID);
const changedFiles = record.files.map((f) => ({ ...f, mapped: nodes.some((n) => n.path === f.path) }));
const pathIn = (block: string) => changedFiles.find((f) => payload.blockByPath[f.path] === block)!.path;
const IN_PROJECT_MAP = pathIn('code-insight');
const IN_WORKSPACE = pathIn('projects-hub');
const IN_FOUNDATION = pathIn('core:desktop');
const IN_NO_FEATURE = changedFiles.find((f) => f.mapped && !payload.blockByPath[f.path])!.path;
const NOT_IN_MAP = changedFiles.find((f) => !f.mapped)!.path;
const flowStory = { title: 'A reader opens code', steps: [{ kind: 'actor' as const, text: 'Reader', files: [IN_PROJECT_MAP] }, { kind: 'action' as const, text: 'opens' }, { kind: 'subject' as const, text: 'a file', files: [IN_WORKSPACE] }], below: [] };
const changed = pr(PR_ID, { title: record.title, ordered: record.ordered, files: changedFiles, flow: [flowStory] });
const BIG = mapOf({ project: 'demo', nodes, relations, prs: [changed] });
const ordered = changed.files.map((f) => f.path);

const readers: ViewOptions = {
  readFile: async (path) => ({ exists: true, text: `live ${path}\n`, truncated: 0 }),
  readPrFile: async (_pr, path) => ({ ok: true, text: `branch ${path}\n`, truncated: false, binary: false, version: 'branch' }),
  readPrDiff: async (_pr, path) => ({ ok: true, diff: `@@ -1 +1 @@\n-old ${path}\n+new ${path}`, truncated: false, binary: false }),
};
const prOpts: ViewOptions = { pr: PR_ID, ...readers };

const mounted: ReturnType<typeof mountLanternView>[] = [];

beforeEach(() => sizeTheMacroViewPane());

afterEach(() => {
  mounted.splice(0).forEach((one) => { one.dispose(); });
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const control = (root: HTMLElement, which: 'files' | 'macro' | 'flow') => root.querySelector<HTMLButtonElement>(`.lt-viewbar [data-view="${which}"]`) as HTMLButtonElement;
const lit = (root: HTMLElement) => ['.mv-area', '.mv-entry'].flatMap((kind) => flagged(root, 'is-lit', kind)).sort();
const reading = (root: HTMLElement) => ['.mv-area', '.mv-entry'].flatMap((kind) => flagged(root, 'is-reading', kind)).sort();
const listRow = (root: HTMLElement, path: string) => root.querySelector(`.lt-side-list [data-pr-go="${path}"]`) as HTMLElement;
const note = (root: HTMLElement) => root.querySelector('.lt-overview .lt-open-note')?.textContent ?? '';
const shown = (root: HTMLElement) => (root.querySelector('.lt-review') as HTMLElement).querySelector('.lt-code-path')?.getAttribute('data-tip');
const press = (target: Element, key: string) => target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
const crumbs = (root: HTMLElement) => root.querySelector('.lt-crumbs')?.textContent;

function placeHolding(path: string): string[] {
  const id = payload.blockByPath[path];
  if (!id) return [];
  return [id.startsWith('core:') ? `block:${id}` : `block:${(areaOfFeature(areas, id) as { id: string }).id}`];
}

async function openMacro(map = BIG, opts: ViewOptions = prOpts) {
  const root = document.createElement('div');
  document.body.appendChild(root);
  mounted.push(mountLanternView(root, map, { readMacro: () => Promise.resolve(payload as MacroLoad), ...opts }));
  control(root, 'macro').click();
  await flush();
  return root;
}

describe('pull request marks on the area shapes', () => {
  it('lights the areas that hold a changed file, the To assign area and the foundation entries', async () => {
    const root = await openMacro();

    expect(lit(root)).toEqual(['block:core:desktop', 'block:core:shared', 'block:project-map', 'block:to-assign', 'block:workspace-setup']);
    expect(flagged(root, 'is-lit', '.mv-area')).not.toContain('block:agent-sessions');
    expect(flagged(root, 'is-lit', '.mv-entry')).not.toContain('block:core:skills');
  });

  it('says on a shape how many of its files changed', async () => {
    const root = await openMacro();
    const area = (id: string) => areas.level0.areas.find((candidate) => candidate.id === id)!;

    expect(label(root, 'block:project-map')).toContain(`1 of ${area('project-map').files} files changed in the pull request`);
    expect(label(root, 'block:workspace-setup')).toContain(`4 of ${area('workspace-setup').files} files changed in the pull request`);
    expect(label(root, 'block:to-assign')).toContain(`1 of ${areas.level0.toAssign!.files} files changed in the pull request`);
  });

  it('hides and shows the marks with the PR changes control', async () => {
    const root = await openMacro();
    const toggle = () => root.querySelector('.lt-viewbar [data-prmark]') as HTMLElement;
    expect(toggle().getAttribute('aria-pressed')).toBe('true');

    toggle().click();
    expect(lit(root)).toEqual([]);

    toggle().click();
    expect(lit(root)).toContain('block:project-map');
  });

  it('shows no marks without a pull request', async () => {
    const root = await openMacro(mapOf({ project: 'demo', nodes, relations }), { ...readers });

    expect(lit(root)).toEqual([]);
  });

  it('summarises the pull request in the panel without sending the reader into an area', async () => {
    const root = await openMacro();

    const summary = root.querySelector('.lt-prsum')?.textContent ?? '';
    expect(summary).toContain('lit on the graph');
    expect(summary).not.toContain('Open an area to see');
  });

  it('lists the changed files of a marked area grouped by feature, with their review numbers', async () => {
    const root = await openMacro();

    pick(root, 'block:workspace-setup');

    const side = root.querySelector('.lt-side .lt-detail') as HTMLElement;
    expect(side.querySelector('.lt-pr-changed')?.textContent).toContain('4 of');
    expect([...side.querySelectorAll('.lt-pr-feature')].map((heading) => heading.textContent)).toEqual(['Projects hub 4']);
    expect([...side.querySelectorAll('.pr-files [data-pr-go]')].map((row) => row.getAttribute('data-pr-go')).sort()).toEqual(changedFiles.filter((f) => payload.blockByPath[f.path] === 'projects-hub').map((f) => f.path).sort());
    expect(side.querySelectorAll('.pr-num').length).toBe(4);
  });

  it('lists no changed files for an area the pull request leaves alone', async () => {
    const root = await openMacro();

    pick(root, 'block:agent-sessions');

    expect(root.querySelector('.lt-side .lt-detail .lt-pr-changed')).toBeNull();
  });
});

describe('the reading marker on the area shapes', () => {
  it('sits on the area of the file open in the review pane and dims the others', async () => {
    const root = await openMacro();

    listRow(root, IN_PROJECT_MAP).click();
    await flush();

    expect(reading(root)).toEqual(['block:project-map']);
    expect(label(root, 'block:project-map')).toContain('being read');
    expect(flagged(root, 'is-dim', '.mv-area')).not.toContain('block:project-map');
    expect(flagged(root, 'is-dim', '.mv-area')).toContain('block:pull-request-review');
    expect(flagged(root, 'is-reading', '.mv-area')).not.toContain('block:workspace-setup');
    expect(note(root)).toBe('');
  });

  it('follows the list, moving from one area to the other', async () => {
    const root = await openMacro();
    listRow(root, IN_PROJECT_MAP).click();
    await flush();

    listRow(root, IN_WORKSPACE).click();
    await flush();

    expect(reading(root)).toEqual(['block:workspace-setup']);
  });

  it('follows the stepper buttons and the arrow keys through every file of the pull request', async () => {
    const root = await openMacro();
    listRow(root, ordered[0]).click();
    await flush();
    const seen = new Set<string>();

    for (let step = 1; step < ordered.length; step += 1) {
      const path = ordered[step];
      if (step % 2) (root.querySelector('.lt-review .lt-step-next') as HTMLElement).click();
      else press(root.querySelector('.lt-review') as HTMLElement, 'ArrowRight');
      await flush();
      expect(shown(root)).toBe(path);
      expect(reading(root)).toEqual(placeHolding(path));
      placeHolding(path).forEach((key) => { seen.add(key); });
    }

    expect(seen.size).toBeGreaterThan(2);
    press(root.querySelector('.lt-review') as HTMLElement, 'ArrowLeft');
    await flush();
    expect(shown(root)).toBe(ordered[ordered.length - 2]);
    expect(reading(root)).toEqual(placeHolding(ordered[ordered.length - 2]));
  }, 60_000);

  it('puts the marker on the foundation entry when the open file sits in the foundation', async () => {
    const root = await openMacro();

    listRow(root, IN_FOUNDATION).click();
    await flush();

    expect(reading(root)).toEqual(['block:core:desktop']);
    expect(note(root)).toBe('');
  });

  it('marks no shape and says so for a file in no feature, and for one not in the map', async () => {
    const root = await openMacro();
    listRow(root, IN_PROJECT_MAP).click();
    await flush();

    listRow(root, IN_NO_FEATURE).click();
    await flush();
    expect(reading(root)).toEqual([]);
    expect(note(root)).toContain('is not in any block');

    listRow(root, IN_PROJECT_MAP).click();
    await flush();
    (root.querySelector(`.lt-side-list [data-pr-diff="${NOT_IN_MAP}"]`) as HTMLElement).click();
    await flush();
    expect(reading(root)).toEqual([]);
    expect(note(root)).toContain('is not in any block');
  });

  it('survives hiding the pull request changes', async () => {
    const root = await openMacro();
    listRow(root, IN_WORKSPACE).click();
    await flush();

    (root.querySelector('.lt-viewbar [data-prmark]') as HTMLElement).click();

    expect(lit(root)).toEqual([]);
    expect(reading(root)).toEqual(['block:workspace-setup']);
  });
});

describe('the outside systems list with a file open in the review pane', () => {
  it('keeps the arrow keys of the list to itself instead of stepping the review to the next file', async () => {
    const root = await openMacro();
    listRow(root, IN_PROJECT_MAP).click();
    await flush();
    const open = shown(root);
    const entries = [...root.querySelectorAll<HTMLButtonElement>('.mv-dock .mv-system')];
    expect(entries.length).toBeGreaterThan(1);
    entries[0].focus();

    const event = new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true });
    entries[0].dispatchEvent(event);
    await flush();

    expect(event.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(entries[1]);
    expect(shown(root)).toBe(open);
  });
});

describe('the reading marker and the file in another area, one level down', () => {
  async function insideProjectMap() {
    sizeTheMacroViewPane(WIDE_PANE);
    const root = await openMacro();
    dive(root, 'block:project-map');
    await flush();
    return root;
  }

  it('keeps marking the block inside the area', async () => {
    const root = await insideProjectMap();

    listRow(root, IN_PROJECT_MAP).click();
    await flush();

    expect(flagged(root, 'is-reading', '.mv-feature')).toEqual(['block:code-insight']);
    expect(note(root)).toBe('');
  });

  it('names the other area holding the open file and offers to enter it', async () => {
    const root = await insideProjectMap();

    listRow(root, IN_WORKSPACE).click();
    await flush();

    expect(note(root)).toContain('is in another area, Workspace setup');
    const enter = root.querySelector('.lt-overview .lt-open-note + [data-macro-enter]') as HTMLElement;
    expect(enter.textContent).toBe('Open Workspace setup');

    enter.click();
    await flush();

    expect(crumbs(root)).toContain('Workspace setup');
    expect(flagged(root, 'is-reading', '.mv-feature')).toEqual(['block:projects-hub']);
    expect(note(root)).toBe('');
  });
});

describe('a picked Flow step on the area shapes', () => {
  async function pickStep(index: number) {
    const root = await openMacro();
    control(root, 'flow').click();
    (root.querySelectorAll('.lt-flow-block[data-flow-step]')[index] as HTMLElement).click();
    control(root, 'macro').click();
    await flush();
    return root;
  }

  it('marks the area holding the files of the step', async () => {
    const root = await pickStep(0);

    expect(crumbs(root)).toBe('Areas');
    expect(flagged(root, 'is-flow', '.mv-area')).toEqual(['block:project-map']);
  });

  it('moves to the area of another step', async () => {
    const root = await pickStep(1);

    expect(flagged(root, 'is-flow', '.mv-area')).toEqual(['block:workspace-setup']);
  });
});
