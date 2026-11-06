// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import type { MacroLoad } from '../src/main/lantern-macro-load';
import type { LanternNode } from '../src/main/lantern';
import { macroGraph } from '../src/renderer/lib/lanternmacro';
import { clampWidths, maxLeft, maxMiddle } from '../src/renderer/lib/lanternpanewidths';
import { REGIONS, createRegions, parseHidden, shortcutOf, shortcutTarget } from '../src/renderer/lib/lanternregions';
import type { Region, RegionStore } from '../src/renderer/lib/lanternregions';
import { mountLanternView } from '../src/renderer/lib/lanternview';
import type { ViewOptions } from '../src/renderer/lib/lanternview';
import { macroFixtureBlocks, macroFixtureRecords, macroFixtureView, repoFeatureTexts, repoPrRecord } from './helpers/lantern-macro-fixture';
import { mapOf, node, pr } from './helpers/lantern-map';

const MAP = mapOf({ nodes: [node('src/svc.ts', 'service')], prs: [pr('7', { files: [{ path: 'src/svc.ts', kind: 'modified', mapped: true }] })] });
const REGIONS_KEY = 'lantern.reviewRegions';
const PANES_KEY = 'lantern.reviewPanes';
const mounted: ReturnType<typeof mountLanternView>[] = [];

afterEach(() => {
  mounted.splice(0).forEach((one) => { one.dispose(); });
  document.body.replaceChildren();
  localStorage.clear();
});

function open(opts: ViewOptions = {}, width = 1200) {
  const root = document.createElement('div');
  document.body.appendChild(root);
  mounted.push(mountLanternView(root, MAP, opts));
  const grid = root.querySelector('.lt-grid') as HTMLElement;
  Object.defineProperty(grid, 'clientWidth', { configurable: true, value: width });
  (root.querySelector('.pr-chip[data-pr="7"]') as HTMLElement).click();
  return { root, grid };
}

const area = (root: HTMLElement, region: 'list' | 'viewer' | 'graph') => root.querySelector(region === 'list' ? '.lt-side' : region === 'viewer' ? '.lt-review' : '.lt-main') as HTMLElement;
const collapse = (root: HTMLElement, region: Region) => root.querySelector(`.lt-region-btn[data-region="${region}"]`) as HTMLButtonElement;
const rail = (root: HTMLElement, region: Region) => root.querySelector(`.lt-rail[data-rail="${region}"]`) as HTMLButtonElement;
const off = (element: HTMLElement) => element.classList.contains('lt-region-off');
const live = (root: HTMLElement) => root.querySelector('.lt-sr')?.textContent;
const saved = (key = REGIONS_KEY) => JSON.parse(localStorage.getItem(key) ?? 'null') as Region[] | null;

function press(init: KeyboardEventInit) {
  document.body.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, altKey: true, ...init }));
}

describe('the hidden areas as a model', () => {
  const memory = () => {
    const state: { value: Region[] } = { value: [] };
    const store: RegionStore = { load: () => state.value, save: (hidden) => {
      state.value = hidden;
    } };
    return { state, store };
  };

  it('never hides the file viewer and the graph together', () => {
    const { store } = memory();
    const regions = createRegions(store);
    expect(regions.hide('viewer')).toBe(true);
    expect(regions.canHide('graph')).toBe(false);
    expect(regions.hide('graph')).toBe(false);
    expect(regions.show('viewer')).toBe(true);
    expect(regions.hide('graph')).toBe(true);
    expect(regions.hide('viewer')).toBe(false);
    expect(regions.hidden()).toEqual(['graph']);
  });

  it('keeps the graph or the viewer when the other three are hidden', () => {
    const regions = createRegions(memory().store);
    for (const region of ['list', 'viewer', 'foundation'] as const) regions.hide(region);
    expect(regions.hide('graph')).toBe(false);
    expect(regions.hidden()).toEqual(['list', 'viewer', 'foundation']);
  });

  it('reads back only known names and drops the viewer when a saved layout hid both it and the graph', () => {
    expect(parseHidden('["list","nope","list"]')).toEqual(['list']);
    expect(parseHidden('["viewer","graph","foundation"]')).toEqual(['foundation', 'graph']);
    expect(parseHidden('{"list":true}')).toEqual([]);
    expect(parseHidden('broken')).toEqual([]);
    expect(parseHidden(null)).toEqual([]);
  });

  it('maps Alt+1..4 to the four areas and Alt+0 to all, and nothing else', () => {
    const code = (value: string, init: Partial<KeyboardEvent> = {}) => shortcutTarget({ altKey: true, ctrlKey: false, metaKey: false, shiftKey: false, repeat: false, code: value, ...init } as KeyboardEvent);
    expect(REGIONS.map((_, i) => code(`Digit${i + 1}`))).toEqual([...REGIONS]);
    expect(code('Digit0')).toBe('all');
    expect(code('Numpad2')).toBe('viewer');
    expect(code('Digit5')).toBeNull();
    expect(code('KeyA')).toBeNull();
    expect(code('Digit1', { altKey: false })).toBeNull();
    expect(code('Digit1', { metaKey: true })).toBeNull();
    expect(code('Digit1', { shiftKey: true })).toBeNull();
    expect(shortcutOf('foundation')).toBe('Alt+3');
  });
});

describe('the widths the remaining areas get', () => {
  it('hands the freed width to the areas that stay, instead of leaving it unused', () => {
    const all = maxLeft(1200);
    expect(maxLeft(1200, { list: true, viewer: false, graph: true })).toBeGreaterThan(all);
    expect(maxMiddle(1200, 300, { list: false, viewer: true, graph: true })).toBeGreaterThan(maxMiddle(1200, 300));
    expect(clampWidths({ left: 5000, middle: 5000 }, 1200, { list: true, viewer: false, graph: true }).left).toBe(1200 - 6 - 28 - 300);
  });

  it('keeps the width of a hidden area as it was asked', () => {
    expect(clampWidths({ left: 300, middle: 400 }, 1200, { list: false, viewer: true, graph: true })).toEqual({ left: 300, middle: 400 });
  });
});

describe('each area hides and shows', () => {
  it.each(['list', 'viewer', 'graph'] as const)('takes the %s away behind a labelled button on its edge, and brings it back', (region) => {
    const { root, grid } = open();
    const target = area(root, region);

    collapse(root, region).click();

    expect(off(target)).toBe(true);
    expect(grid.classList.contains(`lt-hide-${region}`)).toBe(true);
    expect(off(rail(root, region))).toBe(false);
    expect(rail(root, region).getAttribute('aria-label')).toMatch(/^Show the /);
    expect(rail(root, region).dataset.tip).toContain(shortcutOf(region));

    rail(root, region).click();

    expect(off(target)).toBe(false);
    expect(grid.classList.contains(`lt-hide-${region}`)).toBe(false);
    expect(off(rail(root, region))).toBe(true);
  });

  it('gives every collapse button a name and the shortcut in its tooltip', () => {
    const { root } = open();
    for (const region of ['list', 'viewer', 'graph'] as const) {
      expect(collapse(root, region).getAttribute('aria-label')).toMatch(/^Hide the /);
      expect(collapse(root, region).dataset.tip).toContain(shortcutOf(region));
    }
  });

  it('keeps the dividers between the areas that are still there', () => {
    const { root } = open();
    const [first, second] = [...root.querySelectorAll<HTMLElement>('.lt-split')];

    collapse(root, 'viewer').click();
    expect(off(first)).toBe(false);
    expect(off(second)).toBe(true);
    rail(root, 'viewer').click();

    collapse(root, 'list').click();
    expect(off(first)).toBe(true);
    expect(off(second)).toBe(false);
  });

  it('moves focus to the restore button when the focused area goes, and into the area when it returns', () => {
    for (const region of ['list', 'viewer', 'graph'] as const) {
      const { root } = open();
      collapse(root, region).focus();
      expect(document.activeElement).toBe(collapse(root, region));

      collapse(root, region).click();
      expect(document.activeElement).toBe(rail(root, region));

      rail(root, region).click();
      expect(area(root, region).contains(document.activeElement) || area(root, region) === document.activeElement).toBe(true);
      document.body.replaceChildren();
    }
  });

  it('leaves focus alone when an area goes that did not hold it', () => {
    const { root } = open();
    collapse(root, 'viewer').focus();

    collapse(root, 'list').click();

    expect(document.activeElement).toBe(collapse(root, 'viewer'));
  });

  it('keeps the file picked in the list and the divider widths while an area is hidden', () => {
    const { root, grid } = open();
    const first = root.querySelector('.lt-split') as HTMLElement;
    first.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true, cancelable: true }));
    expect(grid.style.getPropertyValue('--lt-pane-left')).toBe('240px');

    collapse(root, 'list').click();
    rail(root, 'list').click();

    expect(grid.style.getPropertyValue('--lt-pane-left')).toBe('240px');
  });
});

describe('the last area cannot be hidden', () => {
  it('refuses to hide the graph once the viewer is gone, says so, and keeps the button marked', () => {
    const { root } = open();
    collapse(root, 'viewer').click();

    collapse(root, 'graph').click();

    expect(off(area(root, 'graph'))).toBe(false);
    expect(collapse(root, 'graph').getAttribute('aria-disabled')).toBe('true');
    expect(live(root)).toBe('The file viewer or the graph has to stay visible.');
  });

  it('keeps one of them with every other area gone', () => {
    const { root } = open();
    collapse(root, 'list').click();
    collapse(root, 'viewer').click();

    collapse(root, 'graph').click();
    press({ code: 'Digit4' });

    expect(off(area(root, 'graph'))).toBe(false);
    expect(off(area(root, 'list'))).toBe(true);
    expect(off(area(root, 'viewer'))).toBe(true);
  });
});

describe('the keyboard', () => {
  it('toggles the left column, viewer and graph with Alt+1, Alt+2 and Alt+4', () => {
    const { root } = open();

    press({ code: 'Digit1' });
    expect(off(area(root, 'list'))).toBe(true);
    press({ code: 'Digit1' });
    expect(off(area(root, 'list'))).toBe(false);

    press({ code: 'Digit2' });
    expect(off(area(root, 'viewer'))).toBe(true);
    press({ code: 'Digit4' });
    expect(off(area(root, 'graph'))).toBe(false);
    press({ code: 'Digit2' });
    expect(off(area(root, 'viewer'))).toBe(false);
    press({ code: 'Digit4' });
    expect(off(area(root, 'graph'))).toBe(true);
  });

  it('brings everything back with Alt+0', () => {
    const { root } = open();
    press({ code: 'Digit1' });
    press({ code: 'Digit4' });

    press({ code: 'Digit0' });

    expect(root.querySelectorAll('.lt-region-off:not(.lt-rail)').length).toBe(0);
    expect(saved()).toBeNull();
  });

  it('ignores the digit without Alt and other modifiers, and says so when there is no foundation to hide', () => {
    const { root } = open();
    press({ code: 'Digit1', altKey: false });
    press({ code: 'Digit1', metaKey: true });
    expect(off(area(root, 'list'))).toBe(false);

    press({ code: 'Digit3' });
    expect(live(root)).toBe('The shared foundation is only drawn in the Macro view.');
    expect(saved()).toBeNull();
  });

  it('does nothing outside a pull request review', () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    mounted.push(mountLanternView(root, MAP, {}));

    press({ code: 'Digit1' });

    expect(off(root.querySelector('.lt-side') as HTMLElement)).toBe(false);
    expect(saved()).toBeNull();
  });
});

describe('remembering the layout per project', () => {
  it('restores the hidden areas when the project is opened again, and not in another project', () => {
    const one = open({ project: '/work/alpha' });
    collapse(one.root, 'list').click();
    collapse(one.root, 'graph').click();
    expect(saved(`${REGIONS_KEY}./work/alpha`)).toEqual(['list', 'graph']);
    mounted.splice(0).forEach((view) => { view.dispose(); });
    document.body.replaceChildren();

    const again = open({ project: '/work/alpha' });
    expect(off(area(again.root, 'list'))).toBe(true);
    expect(off(area(again.root, 'graph'))).toBe(true);
    expect(off(area(again.root, 'viewer'))).toBe(false);

    const other = open({ project: '/work/beta' });
    expect(off(area(other.root, 'list'))).toBe(false);
    expect(off(area(other.root, 'graph'))).toBe(false);
    expect(saved(`${REGIONS_KEY}./work/beta`)).toBeNull();
  });

  it('keeps the divider widths per project too', () => {
    const one = open({ project: '/work/alpha' });
    const first = one.root.querySelector('.lt-split') as HTMLElement;
    first.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true, cancelable: true }));
    expect(saved(`${PANES_KEY}./work/alpha`)).toEqual(expect.anything());
    expect(localStorage.getItem(`${PANES_KEY}./work/beta`)).toBeNull();
    expect(localStorage.getItem(PANES_KEY)).toBeNull();
  });

  it('starts with everything shown when the saved layout cannot be read', () => {
    localStorage.setItem(REGIONS_KEY, '{broken');
    const { root } = open();
    expect(root.querySelectorAll('.lt-region-off:not(.lt-rail)').length).toBe(0);
  });
});

describe('Reset layout', () => {
  it('shows every area again at the default widths and forgets the saved layout', () => {
    const { root, grid } = open({ project: '/work/alpha' });
    const first = root.querySelector('.lt-split') as HTMLElement;
    first.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true, cancelable: true }));
    collapse(root, 'list').click();
    collapse(root, 'graph').click();

    (root.querySelector('.lt-layoutbar-reset') as HTMLButtonElement).click();

    expect(root.querySelectorAll('.lt-region-off:not(.lt-rail)').length).toBe(0);
    expect(grid.style.getPropertyValue('--lt-pane-left')).toBe('');
    expect(grid.style.getPropertyValue('--lt-pane-mid')).toBe('');
    expect(saved(`${REGIONS_KEY}./work/alpha`)).toBeNull();
    expect(localStorage.getItem(`${PANES_KEY}./work/alpha`)).toBeNull();
  });

  it('moves focus from a restore button into its area when everything comes back', () => {
    const { root } = open();
    collapse(root, 'list').click();
    rail(root, 'list').focus();

    press({ code: 'Digit0' });

    expect(document.activeElement).toBe(area(root, 'list'));
  });

  it('is only on offer while a pull request is being reviewed', () => {
    const { root } = open();
    const bar = root.querySelector('.lt-layoutbar') as HTMLElement;
    expect(bar.hidden).toBe(false);
    expect(bar.querySelector('.lt-layoutbar-hint')?.getAttribute('data-tip')).toContain('Alt+0');

    (root.querySelector('.pr-chip[data-pr="7"]') as HTMLElement).click();
    expect(bar.hidden).toBe(true);
  });
});

describe('the shared foundation inside the graph', () => {
  const view = macroFixtureView();
  const names = new Map(macroGraph(view).blocks.map((block) => [block.id, block.name]));
  const loaded: MacroLoad = { ok: true, view, texts: repoFeatureTexts(), blockByPath: macroFixtureBlocks(), minStrongEdge: 8 };
  const records = macroFixtureRecords();
  const nodes = records.map((r): LanternNode => node(r.path, r.role, { feature: r.feature }));
  const record = repoPrRecord('108');
  const changed = pr('108', { title: record.title, ordered: record.ordered, files: record.files.map((f) => ({ ...f, mapped: nodes.some((n) => n.path === f.path) })) });
  const BIG = mapOf({ project: 'demo', nodes, prs: [changed] });
  const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
  const drawn = (root: HTMLElement) => [...root.querySelectorAll<HTMLElement>('.lt-pixi-node-access')].map((button) => button.textContent);
  const pill = (root: HTMLElement) => root.querySelector('.lt-region-pill') as HTMLButtonElement;

  async function openMacro() {
    const root = document.createElement('div');
    document.body.appendChild(root);
    mounted.push(mountLanternView(root, BIG, { pr: '108', readMacro: () => Promise.resolve(loaded) }));
    (root.querySelector('.lt-viewbar [data-view="macro"]') as HTMLButtonElement).click();
    await flush();
    return root;
  }

  it('draws the foundation until it is hidden, then every feature without it, and draws it again when shown', async () => {
    const root = await openMacro();
    const foundation = macroGraph(view).blocks.filter((block) => block.kind === 'core').map((block) => block.name);
    expect(foundation.length).toBeGreaterThan(0);
    const features = drawn(root).filter((name) => !foundation.includes(name));
    expect(foundation.every((name) => drawn(root).includes(name))).toBe(true);
    expect(pill(root).hidden).toBe(false);
    expect(pill(root).textContent).toBe('Hide shared foundation');

    pill(root).click();
    await flush();

    expect(drawn(root).some((name) => foundation.includes(name))).toBe(false);
    expect(features.filter((name) => !drawn(root).includes(name))).toEqual([]);
    expect(pill(root).textContent).toBe('Show shared foundation');
    expect(saved()).toEqual(['foundation']);

    pill(root).click();
    await flush();

    expect(foundation.every((name) => drawn(root).includes(name))).toBe(true);
  });

  it('keeps keyboard focus on the foundation button while it hides and shows the foundation', async () => {
    const root = await openMacro();
    pill(root).focus();

    pill(root).click();
    await flush();
    expect(document.activeElement).toBe(pill(root));

    pill(root).click();
    await flush();
    expect(document.activeElement).toBe(pill(root));
  });

  it('toggles with Alt+3 and stays hidden when the project is opened again', async () => {
    const root = await openMacro();
    press({ code: 'Digit3' });
    await flush();
    expect(pill(root).textContent).toBe('Show shared foundation');
    expect(drawn(root)).not.toContain(names.get('core:shared'));
    mounted.splice(0).forEach((one) => { one.dispose(); });
    document.body.replaceChildren();

    const again = await openMacro();

    expect(drawn(again)).not.toContain(names.get('core:shared'));
    expect(pill(again).textContent).toBe('Show shared foundation');
  });

  it('offers no foundation button outside the Macro view', () => {
    const { root } = open();
    expect(pill(root).hidden).toBe(true);
  });
});
