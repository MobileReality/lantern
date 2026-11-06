// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import type { MacroLoad } from '../src/main/lantern-macro-load';
import { FOUNDATION_KEY, MACRO_MIN_FILES, macroGraph } from '../src/renderer/lib/lanternmacro';
import { mountLanternView } from '../src/renderer/lib/lanternview';
import { macroFixtureBlocks, macroFixtureView, repoFeatureTexts } from './helpers/lantern-macro-fixture';
import { mapOf, node } from './helpers/lantern-map';

const view = macroFixtureView();
const graph = macroGraph(view);
const loaded: MacroLoad = { ok: true, view, texts: repoFeatureTexts(), blockByPath: macroFixtureBlocks(), minStrongEdge: 8 };
const BIG = mapOf({ project: 'demo', nodes: Array.from({ length: MACRO_MIN_FILES + 1 }, (_, i) => node(`src/f${i}.ts`, 'util')) });
const FOUNDATION_NAMES = graph.blocks.filter((block) => block.kind === 'core').map((block) => block.name);
const FEATURE_NAMES = graph.blocks.filter((block) => block.kind === 'feature').map((block) => block.name);

const mounted: ReturnType<typeof mountLanternView>[] = [];
afterEach(() => {
  mounted.splice(0).forEach((one) => { one.dispose(); });
  document.body.replaceChildren();
});

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const cards = (root: HTMLElement) => [...root.querySelectorAll<HTMLButtonElement>('.lt-pixi-node-access')];
const card = (root: HTMLElement, name: string) => cards(root).find((button) => button.textContent === name) as HTMLButtonElement;
const lines = (root: HTMLElement) => [...root.querySelectorAll<HTMLElement>('.lt-pixi-edge-access')].map((note) => note.textContent ?? '');
const ends = (text: string) => text.split('\n')[0].split(': ')[0].split(' → ');
const touchesFoundation = (root: HTMLElement) => lines(root).some((text) => ends(text).some((name) => FOUNDATION_NAMES.includes(name)));
const detail = (root: HTMLElement) => root.querySelector('.lt-side .lt-detail') as HTMLElement;
const sentences = (root: HTMLElement) => [...detail(root).querySelectorAll('p.lt-sentence')].map((p) => p.textContent ?? '');
const xOf = (button: HTMLElement) => Number(button.dataset.graphX);

async function openMacro(read: MacroLoad = loaded) {
  const root = document.createElement('div');
  document.body.appendChild(root);
  mounted.push(mountLanternView(root, BIG, { readMacro: () => Promise.resolve(read) }));
  (root.querySelector('.lt-viewbar [data-view="macro"]') as HTMLButtonElement).click();
  await flush();
  return root;
}

describe('the shared foundation at rest', () => {
  it('is one band beside the feature cards, with an entry per core: block, and no core: card among the features', async () => {
    const root = await openMacro();

    const bandX = FOUNDATION_NAMES.map((name) => xOf(card(root, name)));
    const featureX = FEATURE_NAMES.map((name) => xOf(card(root, name)));
    expect(FOUNDATION_NAMES).toHaveLength(3);
    expect(new Set(bandX).size).toBe(1);
    expect(new Set(featureX).size).toBe(1);
    expect(Math.max(...bandX)).toBeLessThan(Math.min(...featureX));
    for (const name of FOUNDATION_NAMES) expect(card(root, name).getAttribute('aria-description'), name).toContain('shared foundation block');
    for (const name of FEATURE_NAMES) expect(card(root, name).getAttribute('aria-description'), name).toContain('feature block');
  });

  it('draws no relation to or from the band', async () => {
    const root = await openMacro();

    expect(lines(root).length).toBeGreaterThan(0);
    expect(touchesFoundation(root)).toBe(false);
  });

  it('keeps the band relation-free when a feature or an entry is selected, and lists them in the side panel instead', async () => {
    const root = await openMacro();

    card(root, 'Lantern map').click();
    expect(touchesFoundation(root)).toBe(false);
    card(root, 'Desktop shell').click();
    expect(touchesFoundation(root)).toBe(false);
    expect(sentences(root).some((text) => text.startsWith('Sends to') || text.startsWith('Takes from'))).toBe(true);
  });
});

describe('the foundation in the side panel', () => {
  it('shows a feature its foundation dependencies as a count and a list', async () => {
    const root = await openMacro();
    const toFoundation = view.edges.filter((edge) => edge.from === 'lantern-map' && edge.to.startsWith('core:'));
    const total = toFoundation.reduce((sum, edge) => sum + edge.count, 0);

    card(root, 'Lantern map').click();

    const reliesOn = sentences(root).find((text) => text.startsWith('Relies on the shared foundation')) ?? '';
    expect(toFoundation.length).toBeGreaterThan(0);
    expect(reliesOn).toContain(`(${total} relations in all)`);
    for (const edge of toFoundation) expect(reliesOn).toContain(`${graph.blocks.find((block) => block.id === edge.to)?.name} (${edge.count} relation`);
    expect(sentences(root).find((text) => text.startsWith('Sends to')) ?? '').not.toContain('Desktop shell');
  });

  it('lists every relation of a foundation entry, to features and to the rest of the foundation', async () => {
    const root = await openMacro();
    const out = view.edges.filter((edge) => edge.from === 'core:desktop');

    card(root, 'Desktop shell').click();

    const sends = sentences(root).find((text) => text.startsWith('Sends to')) ?? '';
    expect(out.length).toBeGreaterThan(0);
    for (const edge of out) expect(sends).toContain(`${graph.blocks.find((block) => block.id === edge.to)?.name} (${edge.count} relation`);
  });

  it('selects the whole band from the side panel, listing the entries and the features that rely on it', async () => {
    const root = await openMacro();

    (root.querySelector(`.lt-side [data-macro-go="${FOUNDATION_KEY}"]`) as HTMLButtonElement).click();

    expect(detail(root).querySelector('.path')?.textContent).toBe('Shared foundation');
    expect(detail(root).querySelector('.role')?.textContent).toContain('3 entries');
    const entries = sentences(root).find((text) => text.startsWith('Entries:')) ?? '';
    for (const name of FOUNDATION_NAMES) expect(entries).toContain(name);
    const relying = sentences(root).find((text) => text.startsWith('Features that rely on it')) ?? '';
    expect(relying).toContain('Lantern map');
    for (const name of FOUNDATION_NAMES) expect(card(root, name).getAttribute('aria-description'), name).toContain('related');
    expect(card(root, 'Lantern map').getAttribute('aria-description')).toContain('related');
    expect(touchesFoundation(root)).toBe(false);
  });

  it('clears the band selection on a second click of the same button and on Escape', async () => {
    const root = await openMacro();
    const whole = () => root.querySelector(`.lt-side [data-macro-go="${FOUNDATION_KEY}"].chip`) as HTMLButtonElement;

    whole().click();
    expect(whole().getAttribute('aria-pressed')).toBe('true');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

    expect(whole().getAttribute('aria-pressed')).toBe('false');
    expect(root.querySelector('.lt-side .lt-detail')).toBeNull();
  });
});

describe('the outside systems', () => {
  const systemNames = graph.systems.map((system) => system.name);

  it('are not drawn at rest', async () => {
    const root = await openMacro();

    expect(cards(root).filter((button) => systemNames.includes(button.textContent ?? ''))).toEqual([]);
  });

  it('appear for the selected block, only those, and go again when it is cleared', async () => {
    const root = await openMacro();
    const own = graph.systems.filter((system) => system.links.some((link) => link.block === 'delegate-runs')).map((system) => system.name);

    card(root, 'Delegate runs').click();

    const shown = cards(root).filter((button) => systemNames.includes(button.textContent ?? '')).map((button) => button.textContent);
    expect(own.length).toBeGreaterThan(0);
    expect(shown.sort()).toEqual([...own].sort());
    expect(sentences(root).find((text) => text.startsWith('Talks to the outside system'))).toContain(own[0]);

    card(root, 'Delegate runs').click();

    expect(cards(root).filter((button) => systemNames.includes(button.textContent ?? ''))).toEqual([]);
  });

  it('keep every card where it was when they appear', async () => {
    const root = await openMacro();
    const before = cards(root).map((button) => [button.textContent, button.dataset.graphX, button.dataset.graphY]);

    card(root, 'Delegate runs').click();

    const after = cards(root).filter((button) => !systemNames.includes(button.textContent ?? '')).map((button) => [button.textContent, button.dataset.graphX, button.dataset.graphY]);
    expect(after).toEqual(before);
  });

  it('are listed in the side panel for a foundation entry, even though the canvas does not draw them', async () => {
    const root = await openMacro();
    const own = graph.systems.filter((system) => system.links.some((link) => link.block === 'core:desktop'));

    card(root, 'Desktop shell').click();

    expect(own.length).toBeGreaterThan(0);
    expect(cards(root).filter((button) => systemNames.includes(button.textContent ?? ''))).toEqual([]);
    expect(sentences(root).find((text) => text.startsWith('Talks to the outside system'))).toContain(own[0].name);
  });
});

describe('a map with nothing to simplify', () => {
  const tiny: MacroLoad = { ok: true, view: { recordCount: 2, testCount: 0, blocks: [{ id: 'alpha', files: 2 }, { id: 'beta', files: 1 }], edges: [], crossBlockRelations: 0, external: [] }, texts: {}, blockByPath: {}, minStrongEdge: 8 };

  it('opens with its cards, no band, no line and no system', async () => {
    const root = await openMacro(tiny);

    expect(cards(root).map((button) => button.textContent).sort()).toEqual(['Alpha', 'Beta']);
    expect(lines(root)).toEqual([]);
    expect([...root.querySelectorAll('.lt-side h2')].map((h) => h.textContent)).not.toContain('Shared foundation');
    expect(root.querySelector('.lt-side .stats')?.textContent).toContain('2feature blocks');
    card(root, 'Alpha').click();
    expect(detail(root).textContent).toContain('No relations to other blocks.');
  });
});
