// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MacroLoad } from '../src/main/lantern-macro-load';
import { MACRO_MIN_FILES, macroGraph } from '../src/renderer/lib/lanternmacro';
import { mountLanternView } from '../src/renderer/lib/lanternview';
import { macroFixtureBlocks, macroFixtureView, repoFeatureTexts } from './helpers/lantern-macro-fixture';
import { mapOf, node } from './helpers/lantern-map';

const view = macroFixtureView();
const MIN_STRONG = 8;
const texts = repoFeatureTexts();
const loaded: MacroLoad = { ok: true, view, texts, blockByPath: macroFixtureBlocks(), minStrongEdge: MIN_STRONG };
const mapWith = (files: number) => mapOf({ project: 'demo', nodes: Array.from({ length: files }, (_, i) => node(`src/f${i}.ts`, 'util')) });
const BIG = mapWith(MACRO_MIN_FILES + 1);

const mounted: ReturnType<typeof mountLanternView>[] = [];
afterEach(() => {
  mounted.splice(0).forEach((one) => { one.dispose(); });
  document.body.replaceChildren();
});

function mount(data = BIG, readMacro: (() => Promise<MacroLoad>) | null = () => Promise.resolve(loaded)) {
  const root = document.createElement('div');
  document.body.appendChild(root);
  const one = mountLanternView(root, data, { readMacro: readMacro ?? undefined });
  mounted.push(one);
  return { root, view: one };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const control = (root: HTMLElement, which: 'files' | 'macro') => root.querySelector(`.lt-viewbar [data-view="${which}"]`) as HTMLButtonElement;
const blockButtons = (root: HTMLElement) => [...root.querySelectorAll<HTMLButtonElement>('.lt-pixi-node-access')];
const edgeNotes = (root: HTMLElement) => [...root.querySelectorAll<HTMLElement>('.lt-pixi-edge-access')];
const blockButton = (root: HTMLElement, id: string) => blockButtons(root).find((button) => button.textContent === id) as HTMLButtonElement;

async function openMacro(readMacro?: () => Promise<MacroLoad>) {
  const one = mount(BIG, readMacro);
  control(one.root, 'macro').click();
  await flush();
  return one;
}

describe('the control that switches to the Macro view', () => {
  it('is hidden for a small map', () => {
    const { root } = mount(mapWith(MACRO_MIN_FILES));

    expect(root.querySelector<HTMLElement>('.lt-viewbar')?.hidden).toBe(true);
    expect(control(root, 'macro')).toBeNull();
  });

  it('is hidden when the app cannot read the macro view', () => {
    const { root } = mount(BIG, null);

    expect(root.querySelector<HTMLElement>('.lt-viewbar')?.hidden).toBe(true);
  });

  it('is offered above the cut, with the file view on', () => {
    const { root } = mount();

    expect(root.querySelector<HTMLElement>('.lt-viewbar')?.hidden).toBe(false);
    expect(control(root, 'files').getAttribute('aria-pressed')).toBe('true');
    expect(control(root, 'macro').getAttribute('aria-pressed')).toBe('false');
  });

  it('does not ask the main process for anything until it is used', () => {
    const read = vi.fn(() => Promise.resolve(loaded));

    mount(BIG, read);

    expect(read).not.toHaveBeenCalled();
  });
});

const graph = macroGraph(view);
const mainEdges = graph.edges.filter((edge) => edge.main);

describe('the Macro view at rest shows the feature blocks, the foundation band and the main links only', () => {
  it('draws the 14 blocks (11 feature cards, 3 foundation entries) and no outside system, and keeps the file graph out', async () => {
    const { root } = await openMacro();

    expect(blockButtons(root)).toHaveLength(view.blocks.length);
    expect(blockButtons(root).map((button) => button.textContent)).toEqual(expect.arrayContaining(graph.blocks.map((block) => block.name)));
    for (const system of graph.systems) expect(blockButtons(root).some((button) => button.textContent === system.name), system.name).toBe(false);
    expect(blockButtons(root).some((button) => button.textContent?.startsWith('f1'))).toBe(false);
  });

  it('draws 13 lines (7 main links) of the 58 edges, each carrying its own count', async () => {
    const { root } = await openMacro();

    expect(view.edges).toHaveLength(58);
    expect(mainEdges).toHaveLength(13);
    expect(edgeNotes(root)).toHaveLength(mainEdges.length);
    expect(edgeNotes(root).map((note) => Number(note.dataset.count)).sort((a, b) => a - b)).toEqual(mainEdges.map((edge) => edge.count).sort((a, b) => a - b));
  });

  it('marks as strong the main lines the view marks, nothing else', async () => {
    const { root } = await openMacro();

    const strong = edgeNotes(root).filter((note) => note.dataset.strong === 'true');
    expect(strong).toHaveLength(mainEdges.filter((edge) => edge.strong).length);
    expect(strong.every((note) => Number(note.dataset.count) >= MIN_STRONG)).toBe(true);
    expect(edgeNotes(root).filter((note) => note.dataset.strong === 'false').every((note) => Number(note.dataset.count) < MIN_STRONG)).toBe(true);
  });

  it('writes the feature, main-link and strong counts in the side panel', async () => {
    const { root } = await openMacro();

    const stats = root.querySelector('.lt-side .stats')?.textContent;
    expect(stats).toContain('11feature blocks');
    expect(stats).toContain('7main links, of 18');
    expect(stats).toContain(`${mainEdges.filter((edge) => edge.strong).length}strong`);
    expect(stats).toContain(`${view.external.length}outside systems`);
    expect(root.querySelector('.lt-overview')?.textContent).toContain(`${MIN_STRONG}+ relations`);
  });

  it('shows fewer lines when the main process sends fewer, so a dropped edge cannot hide', async () => {
    const dropped = mainEdges[0];
    const fewerView = { ...view, edges: view.edges.filter((edge) => !(edge.from === dropped.from && edge.to === dropped.to)) };
    const { root } = await openMacro(() => Promise.resolve({ ...loaded, view: fewerView }));

    expect(edgeNotes(root)).toHaveLength(macroGraph(fewerView).edges.filter((edge) => edge.main).length);
    expect(edgeNotes(root).some((note) => note.textContent?.startsWith(`${dropped.fromName} → ${dropped.toName}:`))).toBe(false);
  });
});

describe('using the Macro view', () => {
  it('shows a loading note, then the graph', async () => {
    const one = mount();
    control(one.root, 'macro').click();

    expect(one.root.querySelector('.lt-none')?.textContent).toContain('Loading the macro view');
    await flush();
    expect(one.root.querySelector('.lt-none')).toBeNull();
  });

  it('tells the user when the macro view cannot be loaded', async () => {
    const { root } = await openMacro(() => Promise.resolve({ ok: false, error: 'this project has no Lantern map' }));

    expect(root.querySelector('.lt-none')?.textContent).toContain('this project has no Lantern map');
    expect(edgeNotes(root)).toHaveLength(0);
  });

  it('survives the read rejecting', async () => {
    const { root } = await openMacro(() => Promise.reject(new Error('channel closed')));

    expect(root.querySelector('.lt-none')?.textContent).toContain('channel closed');
  });

  it('selects a block, shows its relations, and clears on a second click and on Escape', async () => {
    const { root } = await openMacro();

    blockButton(root, 'Lantern map').click();
    expect(blockButton(root, 'Lantern map').getAttribute('aria-pressed')).toBe('true');
    expect(root.querySelector('.lt-side .lt-detail')?.textContent).toContain('Lantern map');
    expect(root.querySelector('.lt-side .lt-detail')?.textContent).toContain('32');
    expect(blockButton(root, 'Code insight').getAttribute('aria-description')).toContain('related');

    blockButton(root, 'Lantern map').click();
    expect(root.querySelector('.lt-side .lt-detail')).toBeNull();

    blockButton(root, 'Lantern map').click();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(blockButton(root, 'Lantern map').getAttribute('aria-pressed')).toBe('false');
  });

  it('follows a relation from the side panel to the other block', async () => {
    const { root } = await openMacro();
    blockButton(root, 'Lantern map').click();

    (root.querySelector('.lt-detail [data-macro-go="block:core:desktop"]') as HTMLButtonElement).click();

    expect(blockButton(root, 'Desktop shell').getAttribute('aria-pressed')).toBe('true');
  });

  it('lists the outside systems of a block and lets the user pick one', async () => {
    const { root } = await openMacro();
    blockButton(root, 'Delegate runs').click();

    (root.querySelector('.lt-detail [data-macro-go="ext:bitbucket-api"]') as HTMLButtonElement).click();

    expect(root.querySelector('.lt-detail')?.textContent).toContain('Bitbucket API');
    expect(root.querySelector('.lt-detail')?.textContent).toContain('Delegate runs');
    expect(root.querySelector('.lt-detail')?.textContent).toContain('Used by');
  });
});

describe('the side panel explains a block in words', () => {
  const detail = (root: HTMLElement) => root.querySelector('.lt-side .lt-detail') as HTMLElement;
  const sentences = (root: HTMLElement) => [...detail(root).querySelectorAll('p.lt-sentence')].map((p) => p.textContent);

  it('leads with the stored purpose of a feature', async () => {
    const { root } = await openMacro();

    blockButton(root, 'Session monitoring').click();

    expect(detail(root).querySelector('.lt-purpose')?.textContent).toBe(texts['session-monitoring']);
    expect(detail(root).querySelector('.path')?.textContent).toBe('Session monitoring');
  });

  it('shows only the name for a feature without a text, and invents nothing', async () => {
    const { root } = await openMacro(() => Promise.resolve({ ...loaded, texts: {} } as MacroLoad));

    blockButton(root, 'Session monitoring').click();

    expect(detail(root).querySelector('.lt-purpose')).toBeNull();
    expect(detail(root).querySelector('.path')?.textContent).toBe('Session monitoring');
  });

  it('says who it sends to and takes from, with the counts of the view', async () => {
    const { root } = await openMacro();
    const out = view.edges.filter((edge) => edge.from === 'lantern-map');
    const into = view.edges.filter((edge) => edge.to === 'lantern-map');

    blockButton(root, 'Lantern map').click();

    const sends = sentences(root).find((text) => text?.startsWith('Sends to')) ?? '';
    const takes = sentences(root).find((text) => text?.startsWith('Takes from')) ?? '';
    expect(out.length).toBeGreaterThan(0);
    expect(into.length).toBeGreaterThan(0);
    const features = (edges: typeof out) => edges.filter((edge) => !edge.from.startsWith('core:') && !edge.to.startsWith('core:'));
    for (const edge of features(out)) expect(sends).toContain(`${graph.blocks.find((block) => block.id === edge.to)?.name} (${edge.count} relation`);
    for (const edge of features(into)) expect(takes).toContain(`${graph.blocks.find((block) => block.id === edge.from)?.name} (${edge.count} relation`);
    expect(sends).not.toContain('Desktop shell');
    expect(sends.endsWith('.')).toBe(true);
  });

  it('names the outside systems it talks to', async () => {
    const { root } = await openMacro();

    blockButton(root, 'Delegate runs').click();

    const outside = sentences(root).find((text) => text?.startsWith('Talks to the outside system')) ?? '';
    const used = view.external.filter((entry) => entry.blocks.some((link) => link.block === 'delegate-runs'));
    expect(used.length).toBeGreaterThan(0);
    for (const entry of used) expect(outside).toContain(macroGraph(view).systems.find((system) => system.system === entry.system)?.name);
    expect(outside).toContain('Bitbucket API');
  });

  it('says which blocks use an outside system', async () => {
    const { root } = await openMacro();

    blockButton(root, 'Delegate runs').click();
    (root.querySelector('.lt-detail [data-macro-go="ext:bitbucket-api"]') as HTMLButtonElement).click();

    const users = view.external.find((entry) => entry.system === 'bitbucket-api')?.blocks ?? [];
    expect(users.length).toBeGreaterThan(0);
    expect(sentences(root)).toHaveLength(1);
    expect(sentences(root)[0]?.startsWith('Used by')).toBe(true);
    for (const link of users) expect(sentences(root)[0]).toContain(`${macroGraph(view).blocks.find((block) => block.id === link.block)?.name} (${link.count} relation`);
  });

  it('calls the shared foundation plumbing, not a feature, and gives it no purpose of its own', async () => {
    const { root } = await openMacro();

    blockButton(root, 'Desktop shell').click();

    expect(detail(root).querySelector('.role')?.textContent).toContain('shared foundation');
    expect(detail(root).querySelector('.lt-purpose')?.textContent).toContain('not a feature');
  });

  it('lists the blocks as features and, apart, as the shared foundation', async () => {
    const { root } = await openMacro();

    const groups = [...root.querySelectorAll('.lt-side h2')].map((h) => h.textContent);
    const chips = (title: string) => [...(([...root.querySelectorAll('.lt-side h2')].find((h) => h.textContent === title)?.nextElementSibling as HTMLElement).querySelectorAll('.chip'))].map((chip) => chip.textContent?.replace(/\s*\d+$/, ''));
    expect(groups).toEqual(expect.arrayContaining(['Features', 'Shared foundation']));
    expect(chips('Shared foundation').sort()).toEqual(['Desktop shell', 'Shared code', 'Skills', 'Whole band']);
    expect(chips('Features')).toHaveLength(view.blocks.length - 3);
    expect(chips('Features')).not.toContain('Desktop shell');
  });
});

describe('using the Macro view, continued', () => {

  it('goes back to the file graph with the Files button', async () => {
    const { root } = await openMacro();

    control(root, 'files').click();

    expect(edgeNotes(root)).toHaveLength(0);
    expect(blockButtons(root)).toHaveLength(BIG.nodes.length);
    expect(control(root, 'files').getAttribute('aria-pressed')).toBe('true');
  });

  it('reads again after the map reloads, and keeps the Macro view on', async () => {
    const read = vi.fn(() => Promise.resolve(loaded));
    const { root, view: one } = await openMacro(read);

    one.update(mapWith(MACRO_MIN_FILES + 5));
    await flush();

    expect(read).toHaveBeenCalledTimes(2);
    expect(control(root, 'macro').getAttribute('aria-pressed')).toBe('true');
    expect(edgeNotes(root)).toHaveLength(mainEdges.length);
  });

  it('falls back to the file graph when the map shrinks below the cut', async () => {
    const { root, view: one } = await openMacro();

    one.update(mapWith(10));
    await flush();

    expect(edgeNotes(root)).toHaveLength(0);
    expect(root.querySelector<HTMLElement>('.lt-viewbar')?.hidden).toBe(true);
    expect(blockButtons(root)).toHaveLength(10);
  });

  it('hides the file-graph controls while the Macro view is on', async () => {
    const { root } = await openMacro();

    expect(root.querySelector('.lt-side .search')).toBeNull();
    expect(root.querySelector<HTMLElement>('.lt-rvbar')?.hidden).toBe(true);
  });
});
