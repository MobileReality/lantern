// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LanternNode, LanternRelation } from '../src/main/lantern';
import type { MacroLoad } from '../src/main/lantern-macro-load';
import { mountLanternView } from '../src/renderer/lib/lanternview';
import type { ViewOptions } from '../src/renderer/lib/lanternview';
import { macroFixtureRecords, repoPrRecord } from './helpers/lantern-macro-fixture';
import { areasPayload } from './helpers/lantern-macro-areas-payload';
import { mapOf, node, pr } from './helpers/lantern-map';
import { usesPayload } from './helpers/macro-uses-world';
import { pick, sizeTheMacroViewPane } from './helpers/macroview-host';

const PR_ID = '108';
const payload = areasPayload();
const records = macroFixtureRecords();
const nodes = records.map((r): LanternNode => node(r.path, r.role, { feature: r.feature }));
const relations = records.flatMap((r): LanternRelation[] => r.relations.map((x) => ({ from: r.path, arrow: x.arrow, to: x.to, ext: x.ext, symbol: null, label: '' })));
const record = repoPrRecord(PR_ID);
const changedFiles = record.files.map((f) => ({ ...f, mapped: nodes.some((n) => n.path === f.path) }));
const PLAIN = mapOf({ project: 'demo', nodes, relations });
const WITH_PR = mapOf({ project: 'demo', nodes, relations, prs: [pr(PR_ID, { title: record.title, ordered: record.ordered, files: changedFiles })] });
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
const legend = (root: HTMLElement) => root.querySelector('.lt-side .legend') as HTMLElement;
const keys = (root: HTMLElement) => [...legend(root).querySelectorAll('[data-legend]')].map((row) => row.getAttribute('data-legend'));
const help = (root: HTMLElement) => [...legend(root).querySelectorAll(':scope > p')].map((line) => line.textContent);

async function openMacro(result: MacroLoad = payload, map = PLAIN, opts: ViewOptions = {}) {
  const root = document.createElement('div');
  document.body.appendChild(root);
  mounted.push(mountLanternView(root, map, { readMacro: () => Promise.resolve(result), ...opts }));
  root.querySelector<HTMLButtonElement>('.lt-viewbar [data-view="macro"]')?.click();
  await flush();
  return root;
}

describe('the "How to read it" legend of the areas map', () => {
  it('is short at rest: the main link, the To assign shape and the outside-system chip, then two lines of help', async () => {
    const root = await openMacro();

    expect([...root.querySelectorAll('.lt-side h2')].map((heading) => heading.textContent)).toContain('How to read it');
    expect(keys(root)).toEqual(['main', 'pending', 'system']);
    expect(help(root)).toEqual(['Click selects, click again clears.', 'Double-click or Enter opens, Esc steps back.']);
    expect(legend(root).textContent?.length).toBeLessThan(260);
  });

  it('says what the dashed shape is and nothing else about dashes', async () => {
    const root = await openMacro();
    const text = legend(root).textContent ?? '';

    expect(text).toContain('Features not in an area yet');
    expect(text).toContain('Outside system, listed under the map');
    expect(text).not.toContain('not in the repo');
    expect(text).not.toContain('dashed');
    expect(legend(root).querySelectorAll('.mv-pending')).toHaveLength(1);
    expect(legend(root).querySelectorAll('[stroke-dasharray]')).toHaveLength(0);
  });

  it('has none of the old prose', async () => {
    const root = await openMacro();
    const text = legend(root).textContent ?? '';

    for (const gone of ['Only the main links', 'The number on a line', 'plumbing', 'strong:', 'weaker:']) expect(text).not.toContain(gone);
  });

  it('adds the selection styles once something is selected', async () => {
    const root = await openMacro();
    pick(root, 'block:project-map');
    await flush();

    expect(keys(root)).toEqual(['main', 'selected', 'related', 'hot', 'dim', 'pending', 'system']);
    expect(legend(root).querySelector('[data-legend="selected"] .mv-feature')?.classList.contains('is-selected')).toBe(true);
    expect(legend(root).querySelector('[data-legend="dim"] .mv-feature')?.classList.contains('is-dim')).toBe(true);
  });

  it('shows the links of the selection only for an area or a feature, the only blocks the map draws them for', async () => {
    const root = await openMacro();
    pick(root, 'block:core:desktop');
    await flush();

    expect(keys(root)).toContain('selected');
    expect(keys(root)).not.toContain('hot');
    expect(root.querySelectorAll('.lt-macroview .mv-ribbon.is-hot')).toHaveLength(0);
  });

  it('keeps the To assign key after a feature is picked, because the map still draws that shape', async () => {
    const root = await openMacro();
    pick(root, 'block:code-insight');
    await flush();

    expect(keys(root)).toContain('selected');
    expect(keys(root)).toContain('pending');
    expect(root.querySelectorAll('.lt-macroview .mv-pending')).toHaveLength(1);
  });

  it('adds the pull request style when a pull request is marked', async () => {
    const root = await openMacro(payload, WITH_PR, { pr: PR_ID, ...readers });

    expect(keys(root)).toEqual(['main', 'lit', 'pending', 'system']);
    expect(legend(root).querySelector('[data-legend="lit"] .mv-feature')?.classList.contains('is-lit')).toBe(true);
  });

  it('adds the relation count pill when an outside system is picked', async () => {
    const root = await openMacro();
    const chip = root.querySelector<HTMLElement>('.mv-dock .mv-system');
    chip?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    await flush();

    expect(keys(root)).toContain('count');
    expect(keys(root)).not.toContain('hot');
    expect(legend(root).querySelector('[data-legend="count"] .mv-count')).not.toBeNull();
  });

  it('shows the uses style only while a platform that reaches places only through relations is selected', async () => {
    const root = await openMacro(usesPayload(), PLAIN);
    expect(keys(root)).not.toContain('uses');

    pick(root, 'block:core:bot-b');
    await flush();
    expect(keys(root)).toContain('uses');
    const key = legend(root).querySelector('[data-legend="uses"] .mv-feature') as Element;
    expect(key.classList.contains('is-uses')).toBe(true);
    expect(root.querySelectorAll('.lt-macroview .is-uses').length).toBeGreaterThan(0);

    pick(root, 'block:core:bot-b');
    await flush();
    expect(keys(root)).not.toContain('uses');
  });

  it('keeps each row to a few words so it fits the side panel', async () => {
    const root = await openMacro();
    for (const row of legend(root).querySelectorAll('[data-legend]')) expect((row.querySelector('.legend-text')?.textContent ?? '').length).toBeLessThanOrEqual(40);
  });
});

describe('the "How to read it" legend of the flat Macro view', () => {
  const FLAT = { ...payload, areas: undefined } as MacroLoad;

  it('draws what the flat view draws: strong and weaker links, then two lines of help', async () => {
    const root = await openMacro(FLAT);

    expect(keys(root)).toEqual(['strong', 'weak']);
    expect(legend(root).textContent).toContain('Strong link, 8+ relations');
    expect(legend(root).textContent).toContain('Weaker link, fewer than 8');
    expect(help(root)).toEqual(['Click a block to follow its links, click again to clear.', 'The number on a line counts its relations.']);
    expect(legend(root).querySelectorAll('[stroke-dasharray]')).toHaveLength(0);
    expect(legend(root).querySelector('[data-legend="weak"] path')?.getAttribute('stroke')).toBe('var(--lt-ink-3)');
  });

  it('adds the directions and the outside-system box once a block is selected', async () => {
    const root = await openMacro(FLAT);
    root.querySelector<HTMLButtonElement>('.lt-pixi-node-access[aria-label^="Lantern map"]')?.click();
    await flush();

    expect(keys(root)).toEqual(['strong', 'weak', 'leaves', 'arrives', 'system']);
    expect(legend(root).querySelector('[data-legend="system"] rect')?.getAttribute('stroke-dasharray')).toBeNull();
  });
});
