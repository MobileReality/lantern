// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import lab from './fixtures/lantern-macro-lab.json';
import type { MacroLoad } from '../src/main/lantern-macro-load';
import { systemUses } from '../src/renderer/lib/lanternmacrosystems';
import { mountLanternView } from '../src/renderer/lib/lanternview';
import { mapOf, node } from './helpers/lantern-map';
import { WIDE_PANE, dive, flagged, label, pick, sizeTheMacroViewPane, macroViewItem, macroViewRoot } from './helpers/macroview-host';

const payload = { ok: true as const, ...lab.payload } as unknown as Extract<MacroLoad, { ok: true }>;
const FILLER = Array.from({ length: 130 }, (_, index) => node(`filler/file-${index}.ts`, 'util'));
const MAP = mapOf({ project: 'demo', nodes: FILLER });
const POSTGRES = 'ext:PostgreSQL';
const mounted: ReturnType<typeof mountLanternView>[] = [];

beforeEach(() => sizeTheMacroViewPane());

afterEach(() => {
  mounted.splice(0).forEach((one) => { one.dispose(); });
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const press = (target: Element | Document, key: string) => target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
const chips = (root: HTMLElement) => [...root.querySelectorAll<HTMLButtonElement>('.mv-dock .mv-system')];
const chip = (root: HTMLElement, name: string) => chips(root).find((one) => one.querySelector('.mv-system-name')?.textContent === name) as HTMLButtonElement;
const chipNames = (root: HTMLElement) => chips(root).map((one) => one.querySelector('.mv-system-name')?.textContent);
const detail = (root: HTMLElement) => root.querySelector('.lt-side .lt-detail') as HTMLElement | null;
const crumbs = (root: HTMLElement) => root.querySelector('.lt-crumbs')?.textContent;
const rows = (root: HTMLElement) => [...root.querySelectorAll('.lt-side .lt-detail .lt-sys-area, .lt-side .lt-detail .lt-sys-uses li')].map((row) => row.textContent?.replace(/\s+/g, ' ').trim());

async function open() {
  const root = document.createElement('div');
  document.body.appendChild(root);
  mounted.push(mountLanternView(root, MAP, { readMacro: () => Promise.resolve(payload) }));
  (root.querySelector('.lt-viewbar [data-view="macro"]') as HTMLButtonElement).click();
  await flush();
  return root;
}

describe('the relations of a system into our code', () => {
  it('groups them by area and feature, the biggest first, with the shared foundation last', () => {
    const uses = systemUses(payload, 'PostgreSQL');

    expect(uses?.total).toBe(11);
    expect(uses?.areas.map((area) => [area.name, area.count])).toEqual([['Fulfilment', 4], ['Ordering', 4], ['Insights', 2]]);
    expect(uses?.areas[0].features.map((feature) => [feature.id, feature.count])).toEqual([['stock-levels', 3], ['delivery-slots', 1]]);
    expect(uses?.foundation.map((entry) => [entry.id, entry.count])).toEqual([['core:service', 1]]);
  });

  it('puts a feature that is in no area under To assign, and knows nothing of a system the project does not use', () => {
    const lonely = { ...payload, view: { ...payload.view, external: [...payload.view.external, { system: 'Loyalty ledger', blocks: [{ block: 'loyalty-points', count: 2 }] }] } };

    expect(systemUses(lonely, 'Loyalty ledger')?.areas.map((area) => [area.id, area.name, area.count])).toEqual([['to-assign', 'To assign', 2]]);
    expect(systemUses(payload, 'Nothing')).toBeNull();
  });

  it('gives nothing for a project without areas, which keeps the flat panel', () => {
    expect(systemUses({ view: payload.view, areas: undefined }, 'PostgreSQL')).toBeNull();
  });
});

describe('the list of outside systems in the real Macro view', () => {
  it('is listed from the start, below the map, with every system and its count', async () => {
    const root = await open();

    expect(chipNames(root)).toEqual(['PostgreSQL', 'Card Gateway', 'Email Provider', 'Object Storage', 'Identity Provider', 'Courier Gateway', 'Search Index']);
    expect(root.querySelector('.lt-macroview-host .mv-dock')).not.toBeNull();
    expect(detail(root)).toBeNull();
  });

  it('filters when a block is clicked on the map, and lists everything again with Show all, keeping the block selected', async () => {
    const root = await open();

    pick(root, 'block:ordering');
    expect(chipNames(root)).toEqual(['PostgreSQL', 'Card Gateway']);
    expect(macroViewItem(root, 'block:ordering').getAttribute('aria-pressed')).toBe('true');

    (root.querySelector('[data-dock-toggle]') as HTMLButtonElement).click();
    expect(chipNames(root)).toHaveLength(7);
    expect(macroViewItem(root, 'block:ordering').getAttribute('aria-pressed')).toBe('true');
    expect(detail(root)?.textContent).toContain('Ordering');
  });

  it('filters to a foundation entry and to the whole band', async () => {
    const root = await open();

    pick(root, 'block:core:service');
    expect(chipNames(root)).toEqual(expect.arrayContaining(['PostgreSQL', 'Email Provider', 'Object Storage', 'Search Index']));
    expect(chipNames(root)).toHaveLength(4);

    pick(root, 'band:foundation');
    expect(chipNames(root)).toHaveLength(4);
  });

  it('selects a system from the list: the map lights who talks to it and the panel lists its relations by area and feature', async () => {
    const root = await open();

    chip(root, 'PostgreSQL').click();

    expect(chip(root, 'PostgreSQL').getAttribute('aria-pressed')).toBe('true');
    expect(flagged(root, 'is-related', '.mv-area')).toEqual(['block:fulfilment', 'block:insights', 'block:ordering']);
    expect(flagged(root, 'is-related', '.mv-entry')).toEqual(['block:core:service']);
    expect(label(root, 'block:ordering')).toContain('4 relations with PostgreSQL');
    expect(detail(root)?.querySelector('.path')?.textContent).toBe('PostgreSQL');
    expect(detail(root)?.querySelector('.role')?.textContent).toBe('outside system · 11 relations');
    expect(rows(root)).toEqual([
      'Fulfilment 4 relations',
      'Stock levels 3 relations',
      'Delivery slots 1 relation',
      'Ordering 4 relations',
      'Checkout 2 relations',
      'Cart 1 relation',
      'Order history 1 relation',
      'Insights 2 relations',
      'Sales reports 2 relations',
      'Shared foundation 1 relation',
      'Service 1 relation',
    ]);
  });

  it('clears the system when its entry is clicked again', async () => {
    const root = await open();
    chip(root, 'PostgreSQL').click();

    chip(root, 'PostgreSQL').click();

    expect(detail(root)).toBeNull();
    expect(flagged(root, 'is-related')).toEqual([]);
    expect(chip(root, 'PostgreSQL').getAttribute('aria-pressed')).toBe('false');
  });

  it('clears the system with Escape, from the map and from an entry of the list', async () => {
    const root = await open();
    chip(root, 'Card Gateway').click();
    expect(detail(root)).not.toBeNull();

    press(macroViewRoot(root), 'Escape');
    expect(detail(root)).toBeNull();
    expect(flagged(root, 'is-related')).toEqual([]);

    chip(root, 'Card Gateway').click();
    chip(root, 'Card Gateway').focus();
    press(chip(root, 'Card Gateway'), 'Escape');
    expect(detail(root)).toBeNull();
    expect(chip(root, 'Card Gateway').getAttribute('aria-pressed')).toBe('false');
  });

  it('selects a feature from the panel, entering its area, and the list then shows the systems of that feature', async () => {
    sizeTheMacroViewPane(WIDE_PANE);
    const root = await open();
    chip(root, 'PostgreSQL').click();

    (root.querySelector('.lt-side .lt-detail [data-macro-feature="stock-levels"]') as HTMLButtonElement).click();
    await flush();

    expect(crumbs(root)).toBe('Areas›Fulfilment');
    expect(macroViewItem(root, 'block:stock-levels').getAttribute('aria-pressed')).toBe('true');
    expect(chipNames(root)).toEqual(['PostgreSQL']);
    expect(detail(root)?.querySelector('.path')?.textContent).toBe('Stock levels');
  });

  it('selects an area from the panel, leaving the area it was inside', async () => {
    sizeTheMacroViewPane(WIDE_PANE);
    const root = await open();
    dive(root, 'block:ordering');
    expect(crumbs(root)).toBe('Areas›Ordering');
    chip(root, 'PostgreSQL').click();

    (root.querySelector('.lt-side .lt-detail [data-macro-area="block:fulfilment"]') as HTMLButtonElement).click();
    await flush();

    expect(crumbs(root)).toBe('Areas');
    expect(macroViewItem(root, 'block:fulfilment').getAttribute('aria-pressed')).toBe('true');
    expect(detail(root)?.querySelector('.path')?.textContent).toBe('Fulfilment');
  });

  it('selects a foundation entry from the panel', async () => {
    const root = await open();
    chip(root, 'PostgreSQL').click();

    (root.querySelector('.lt-side .lt-detail [data-macro-go="block:core:service"]') as HTMLButtonElement).click();

    expect(macroViewItem(root, 'block:core:service').getAttribute('aria-pressed')).toBe('true');
    expect(chipNames(root)).toHaveLength(4);
  });

  it('shows a system only the shared foundation talks to', async () => {
    const onlyFoundation = { ...payload, view: { ...payload.view, external: [...payload.view.external, { system: 'Metrics sink', blocks: [{ block: 'core:service', count: 3 }] }] } };
    const root = document.createElement('div');
    document.body.appendChild(root);
    mounted.push(mountLanternView(root, MAP, { readMacro: () => Promise.resolve(onlyFoundation) }));
    (root.querySelector('.lt-viewbar [data-view="macro"]') as HTMLButtonElement).click();
    await flush();

    expect(chipNames(root)).toContain('Metrics Sink');
    chip(root, 'Metrics Sink').click();

    expect(flagged(root, 'is-related', '.mv-area')).toEqual([]);
    expect(flagged(root, 'is-related', '.mv-entry')).toEqual(['block:core:service']);
    expect(rows(root)).toEqual(['Shared foundation 3 relations', 'Service 3 relations']);
  });
});
