// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LanternNode, LanternRelation } from '../src/main/lantern';
import type { MacroLoad } from '../src/main/lantern-macro-load';
import { mountLanternView } from '../src/renderer/lib/lanternview';
import type { ViewOptions } from '../src/renderer/lib/lanternview';
import { macroFixtureRecords, repoPrRecord } from './helpers/lantern-macro-fixture';
import { areasPayload } from './helpers/lantern-macro-areas-payload';
import { mapOf, node, pr } from './helpers/lantern-map';

const PR_ID = '108';
const payload: MacroLoad = areasPayload();
const records = macroFixtureRecords();
const nodes = records.map((r): LanternNode => node(r.path, r.role, { feature: r.feature }));
const relations = records.flatMap((r): LanternRelation[] => r.relations.map((x) => ({ from: r.path, arrow: x.arrow, to: x.to, ext: x.ext, symbol: null, label: '' })));
const record = repoPrRecord(PR_ID);
const files = record.files.map((f) => ({ ...f, mapped: nodes.some((n) => n.path === f.path) }));
const WITH_PR = mapOf({ project: 'demo', nodes, relations, prs: [pr(PR_ID, { title: record.title, ordered: record.ordered, files })] });

const readers: ViewOptions = {
  readFile: async (path) => ({ exists: true, text: `live ${path}\n`, truncated: 0 }),
  readPrFile: async (_pr, path) => ({ ok: true, text: `branch ${path}\n`, truncated: false, binary: false, version: 'branch' }),
  readPrDiff: async (_pr, path) => ({ ok: true, diff: `@@ -1 +1 @@\n-old ${path}\n+new ${path}`, truncated: false, binary: false }),
};

const mounted: ReturnType<typeof mountLanternView>[] = [];
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const crumbs = (root: HTMLElement) => root.querySelector('.lt-crumbs')?.textContent ?? '';
const macroViewRoot = (root: HTMLElement) => root.querySelector('.lt-macroview-host .lt-macroview') as HTMLElement;
const keydown = (target: Element, key: string) => target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));

async function open(extra: ViewOptions = {}) {
  const root = document.createElement('div');
  document.body.appendChild(root);
  mounted.push(mountLanternView(root, WITH_PR, { readMacro: () => Promise.resolve(payload), pr: PR_ID, ...readers, ...extra }));
  root.querySelector<HTMLButtonElement>('.lt-viewbar [data-view="macro"]')?.click();
  await flush();
  return root;
}

beforeEach(() => {
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

describe('the areas map inside the real Macro view', () => {
  it('draws the areas of the project in the Macro view host and hides the canvas', async () => {
    const root = await open();
    expect(macroViewRoot(root)).not.toBeNull();
    expect((root.querySelector('.lt-macroview-host') as HTMLElement).hidden).toBe(false);
    expect((root.querySelector('.lt-pixi-host') as HTMLElement).hidden).toBe(true);
    const names = [...macroViewRoot(root).querySelectorAll('.mv-area')].map((area) => area.getAttribute('aria-label')?.split(',')[0]);
    expect(names).toEqual(expect.arrayContaining(['Project map', 'Pull request review', 'Agent sessions', 'Workspace setup']));
    expect(crumbs(root)).toBe('Areas');
  });

  it('dives into an area with Enter, the breadcrumb follows, and a single Escape brings it back', async () => {
    const root = await open();
    const view = macroViewRoot(root);
    keydown(view, 'ArrowRight');
    keydown(view, 'Enter');
    expect(crumbs(root)).not.toBe('Areas');
    expect(crumbs(root)).toMatch(/Areas/);
    expect(Number(view.dataset.zoom)).toBeGreaterThan(1.5);
    keydown(view, 'Escape');
    expect(crumbs(root)).toBe('Areas');
    expect(Number(view.dataset.zoom)).toBe(1);
    keydown(view, 'Escape');
    expect(crumbs(root)).toBe('Areas');
  });

  it('follows the host when its breadcrumb goes back up', async () => {
    const root = await open();
    const view = macroViewRoot(root);
    keydown(view, 'ArrowRight');
    keydown(view, 'Enter');
    expect(Number(view.dataset.zoom)).toBeGreaterThan(1.5);
    root.querySelector<HTMLButtonElement>('.lt-graph-crumbs [data-macro-up]')?.click();
    expect(crumbs(root)).toBe('Areas');
    expect(Number(view.dataset.zoom)).toBe(1);
  });

  it('selects through the host, whose side panel then shows the area', async () => {
    const root = await open();
    const view = macroViewRoot(root);
    view.querySelector('[data-key="block:project-map"] .mv-shape')?.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 }));
    view.querySelector('[data-key="block:project-map"] .mv-shape')?.dispatchEvent(new MouseEvent('pointerup', { bubbles: true, button: 0 }));
    expect(view.querySelector('[data-key="block:project-map"]')?.classList.contains('is-selected')).toBe(true);
    expect(root.querySelector('.lt-side .lt-detail')?.textContent).toContain('mapping a project and reading its code');
    keydown(view, 'Escape');
    expect(view.querySelector('.is-selected')).toBeNull();
    expect(root.querySelector('.lt-side .lt-detail')).toBeNull();
  });

  it('lights the areas the pull request touches and keeps the marks after a look at Files', async () => {
    const root = await open();
    expect(macroViewRoot(root).querySelectorAll('.mv-area.is-lit').length).toBeGreaterThan(0);
    root.querySelector<HTMLButtonElement>('.lt-viewbar [data-view="files"]')?.click();
    expect(macroViewRoot(root)).toBeNull();
    expect((root.querySelector('.lt-macroview-host') as HTMLElement).childElementCount).toBe(0);
    root.querySelector<HTMLButtonElement>('.lt-viewbar [data-view="macro"]')?.click();
    await flush();
    expect(macroViewRoot(root).querySelectorAll('.mv-area.is-lit').length).toBeGreaterThan(0);
  });

  it('offers no layout to choose from and mounts the map once while it stays on screen', async () => {
    const root = await open();
    const map = macroViewRoot(root);

    expect(root.querySelector('.lt-viewbar select')).toBeNull();
    keydown(map, 'ArrowRight');
    expect(macroViewRoot(root)).toBe(map);
  });

  it('keeps the host from also acting on a key the map handled', async () => {
    const root = await open();
    const view = macroViewRoot(root);
    keydown(view, 'ArrowRight');
    keydown(view, 'Enter');
    const before = crumbs(root);
    const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    view.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(before).not.toBe(crumbs(root));
    expect(crumbs(root)).toBe('Areas');
  });
});
