// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LanternMap, LanternNode, LanternRelation } from '../src/main/lantern';
import type { MacroLoad } from '../src/main/lantern-macro-load';
import { mountLanternView } from '../src/renderer/lib/lanternview';
import type { ViewOptions } from '../src/renderer/lib/lanternview';
import { macroFixtureRecords, repoPrRecord } from './helpers/lantern-macro-fixture';
import { AREA_LIST, areasPayload, derivedAreas } from './helpers/lantern-macro-areas-payload';
import { mapOf, node, pr } from './helpers/lantern-map';
import { WIDE_PANE, dive, flagged, label, pick, sizeTheMacroViewPane, macroViewItem, macroViewRoot } from './helpers/macroview-host';

const PR_ID = '108';
const payload = areasPayload();
const areas = payload.areas!;
const records = macroFixtureRecords();
const nodes = records.map((r): LanternNode => node(r.path, r.role, { feature: r.feature }));
const relations = records.flatMap((r): LanternRelation[] => r.relations.map((x) => ({ from: r.path, arrow: x.arrow, to: x.to, ext: x.ext, symbol: null, label: '' })));
const record = repoPrRecord(PR_ID);
const changedFiles = record.files.map((f) => ({ ...f, mapped: nodes.some((n) => n.path === f.path) }));
const pathIn = (block: string) => changedFiles.find((f) => payload.blockByPath[f.path] === block)!.path;
const READ_IN_MAP = pathIn('code-insight');
const READ_ELSEWHERE = pathIn('projects-hub');
const flowStory = { title: 'A reader opens code', steps: [{ kind: 'actor' as const, text: 'Reader', files: [READ_IN_MAP] }, { kind: 'action' as const, text: 'opens' }, { kind: 'subject' as const, text: 'a file', files: [READ_ELSEWHERE] }], below: [] };
const changed = pr(PR_ID, { title: record.title, ordered: record.ordered, files: changedFiles, flow: [flowStory] });
const BIG = mapOf({ project: 'demo', nodes, relations, prs: [changed] });
const PLAIN = mapOf({ project: 'demo', nodes, relations });

const readers: ViewOptions = {
  readFile: async (path) => ({ exists: true, text: `live ${path}\n`, truncated: 0 }),
  readPrFile: async (_pr, path) => ({ ok: true, text: `branch ${path}\n`, truncated: false, binary: false, version: 'branch' }),
  readPrDiff: async (_pr, path) => ({ ok: true, diff: `@@ -1 +1 @@\n-old ${path}\n+new ${path}`, truncated: false, binary: false }),
};

const mounted: ReturnType<typeof mountLanternView>[] = [];

beforeEach(() => sizeTheMacroViewPane());

afterEach(() => {
  mounted.splice(0).forEach((one) => { one.dispose(); });
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const control = (root: HTMLElement, which: 'files' | 'macro' | 'flow') => root.querySelector<HTMLButtonElement>(`.lt-viewbar [data-view="${which}"]`) as HTMLButtonElement;
const buttons = (root: HTMLElement) => [...root.querySelectorAll<HTMLButtonElement>('.lt-pixi-node-access')];
const labels = (root: HTMLElement) => buttons(root).map((button) => button.textContent);
const card = (root: HTMLElement, name: string) => buttons(root).find((button) => button.textContent === name) as HTMLButtonElement;
const crumbs = (root: HTMLElement) => root.querySelector('.lt-crumbs');
const live = (root: HTMLElement) => root.querySelector('.lt-sr')?.textContent ?? '';
const detail = (root: HTMLElement) => root.querySelector('.lt-side .lt-detail')?.textContent ?? '';
const press = (target: Element | Document, k: string) => target.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
const drawn = (root: HTMLElement, selector: string) => [...root.querySelectorAll(`.lt-macroview ${selector}`)].map((item) => item.getAttribute('data-key'));
const FOUNDATION_KEYS = ['block:core:desktop', 'block:core:shared', 'block:core:skills'];
const AREA_KEYS = ['block:project-map', 'block:pull-request-review', 'block:agent-sessions', 'block:workspace-setup'];

function mount(map: LanternMap, read: () => Promise<MacroLoad>, opts: ViewOptions = {}) {
  const root = document.createElement('div');
  document.body.appendChild(root);
  const one = mountLanternView(root, map, { readMacro: read, ...opts });
  mounted.push(one);
  return { root, view: one };
}

async function openMacro(result: MacroLoad = payload, map = PLAIN, opts: ViewOptions = {}) {
  const one = mount(map, () => Promise.resolve(result), opts);
  control(one.root, 'macro').click();
  await flush();
  return one;
}

async function openArea(key = 'block:project-map', result: MacroLoad = payload, map = PLAIN, opts: ViewOptions = {}) {
  sizeTheMacroViewPane(WIDE_PANE);
  const one = await openMacro(result, map, opts);
  dive(one.root, key);
  return one;
}

describe('the Macro view of a project with areas, at the top', () => {
  it('draws the map in the Macro view host instead of the canvas, one shape per area, the To assign area and each foundation entry', async () => {
    const { root } = await openMacro();

    expect(macroViewRoot(root)).not.toBeNull();
    expect((root.querySelector('.lt-pixi-host') as HTMLElement).hidden).toBe(true);
    expect(drawn(root, '.mv-area').sort()).toEqual([...AREA_KEYS, 'block:to-assign'].sort());
    expect(drawn(root, '.mv-entry').sort()).toEqual(FOUNDATION_KEYS);
    expect(label(root, 'block:project-map')).toContain('Project map, area, 3 features, 121 files');
  });

  it('marks To assign as features not placed in an area yet', async () => {
    const { root } = await openMacro();

    expect(label(root, 'block:to-assign')).toContain('To assign, features not in an area yet, 1 feature, 16 files');
    expect(label(root, 'block:project-map')).toContain('area');
  });

  it('names the level in the breadcrumb and to a screen reader, and counts areas in the panel', async () => {
    const { root } = await openMacro();

    expect(crumbs(root)?.textContent).toBe('Areas');
    expect(crumbs(root)?.querySelector('button')).toBeNull();
    expect(crumbs(root)?.querySelector('[aria-current="location"]')?.textContent).toBe('Areas');
    expect(live(root)).toBe('Areas: 4 areas, and 1 feature to assign. Press Enter on an area to open it.');
    expect(root.querySelector('.lt-side .stats')?.textContent).toContain('4areas');
    expect(root.querySelector('.lt-side .stats')?.textContent).toContain('1to assign');
    expect(root.querySelector('.lt-side .sub')?.textContent).toBe('Macro view, one card per area');
    expect(control(root, 'macro').textContent).toBe('Macro 4');
  });

  it('has no layout switcher', async () => {
    const { root } = await openMacro();

    expect(root.querySelector('.lt-viewbar select')).toBeNull();
    expect(root.querySelector('.lt-layout')).toBeNull();
  });

  it('shows the purpose, features and partners of a picked area in the panel', async () => {
    const { root } = await openMacro();

    pick(root, 'block:project-map');

    expect(macroViewItem(root, 'block:project-map').getAttribute('aria-pressed')).toBe('true');
    expect(detail(root)).toContain('mapping a project and reading its code');
    expect(detail(root)).toContain('Features: Lantern map, Lantern sections and Code insight');
    expect(detail(root)).toContain('Pull request review');
    expect(root.querySelector('.lt-detail [data-macro-enter]')?.textContent).toBe('Open Project map');
    expect(root.querySelector('.lt-detail')?.textContent).toContain('area · 3 features · 121 files');
  });

  it('lights the partners of a picked area and dims the rest', async () => {
    const { root } = await openMacro();

    pick(root, 'block:project-map');

    expect(flagged(root, 'is-selected')).toEqual(['block:project-map']);
    expect(flagged(root, 'is-related')).toContain('block:pull-request-review');
    expect(flagged(root, 'is-dim').length).toBeGreaterThan(0);
  });

  it('puts every card of the panel among its chips, areas first', async () => {
    const { root } = await openMacro();

    const chips = [...root.querySelectorAll('.lt-side .chip')].map((chip) => chip.textContent);
    expect(chips.slice(0, 5).map((text) => text?.replace(/\s\d+$/, ''))).toEqual(['Project map', 'Pull request review', 'Agent sessions', 'Workspace setup', 'To assign']);
  });
});

describe('entering an area and leaving it', () => {
  it('writes the way back in the breadcrumb, announces the level and names it in the panel, on a double click', async () => {
    const { root } = await openArea();

    expect(crumbs(root)?.textContent).toBe('Areas›Project map');
    expect(crumbs(root)?.querySelector('[data-macro-up]')?.textContent).toBe('Areas');
    expect(crumbs(root)?.querySelector('[aria-current="location"]')?.textContent).toBe('Project map');
    expect(live(root)).toBe('Inside Project map: 3 features. Press Escape to go back to the areas.');
    expect(root.querySelector('.lt-side .sub')?.textContent).toBe('Macro view, inside Project map');
  });

  it('does not enter on a single click, and enters on the button in the panel', async () => {
    sizeTheMacroViewPane(WIDE_PANE);
    const { root } = await openMacro();
    dive(root, 'block:workspace-setup');
    (crumbs(root)?.querySelector('[data-macro-up]') as HTMLButtonElement).click();
    expect(crumbs(root)?.textContent).toBe('Areas');

    pick(root, 'block:project-map');
    expect(crumbs(root)?.textContent).toBe('Areas');

    (root.querySelector('.lt-detail [data-macro-enter]') as HTMLButtonElement).click();
    expect(crumbs(root)?.textContent).toBe('Areas›Project map');
  });

  it('describes the area in the panel, with its partners, outside systems and a way back', async () => {
    const { root } = await openArea();

    const head = root.querySelector('.lt-area-head') as HTMLElement;
    expect(head.textContent).toContain('mapping a project and reading its code');
    expect(head.textContent).toContain('Works with Pull request review');
    expect(head.textContent).toContain('Talks to the outside systems');
    expect(head.querySelector('[data-macro-up]')?.textContent).toBe('Back to the areas');
    expect([...root.querySelectorAll('.lt-side .chip')].map((chip) => chip.textContent?.replace(/\s\d+$/, '')).slice(0, 3).sort()).toEqual(['Code insight', 'Lantern map', 'Lantern sections']);
  });

  it('shows the outside systems of a picked feature in the panel', async () => {
    const { root } = await openArea();

    pick(root, 'block:lantern-map');

    expect(detail(root)).toContain('Talks to the outside system');
  });

  it('leaves on Escape, first clearing a selection', async () => {
    const { root } = await openArea();
    pick(root, 'block:lantern-map');

    press(document, 'Escape');
    expect(crumbs(root)?.textContent).toBe('Areas›Project map');
    expect(macroViewItem(root, 'block:lantern-map').getAttribute('aria-pressed')).toBe('false');

    press(document, 'Escape');
    expect(crumbs(root)?.textContent).toBe('Areas');
    expect(live(root)).toBe('Areas: 4 areas, and 1 feature to assign. Press Enter on an area to open it.');
  });

  it('leaves on Backspace even with a feature picked, but not while typing', async () => {
    const { root } = await openArea();
    pick(root, 'block:lantern-map');
    const field = document.createElement('input');
    document.body.appendChild(field);

    press(field, 'Backspace');
    expect(crumbs(root)?.textContent).toBe('Areas›Project map');

    press(document, 'Backspace');
    expect(crumbs(root)?.textContent).toBe('Areas');
  });

  it('leaves from the breadcrumb and from the panel', async () => {
    const { root } = await openArea();

    (crumbs(root)?.querySelector('[data-macro-up]') as HTMLButtonElement).click();
    expect(crumbs(root)?.textContent).toBe('Areas');

    dive(root, 'block:pull-request-review');
    (root.querySelector('.lt-area-head [data-macro-up]') as HTMLButtonElement).click();
    expect(crumbs(root)?.textContent).toBe('Areas');
  });

  it('opens another area from the panel, which reads its counts when picked', async () => {
    const { root } = await openArea();
    const stub = areas.details['project-map'].stubs[0];

    (root.querySelector(`.lt-side .chip[data-macro-go="block:pull-request-review"]`) as HTMLButtonElement).click();
    expect(detail(root)).toContain(`send ${stub.out} relation`);
    expect(detail(root)).toContain(`take ${stub.in} relation`);
    expect(crumbs(root)?.textContent).toBe('Areas›Project map');

    dive(root, 'block:pull-request-review');
    expect(crumbs(root)?.textContent).toBe('Areas›Pull request review');
  });

  it('opens the To assign area like any other', async () => {
    const { root } = await openArea('block:to-assign');

    expect(crumbs(root)?.textContent).toBe('Areas›To assign');
  });

  it('keeps the entered area when the user looks at Files and comes back to Macro', async () => {
    const { root } = await openArea('block:workspace-setup');

    control(root, 'files').click();
    expect(crumbs(root)).toBeNull();
    expect(macroViewRoot(root)).toBeNull();
    expect(live(root)).toBe('');
    control(root, 'macro').click();
    await flush();

    expect(crumbs(root)?.textContent).toBe('Areas›Workspace setup');
    expect(macroViewRoot(root).dataset.entered).toBe('workspace-setup');
  });

  it('keeps the entered area of one view apart from another view of the same map', async () => {
    const first = await openArea('block:workspace-setup');
    sizeTheMacroViewPane();
    const second = await openMacro();

    expect(crumbs(first.root)?.textContent).toBe('Areas›Workspace setup');
    expect(crumbs(second.root)?.textContent).toBe('Areas');
  });

  it('stays in the area when the map is refreshed with the same areas, and goes up when the areas change', async () => {
    let result: MacroLoad = payload;
    sizeTheMacroViewPane(WIDE_PANE);
    const one = mount(PLAIN, () => Promise.resolve(result));
    control(one.root, 'macro').click();
    await flush();
    dive(one.root, 'block:agent-sessions');

    one.view.update(PLAIN);
    await flush();
    expect(crumbs(one.root)?.textContent).toBe('Areas›Agent sessions');

    result = { ...payload, areas: derivedAreas(AREA_LIST.slice(0, 3)) };
    one.view.update(PLAIN);
    await flush();
    expect(crumbs(one.root)?.textContent).toBe('Areas');
    expect(macroViewItem(one.root, 'block:workspace-setup')).toBeNull();
  });

  it('goes up when the entered area is no longer there', async () => {
    let result: MacroLoad = payload;
    sizeTheMacroViewPane(WIDE_PANE);
    const one = mount(PLAIN, () => Promise.resolve(result));
    control(one.root, 'macro').click();
    await flush();
    dive(one.root, 'block:workspace-setup');

    result = { ...payload, areas: derivedAreas([{ ...AREA_LIST[3], id: 'workspace-tools' }, ...AREA_LIST.slice(0, 3)]) };
    one.view.update(PLAIN);
    await flush();

    expect(crumbs(one.root)?.textContent).toBe('Areas');
  });
});

describe('a project without areas', () => {
  const { areas: _dropped, ...plain } = payload;

  it('keeps the flat view: every feature card, no breadcrumb, nothing announced', async () => {
    const { root } = await openMacro(plain);

    expect(labels(root)).toContain('Lantern map');
    expect(labels(root)).toContain('Serve web');
    expect(labels(root)).not.toContain('Project map');
    expect(crumbs(root)).toBeNull();
    expect(live(root)).toBe('');
    expect(root.querySelector('.lt-side .sub')?.textContent).toBe('Macro view, one block per feature');
    expect(macroViewRoot(root)).toBeNull();
    expect((root.querySelector('.lt-pixi-host') as HTMLElement).hidden).toBe(false);
  });

  it('does not enter on Enter, Escape or Backspace', async () => {
    const { root } = await openMacro(plain);
    const before = labels(root);

    press(card(root, 'Lantern map'), 'Enter');
    press(document, 'Escape');
    press(document, 'Backspace');

    expect(labels(root)).toEqual(before);
    expect(crumbs(root)).toBeNull();
  });

  it('says in one line why the areas were ignored, and draws the flat view', async () => {
    const warning = 'Areas ignored, the flat view is shown: area "x" has no features';
    const { root } = await openMacro({ ...plain, areasWarning: warning });

    const note = root.querySelector('.lt-side .lt-areas-note') as HTMLElement;
    expect(note.textContent).toBe(warning);
    expect(note.getAttribute('role')).toBe('note');
    expect(root.querySelectorAll('.lt-side .lt-areas-note')).toHaveLength(1);
    expect(labels(root)).toContain('Lantern map');
    expect(crumbs(root)).toBeNull();
  });

  it('shows no such line when nothing was ignored', async () => {
    const { root } = await openMacro(plain);

    expect(root.querySelector('.lt-areas-note')).toBeNull();
  });
});

describe('pull request marks, the reading marker and flow references with areas', () => {
  const prOpts: ViewOptions = { pr: PR_ID, ...readers };
  const listRow = (root: HTMLElement, path: string) => root.querySelector(`.lt-side-list [data-pr-go="${path}"]`) as HTMLElement;
  const note = (root: HTMLElement) => root.querySelector('.lt-overview .lt-open-note')?.textContent ?? '';
  const features = (root: HTMLElement, flag: string) => flagged(root, flag).filter((key) => macroViewItem(root, key).classList.contains('mv-feature'));

  it('lights the blocks the pull request touches inside an area, with the share of changed files', async () => {
    const { root } = await openArea('block:project-map', payload, BIG, prOpts);

    expect(features(root, 'is-lit')).toContain('block:code-insight');
    expect(features(root, 'is-lit')).not.toContain('block:lantern-map');
    expect(label(root, 'block:code-insight')).toContain('1 of 30 files changed in the pull request');
    expect(root.querySelector('.lt-viewbar [data-prmark]')?.getAttribute('aria-pressed')).toBe('true');
  });

  it('marks the block of the file open in the review pane inside its area, and says when it is in another area', async () => {
    const { root } = await openArea('block:project-map', payload, BIG, prOpts);

    listRow(root, READ_IN_MAP).click();
    await flush();
    expect(features(root, 'is-reading')).toEqual(['block:code-insight']);
    expect(note(root)).toBe('');

    listRow(root, READ_ELSEWHERE).click();
    await flush();
    expect(features(root, 'is-reading')).toEqual(['block:projects-hub']);
    expect(note(root)).toContain('is in another area');
  });

  it('marks the blocks of a flow step that names files, inside the area', async () => {
    const { root } = await openArea('block:project-map', payload, BIG, prOpts);

    control(root, 'flow').click();
    (root.querySelector('.lt-flow-block[data-flow-step]') as HTMLElement).click();
    control(root, 'macro').click();
    await flush();

    expect(crumbs(root)?.textContent).toBe('Areas›Project map');
    expect(features(root, 'is-flow')).toEqual(['block:code-insight']);
  });
});
