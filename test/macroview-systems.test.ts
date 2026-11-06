// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import lab from './fixtures/lantern-macro-lab.json';
import { dockView } from '../src/renderer/lib/macroview/dock';
import { relatedTo } from '../src/renderer/lib/macroview/focus';
import { deriveMarks } from '../src/renderer/lib/macroview/marks';
import { buildModel } from '../src/renderer/lib/macroview/model';
import type { AreasPayload, MountedMacroView, MacroViewContext } from '../src/renderer/lib/macroview/types';
import { mountMacroView } from '../src/renderer/lib/macroview/mount';

const payload = lab.payload as unknown as AreasPayload;
const model = buildModel(payload);
const POSTGRES = 'ext:PostgreSQL';
const GATEWAY = 'ext:Card gateway';
const CHECKOUT_REPOSITORY = 'api/checkout/checkout.repository.ts';
const CHECKOUT_SCHEMA = 'api/checkout/checkout.schema.ts';
const none = deriveMarks(model, { prMarks: null, reading: { file: null, blocks: new Set() }, flowStep: null, payload });

const systemOf = (key: string) => model.systems.find((system) => system.key === key)!;
const names = (view: ReturnType<typeof dockView>) => view.items.map((item) => `${item.name} ${item.count}`);
const rest = (selection: string | null, showAll = false, file: string | null = null) => dockView({ model, marks: none, related: relatedTo(model, selection, null, file), selection, showAll, file });

describe('the outside systems of a project, counted per block', () => {
  it('lists every system of the project, the one with the most relations first', () => {
    expect(model.systems.map((system) => [system.id, system.total])).toEqual([
      ['PostgreSQL', 11],
      ['Card gateway', 5],
      ['Email provider', 4],
      ['Object storage', 4],
      ['Identity provider', 3],
      ['Courier gateway', 2],
      ['Search index', 2],
    ]);
  });

  it('counts the relations of a system in each feature, each foundation entry and each area', () => {
    const postgres = systemOf(POSTGRES);

    expect([...postgres.features]).toEqual(expect.arrayContaining([['checkout', 2], ['stock-levels', 3], ['cart', 1]]));
    expect([...postgres.foundation]).toEqual([['core:service', 1]]);
    expect(Object.fromEntries(postgres.areas)).toEqual({ ordering: 4, fulfilment: 4, insights: 2 });
    expect(postgres.total).toBe([...postgres.features.values(), ...postgres.foundation.values()].reduce((a, b) => a + b, 0));
    expect(postgres.total).toBe([...postgres.areas.values(), ...postgres.foundation.values()].reduce((a, b) => a + b, 0));
  });

  it('keeps a system only the foundation talks to, which the old tray never showed', () => {
    const only = model.systems.filter((system) => system.features.size === 0);

    expect(only.every((system) => system.foundation.size > 0)).toBe(true);
    expect(model.systems.length).toBe(payload.view.external.length);
  });

  it('turns that around: the systems a feature or a foundation entry talks to, with counts', () => {
    expect(Object.fromEntries(model.usesOfBlock.get('checkout') ?? [])).toEqual({ [POSTGRES]: 2, [GATEWAY]: 1 });
    expect(Object.fromEntries(model.usesOfBlock.get('core:service') ?? [])).toEqual({ [POSTGRES]: 1, 'ext:Email provider': 1, 'ext:Object storage': 1, 'ext:Search index': 1 });
    expect(model.usesOfBlock.has('price-rules')).toBe(false);
  });

  it('knows the systems of a single file', () => {
    expect(Object.fromEntries(model.usesOfFile.get(CHECKOUT_REPOSITORY) ?? [])).toEqual({ [POSTGRES]: 1, [GATEWAY]: 1 });
    expect(Object.fromEntries(model.usesOfFile.get(CHECKOUT_SCHEMA) ?? [])).toEqual({ [POSTGRES]: 1 });
    expect(model.usesOfFile.has('web/checkout/CheckoutPage.tsx')).toBe(false);
  });
});

describe('what a selection lights', () => {
  it('lights every feature, area and foundation entry that talks to a selected system, with counts', () => {
    const related = relatedTo(model, POSTGRES);

    expect(related.keys).toEqual(expect.objectContaining({}));
    for (const key of ['block:checkout', 'block:cart', 'block:stock-levels', 'block:ordering', 'block:fulfilment', 'block:insights', 'block:core:service']) expect(related.keys.has(key)).toBe(true);
    expect(related.keys.has('block:catalog')).toBe(false);
    expect(related.keys.has('block:accounts')).toBe(false);
    expect(Object.fromEntries(related.counts)).toEqual(expect.objectContaining({ 'block:checkout': 2, 'block:stock-levels': 3, 'block:ordering': 4, 'block:fulfilment': 4, 'block:insights': 2, 'block:core:service': 1 }));
    expect(related.uses.size).toBe(0);
  });

  it('gives no count to a block that does not talk to the system', () => {
    const related = relatedTo(model, GATEWAY);

    expect(related.counts.get('block:cart')).toBeUndefined();
    expect(related.counts.get('block:payments')).toBe(5 - 1);
    expect(related.counts.get('block:ordering')).toBe(1);
  });

  it('lists the systems of a feature, an area, a foundation entry and the whole band', () => {
    expect([...relatedTo(model, 'block:checkout').systems].sort()).toEqual([GATEWAY, POSTGRES]);
    expect(relatedTo(model, 'block:ordering').systemCounts.get(POSTGRES)).toBe(4);
    expect([...relatedTo(model, 'block:core:service').systems].sort()).toEqual(['ext:Email provider', 'ext:Object storage', POSTGRES, 'ext:Search index']);
    expect(relatedTo(model, 'band:foundation').systemCounts.get(POSTGRES)).toBe(1);
  });

  it('narrows a feature to one file when the file is the pick', () => {
    const related = relatedTo(model, 'block:checkout', null, CHECKOUT_SCHEMA);

    expect([...related.systems]).toEqual([POSTGRES]);
    expect(related.systemCounts.get(POSTGRES)).toBe(1);
  });

  it('ignores a file that is not in the selected feature', () => {
    expect([...relatedTo(model, 'block:cart', null, CHECKOUT_REPOSITORY).systems]).toContain(POSTGRES);
    expect(relatedTo(model, 'block:cart', null, CHECKOUT_REPOSITORY).systemCounts.get(POSTGRES)).toBe(1);
  });

  it('lights nothing when nothing is selected', () => {
    const related = relatedTo(model, null);

    expect(related.keys.size + related.systems.size + related.counts.size + related.systemCounts.size).toBe(0);
  });
});

describe('the list of outside systems', () => {
  it('shows every system with its relation count when nothing is selected', () => {
    const view = rest(null);

    expect(names(view)).toEqual(['PostgreSQL 11', 'Card Gateway 5', 'Email Provider 4', 'Object Storage 4', 'Identity Provider 3', 'Courier Gateway 2', 'Search Index 2']);
    expect(view.toggle).toBeNull();
    expect(view.note).toBe('7 systems');
    expect(view.items.every((item) => !item.linked && !item.selected)).toBe(true);
  });

  it('is filtered to the systems a selected feature talks to, counted from that feature', () => {
    const view = rest('block:checkout');

    expect(names(view)).toEqual(['PostgreSQL 2', 'Card Gateway 1']);
    expect(view.note).toBe('2 of 7 systems talk to Checkout');
    expect(view.toggle).toMatchObject({ label: 'Show all', pressed: false });
  });

  it('is filtered for an area, a foundation entry and the whole band', () => {
    expect(names(rest('block:ordering'))).toEqual(['PostgreSQL 4', 'Card Gateway 1']);
    expect(rest('block:core:service').items).toHaveLength(4);
    expect(rest('block:core:service').note).toBe('4 of 7 systems talk to Service');
    expect(rest('band:foundation').note).toContain('Shared foundation');
  });

  it('is filtered to one file when a file is picked, and names the file', () => {
    const view = rest('block:checkout', false, CHECKOUT_SCHEMA);

    expect(names(view)).toEqual(['PostgreSQL 1']);
    expect(view.note).toBe('1 of 7 systems talks to checkout.schema.ts');
  });

  it('says so, and offers every system, when the selection talks to none', () => {
    const view = rest('block:price-rules');

    expect(view.items).toEqual([]);
    expect(view.empty).toBe('Price rules talks to no outside system.');
    expect(view.note).toBe('0 of 7 systems talk to Price rules');
    expect(view.toggle?.label).toBe('Show all');
  });

  it('lists every system again after Show all, with the ones the selection talks to marked', () => {
    const view = rest('block:checkout', true);

    expect(view.items).toHaveLength(7);
    expect(view.items.filter((item) => item.linked).map((item) => item.name).sort()).toEqual(['Card Gateway', 'PostgreSQL']);
    expect(view.toggle).toMatchObject({ label: 'Only those of Checkout', pressed: true });
    expect(view.note).toBe('all 7 systems, 2 talk to Checkout');
  });

  it('keeps the whole list when a system itself is selected, and marks the selected one', () => {
    const view = rest(POSTGRES);

    expect(view.items).toHaveLength(7);
    expect(view.items.filter((item) => item.selected).map((item) => item.name)).toEqual(['PostgreSQL']);
    expect(view.toggle).toBeNull();
  });

  it('marks the systems a pull request touches', () => {
    const marks = { ...none, systems: new Set([GATEWAY]) };
    const view = dockView({ model, marks, related: relatedTo(model, null), selection: null, showAll: false, file: null });

    expect(view.items.filter((item) => item.lit).map((item) => item.name)).toEqual(['Card Gateway']);
    expect(view.items.find((item) => item.lit)?.label).toContain('touched by the pull request');
  });

  it('describes each entry for a screen reader with its name, relations and blocks', () => {
    const [first] = rest(null).items;

    expect(first.label).toBe('PostgreSQL, outside system, 11 relations, used by 7 blocks');
  });
});

describe('the list on screen', () => {
  interface Spies {
    select: ReturnType<typeof vi.fn>;
    enter: ReturnType<typeof vi.fn>;
    leave: ReturnType<typeof vi.fn>;
    openFile: ReturnType<typeof vi.fn>;
  }

  let spies: Spies;
  let host: HTMLElement;
  let mounted: MountedMacroView | null = null;

  const context = (extra: Partial<MacroViewContext> = {}): MacroViewContext => ({
    payload,
    scene: { level: 'areas', files: 0, tests: 0, relations: 0, blocks: [], edges: [], systems: [] },
    prMarks: null,
    reading: { file: null, blocks: new Set() },
    flowStep: null,
    selection: null,
    foundation: null,
    openFile: spies.openFile as never,
    select: spies.select as never,
    enter: spies.enter as never,
    leave: spies.leave as never,
    ...extra,
  });
  const chips = () => [...host.querySelectorAll<HTMLButtonElement>('.mv-system')];
  const chipNames = () => chips().map((chip) => chip.querySelector('.mv-system-name')?.textContent);
  const chip = (name: string) => chips().find((candidate) => candidate.querySelector('.mv-system-name')?.textContent === name) as HTMLButtonElement;
  const item = (key: string) => host.querySelector(`.lt-macroview [data-key="${key}"]`) as SVGGElement;
  const toggle = () => host.querySelector('[data-dock-toggle]') as HTMLButtonElement;
  const note = () => host.querySelector('.mv-dock-note')?.textContent;
  const flagged = (flag: string) => [...host.querySelectorAll(`.lt-macroview .mv-item.${flag}`)].map((node) => node.getAttribute('data-key')).sort();
  const pill = (key: string) => item(key).querySelector(':scope > .mv-count')?.querySelector('.mv-badge-text')?.textContent;
  const keydown = (target: Element, key: string) => {
    const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
    target.dispatchEvent(event);
    return event;
  };

  beforeEach(() => {
    spies = { select: vi.fn(), enter: vi.fn(() => true), leave: vi.fn(() => true), openFile: vi.fn() };
    host = document.createElement('div');
    document.body.appendChild(host);
    const sized = (property: 'clientWidth' | 'clientHeight', value: number) =>
      vi.spyOn(HTMLElement.prototype, property, 'get').mockImplementation(function (this: HTMLElement) {
        return this.classList.contains('lt-macroview') ? value : 0;
      });
    sized('clientWidth', 700);
    sized('clientHeight', 880);
    Object.assign(HTMLElement.prototype, { setPointerCapture: () => undefined, releasePointerCapture: () => undefined, hasPointerCapture: () => true });
    window.matchMedia = ((query: string) => ({ matches: query.includes('reduce'), media: query, addEventListener: () => undefined, removeEventListener: () => undefined })) as never;
  });

  afterEach(() => {
    mounted?.destroy();
    mounted = null;
    host.remove();
    vi.restoreAllMocks();
  });

  function mount(extra: Partial<MacroViewContext> = {}) {
    mounted = mountMacroView(host, context(extra));
    return mounted;
  }

  it('is there at rest, below the map, with every system and its count, and is a labelled region', () => {
    mount();

    const dock = host.querySelector('.mv-dock') as HTMLElement;
    expect(dock.hidden).toBe(false);
    expect(dock.getAttribute('aria-label')).toBe('Outside systems');
    expect(dock.previousElementSibling?.classList.contains('lt-macroview')).toBe(true);
    expect(chipNames()).toEqual(['PostgreSQL', 'Card Gateway', 'Email Provider', 'Object Storage', 'Identity Provider', 'Courier Gateway', 'Search Index']);
    expect(chips().map((one) => one.querySelector('.mv-system-count')?.textContent)).toEqual(['11', '5', '4', '4', '3', '2', '2']);
    expect(chip('PostgreSQL').getAttribute('aria-label')).toBe('PostgreSQL, outside system, 11 relations, used by 7 blocks');
    expect(note()).toBe('7 systems');
    expect(toggle().hidden).toBe(true);
    expect(host.children).toHaveLength(1);
  });

  it('draws no line to a system at rest and no system among the shapes of the map', () => {
    mount();

    expect(host.querySelector('.lt-macroview .mv-ribbon.is-system')).toBeNull();
    expect(host.querySelector(`.lt-macroview [data-key^="ext:"]`)).toBeNull();
  });

  it('filters to the systems a clicked block talks to, and Show all lists the rest without selecting anything', () => {
    const handle = mount();
    handle.update(context({ selection: 'block:checkout' }));

    expect(chipNames()).toEqual(['PostgreSQL', 'Card Gateway']);
    expect(chips().map((one) => one.querySelector('.mv-system-count')?.textContent)).toEqual(['2', '1']);
    expect(note()).toBe('2 of 7 systems talk to Checkout');
    expect(toggle().hidden).toBe(false);
    expect(toggle().textContent).toBe('Show all');

    toggle().click();
    expect(chipNames()).toHaveLength(7);
    expect(chip('PostgreSQL').classList.contains('is-linked')).toBe(true);
    expect(chip('Search Index').classList.contains('is-linked')).toBe(false);
    expect(toggle().textContent).toBe('Only those of Checkout');
    expect(toggle().getAttribute('aria-pressed')).toBe('true');
    expect(spies.select).not.toHaveBeenCalled();

    toggle().click();
    expect(chipNames()).toEqual(['PostgreSQL', 'Card Gateway']);
  });

  it('goes back to the filter when another block is selected after Show all', () => {
    const handle = mount();
    handle.update(context({ selection: 'block:checkout' }));
    toggle().click();

    handle.update(context({ selection: 'block:cart' }));

    expect(chipNames()).toEqual(['PostgreSQL']);
    expect(note()).toBe('1 of 7 systems talks to Cart');
  });

  it('says a block talks to no system and offers the whole list', () => {
    const handle = mount();
    handle.update(context({ selection: 'block:price-rules' }));

    expect(chipNames()).toEqual([]);
    expect((host.querySelector('.mv-dock-empty') as HTMLElement).hidden).toBe(false);
    expect(host.querySelector('.mv-dock-empty')?.textContent).toBe('Price rules talks to no outside system.');
    toggle().click();
    expect(chipNames()).toHaveLength(7);
  });

  it('selects a system when its entry is clicked, and clears it when it is clicked again', () => {
    const handle = mount();

    chip('Card Gateway').click();
    expect(spies.select).toHaveBeenLastCalledWith(GATEWAY);

    handle.update(context({ selection: GATEWAY }));
    chip('Card Gateway').click();
    expect(spies.select).toHaveBeenLastCalledWith(null);
  });

  it('lights the areas, features and foundation entries that talk to a selected system, with counts, and dims the rest', () => {
    const handle = mount();
    handle.update(context({ selection: POSTGRES }));

    expect(chip('PostgreSQL').getAttribute('aria-pressed')).toBe('true');
    expect(chipNames()).toHaveLength(7);
    const related = flagged('is-related');
    for (const key of ['block:ordering', 'block:fulfilment', 'block:insights', 'block:checkout', 'block:cart', 'block:stock-levels', 'block:core:service']) expect(related).toContain(key);
    for (const key of ['block:catalog', 'block:accounts', 'block:payments']) expect(flagged('is-dim')).toContain(key);
    expect(flagged('is-uses')).toEqual([]);
    expect(flagged('is-selected')).toEqual([]);
    expect(pill('block:ordering')).toBe('4 relations');
    expect(pill('block:fulfilment')).toBe('4 relations');
    expect(pill('block:core:service')).toBe('1×');
    expect(item('block:ordering').getAttribute('aria-label')).toContain('4 relations with PostgreSQL');
    expect(item('block:core:service').getAttribute('aria-label')).toContain('1 relation with PostgreSQL');
  });

  it('shows the count on a feature once the area is open, and draws no count on one that does not talk to the system', () => {
    const handle = mount();
    handle.update(context({ selection: POSTGRES }));
    const dive = item('block:ordering').querySelector('.mv-shape') as Element;
    dive.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }));

    expect(pill('block:checkout')).toBe('2 relations');
    expect(pill('block:cart')).toBe('1 relation');
    expect(pill('block:order-history')).toBe('1 relation');
    expect(item('block:product-listing').querySelector(':scope > .mv-count')?.getAttribute('style')).toContain('display: none');
  });

  it('draws no counts and no lit shapes once the system is no longer selected', () => {
    const handle = mount();
    handle.update(context({ selection: POSTGRES }));

    handle.update(context({ selection: null }));

    expect(flagged('is-related')).toEqual([]);
    expect(flagged('is-dim')).toEqual([]);
    expect(host.querySelectorAll('.lt-macroview .mv-count[style*="display: none"]').length).toBe(host.querySelectorAll('.lt-macroview .mv-count').length);
  });

  it('clears a selected system with Escape on the map and on an entry of the list', () => {
    const handle = mount();
    handle.update(context({ selection: GATEWAY }));

    const onMap = keydown(host.querySelector('.lt-macroview') as Element, 'Escape');
    expect(onMap.defaultPrevented).toBe(true);
    expect(spies.select).toHaveBeenLastCalledWith(null);

    spies.select.mockClear();
    const onEntry = keydown(chip('PostgreSQL'), 'Escape');
    expect(onEntry.defaultPrevented).toBe(true);
    expect(spies.select).toHaveBeenCalledWith(null);
  });

  it('lets Escape through when nothing is selected, so the host can step out', () => {
    mount();

    const event = keydown(chip('PostgreSQL'), 'Escape');

    expect(event.defaultPrevented).toBe(false);
    expect(spies.select).not.toHaveBeenCalled();
  });

  it('moves between the entries with the arrow keys, Home and End', () => {
    mount();
    chip('PostgreSQL').focus();

    keydown(chip('PostgreSQL'), 'ArrowRight');
    expect(document.activeElement).toBe(chip('Card Gateway'));
    keydown(chip('Card Gateway'), 'End');
    expect(document.activeElement).toBe(chip('Search Index'));
    keydown(chip('Search Index'), 'Home');
    expect(document.activeElement).toBe(chip('PostgreSQL'));
    keydown(chip('PostgreSQL'), 'ArrowLeft');
    expect(document.activeElement).toBe(chip('PostgreSQL'));
  });

  it('keeps the focus on the entry the user is on when the list repaints', () => {
    const handle = mount();
    chip('Card Gateway').focus();

    handle.update(context({ selection: GATEWAY }));

    expect(document.activeElement).toBe(chip('Card Gateway'));
  });

  it('filters to the systems of a file when a file row is picked', () => {
    const handle = mount();
    handle.update(context({ selection: 'block:checkout' }));
    const dive = item('block:checkout').querySelector('.mv-shape') as Element;
    dive.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }));
    const row = host.querySelector(`.mv-file[data-path="${CHECKOUT_SCHEMA}"]`) as Element;
    expect(row).not.toBeNull();

    row.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, cancelable: true, button: 0 }));
    row.dispatchEvent(new MouseEvent('pointerup', { bubbles: true, cancelable: true, button: 0 }));
    handle.update(context({ selection: 'block:checkout' }));

    expect(spies.openFile).toHaveBeenCalledWith(CHECKOUT_SCHEMA);
    expect(chipNames()).toEqual(['PostgreSQL']);
    expect(note()).toBe('1 of 7 systems talks to checkout.schema.ts');
  });

  it('lights the systems a pull request touches in the list', () => {
    const impact = { blocks: new Map(), edges: new Set<string>(), systems: new Set(['Card gateway']), links: new Set<string>(), other: { unmapped: [], tests: [], unplaced: [], foundation: [] }, changed: 1 };
    mount({ prMarks: { pr: {}, impact, marks: {}, members: new Map() } as never });

    expect(chip('Card Gateway').classList.contains('is-lit')).toBe(true);
    expect(chip('PostgreSQL').classList.contains('is-lit')).toBe(false);
  });
});
