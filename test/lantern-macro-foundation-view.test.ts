// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MacroLoad } from '../src/main/lantern-macro-load';
import { mountLanternView } from '../src/renderer/lib/lanternview';
import { foundationPayload } from './helpers/macro-foundation-world';
import { mapOf, node } from './helpers/lantern-map';
import { WIDE_PANE, dive, pick, sizeTheMacroViewPane, macroViewItem } from './helpers/macroview-host';

const FILLER = Array.from({ length: 130 }, (_, index) => node(`filler/file-${index}.ts`, 'util'));
const MAP = mapOf({ project: 'demo', nodes: FILLER });
const mounted: ReturnType<typeof mountLanternView>[] = [];

beforeEach(() => sizeTheMacroViewPane());

afterEach(() => {
  mounted.splice(0).forEach((one) => { one.dispose(); });
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const detail = (root: HTMLElement) => root.querySelector('.lt-side .lt-detail')?.textContent ?? '';
const sentences = (root: HTMLElement) => [...root.querySelectorAll('.lt-side .lt-detail .lt-sentence')].map((one) => one.textContent ?? '');

async function open(result: MacroLoad = foundationPayload()) {
  const root = document.createElement('div');
  document.body.appendChild(root);
  mounted.push(mountLanternView(root, MAP, { readMacro: () => Promise.resolve(result) }));
  (root.querySelector('.lt-viewbar [data-view="macro"]') as HTMLButtonElement).click();
  await flush();
  return root;
}

describe('the side panel of a foundation tile at the top level', () => {
  it('lists what a platform uses, with counts, instead of saying it has no relations', async () => {
    const root = await open();

    pick(root, 'block:core:ops');

    expect(detail(root)).not.toContain('No relations to other blocks');
    expect(sentences(root)).toContain('Uses Relay a (2 relations), Gate (1 relation) and Pane (1 relation).');
  });

  it('lists what uses it, areas and platforms together', async () => {
    const root = await open();

    pick(root, 'block:core:gate');

    expect(sentences(root)).toContain('Used by Relay a (2 relations) and Ops (1 relation).');
    expect(sentences(root)).toContain('Uses Support (2 relations).');
  });

  it('says connects to for a partner that goes both ways', async () => {
    const root = await open();

    pick(root, 'block:core:gate');

    expect(sentences(root)).toContain('Connects to Selling (4 relations).');
  });

  it('says uses for a partner it only reaches into, and used by for one that only reaches it', async () => {
    const root = await open();

    pick(root, 'block:core:relay-a');

    expect(sentences(root)).toContain('Uses Selling (3 relations), Gate (2 relations) and Pane (1 relation).');
    expect(sentences(root)).toContain('Used by Ops (2 relations).');
  });

  it('names the areas where the platform has files', async () => {
    const root = await open();

    pick(root, 'block:core:gate');

    expect(sentences(root)).toContain('Files here: Selling (2 files), Support (1 file) and To assign (1 file).');
  });

  it('makes a partner in the list a button that selects it', async () => {
    const root = await open();

    pick(root, 'block:core:ops');
    (root.querySelector('.lt-side .lt-detail .lt-sentence button') as HTMLButtonElement).click();

    expect(macroViewItem(root, 'block:core:relay-a').getAttribute('aria-pressed')).toBe('true');
  });

  it('still says there are no relations for a foundation tile nothing links to and no feature shares', async () => {
    const payload = foundationPayload();
    if (!payload.areas) throw new Error('no areas');
    payload.areas.level0.foundationLinks = payload.areas.level0.foundationLinks.filter((link) => link.from !== 'core:ops' && link.to !== 'core:ops');
    const root = await open(payload);

    pick(root, 'block:core:ops');

    expect(detail(root)).toContain('No relations to other blocks');
  });

  it('does not say there are no relations for a platform that has files in features', async () => {
    const payload = foundationPayload();
    if (!payload.areas) throw new Error('no areas');
    payload.areas.level0.foundationLinks = [];
    const root = await open(payload);

    pick(root, 'block:core:pane');

    expect(detail(root)).not.toContain('No relations to other blocks');
    expect(sentences(root)).toContain('Files here: Selling (2 files) and Support (1 file).');
  });
});

describe('the side panel inside an area', () => {
  beforeEach(() => sizeTheMacroViewPane(WIDE_PANE));

  it('lists the features of the area a foundation tile reaches', async () => {
    const root = await open();
    dive(root, 'block:selling');

    pick(root, 'block:core:relay-a');

    expect(sentences(root)).toContain('Uses Orders (3 relations), Gate (2 relations) and Pane (1 relation).');
  });

  it('shows the relations of a feature to the foundation', async () => {
    const root = await open();
    dive(root, 'block:selling');

    pick(root, 'block:orders');

    expect(sentences(root).some((text) => text.startsWith('Relies on the shared foundation (2 relations in all):') && text.includes('Gate'))).toBe(true);
  });
});

describe('the platforms of a feature or an area', () => {
  it('shows the platforms of an area with file counts, as buttons to their foundation tiles', async () => {
    const root = await open();

    pick(root, 'block:selling');

    expect(sentences(root)).toContain('Platforms: Gate (2 files) and Pane (2 files).');
    const names = [...root.querySelectorAll('.lt-side .lt-detail .lt-sentence button')].map((one) => one.textContent);
    expect(names).toEqual(expect.arrayContaining(['Gate', 'Pane']));
  });

  it('shows the platforms of a feature, the largest first', async () => {
    const root = await open();
    dive(root, 'block:selling');

    pick(root, 'block:orders');

    expect(sentences(root)).toContain('Platforms: Pane (2 files) and Gate (1 file).');
  });

  it('shows no platforms line when the project declares none', async () => {
    const root = await open(foundationPayload(''));

    pick(root, 'block:selling');

    expect(sentences(root).some((text) => text.startsWith('Platforms:'))).toBe(false);
  });
});
