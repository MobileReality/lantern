// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MacroLoad } from '../src/main/lantern-macro-load';
import { blockKey } from '../src/renderer/lib/lanternmacro';
import { foundationFocus, platformReached } from '../src/renderer/lib/lanternmacrofoundation';
import { sceneGraph } from '../src/renderer/lib/lanternmacrolevels';
import { FAR_ALPHA, markedAlpha, weakNearAlpha } from '../src/renderer/lib/lanternmacromarks';
import { createMacroMode } from '../src/renderer/lib/lanternmacroview';
import { mountLanternView } from '../src/renderer/lib/lanternview';
import { mapOf, node } from './helpers/lantern-map';
import { usesAreas, usesPayload } from './helpers/macro-uses-world';
import { WIDE_PANE, dive, pick, sizeTheMacroViewPane, macroViewItem } from './helpers/macroview-host';

const FILLER = Array.from({ length: 130 }, (_, index) => node(`filler/file-${index}.ts`, 'util'));
const MAP = mapOf({ project: 'demo', nodes: FILLER });
const mounted: ReturnType<typeof mountLanternView>[] = [];
const payload = usesPayload();
const areas = usesAreas();
const top = sceneGraph(payload, null);
const inside = (area: string) => sceneGraph(payload, area);
const sorted = (values: ReadonlySet<string>) => [...values].sort();

beforeEach(() => sizeTheMacroViewPane());

afterEach(() => {
  mounted.splice(0).forEach((one) => { one.dispose(); });
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const sentences = (root: HTMLElement) => [...root.querySelectorAll('.lt-side .lt-detail .lt-sentence')].map((one) => one.textContent ?? '');

async function open(result: MacroLoad = payload) {
  const root = document.createElement('div');
  document.body.appendChild(root);
  mounted.push(mountLanternView(root, MAP, { readMacro: () => Promise.resolve(result) }));
  (root.querySelector('.lt-viewbar [data-view="macro"]') as HTMLButtonElement).click();
  await flush();
  return root;
}

describe('the reach of a platform in a scene', () => {
  it('lists the cards its files reach, the most relations first, without those it has files in', () => {
    expect(platformReached(top.blocks, 'bot-b').map((reached) => [reached.block.id, reached.relations])).toEqual([['people', 3], ['selling', 1]]);
    expect(platformReached(top.blocks, 'bot-a').map((reached) => [reached.block.id, reached.relations])).toEqual([['selling', 2]]);
  });

  it('lists the features of the opened area', () => {
    expect(platformReached(inside('people').blocks, 'bot-b').map((reached) => [reached.block.id, reached.relations])).toEqual([['users', 2], ['roles', 1]]);
  });

  it('is empty for a platform nothing of which reaches into the scene, and for the whole band', () => {
    expect(platformReached(top.blocks, 'gate')).toEqual([]);
    expect(platformReached(top.blocks, 'shared')).toEqual([]);
  });
});

describe('the focus of a platform whose files reach other features', () => {
  it('holds the areas and features it reaches but has no files in', () => {
    const focus = foundationFocus(top, areas, blockKey('core:bot-b'));

    expect(sorted(focus?.usesAreas ?? new Set())).toEqual(['people', 'selling']);
    expect(sorted(focus?.usesFeatures ?? new Set())).toEqual(['orders', 'roles', 'users']);
    expect(sorted(focus?.platformAreas ?? new Set())).toEqual(['channels']);
    expect(sorted(focus?.platformFeatures ?? new Set())).toEqual(['hooks']);
  });

  it('never lists a place in both the files here and the uses', () => {
    for (const id of ['core:bot-a', 'core:bot-b', 'core:gate']) {
      const focus = foundationFocus(top, areas, blockKey(id));

      for (const area of focus?.usesAreas ?? []) expect(focus?.platformAreas.has(area)).toBe(false);
      for (const feature of focus?.usesFeatures ?? []) expect(focus?.platformFeatures.has(feature)).toBe(false);
    }
  });

  it('keeps a place that is already a partner out of the uses, so it is lit once and strongly', () => {
    const focus = foundationFocus(top, areas, blockKey('core:bot-a'));

    expect(focus?.partners.has('selling')).toBe(true);
    expect(focus?.usesAreas.has('selling')).toBe(false);
  });

  it('holds the features of every area at the area level, as the files here do', () => {
    const focus = foundationFocus(inside('people'), areas, blockKey('core:bot-b'));

    expect(sorted(focus?.usesFeatures ?? new Set())).toEqual(['orders', 'roles', 'users']);
    expect(sorted(focus?.platformFeatures ?? new Set())).toEqual(['hooks']);
  });

  it('holds nothing for a platform that reaches nothing, a selection that is no platform and the whole band', () => {
    expect(foundationFocus(top, areas, blockKey('core:gate'))?.usesAreas.size).toBe(0);
    expect(foundationFocus(top, areas, null)).toBeNull();
    expect(foundationFocus(top, areas, 'band:foundation')?.usesFeatures.size).toBe(0);
  });
});

describe('what Levels lights when a platform is selected', () => {
  async function lit(key: string) {
    const mode = createMacroMode(() => Promise.resolve(payload), () => undefined);
    mode.set(true);
    await new Promise((resolve) => setTimeout(resolve, 0));
    mode.select(key);
    return { near: mode.near(), weak: mode.nearWeak() };
  }

  it('lights the cards with files of the platform strongly and the cards it reaches weakly', async () => {
    const { near, weak } = await lit(blockKey('core:bot-b'));

    expect(near.has(blockKey('channels'))).toBe(true);
    expect(sorted(weak)).toEqual([blockKey('people'), blockKey('selling')]);
  });

  it('never lights a card both ways', async () => {
    const { near, weak } = await lit(blockKey('core:bot-a'));

    for (const key of weak) expect(near.has(key)).toBe(false);
  });

  it('lights nothing weakly at rest, or when the selection is not a platform', async () => {
    expect((await lit(blockKey('selling'))).weak.size).toBe(0);
    expect((await lit('')).weak.size).toBe(0);
  });
});

describe('how faintly Levels draws a card the platform only reaches', () => {
  it('is fainter than a lit card and stronger than a dimmed one', () => {
    const lit = markedAlpha(undefined, 'block:channels', false);
    const dimmed = markedAlpha(undefined, 'block:gate', true);
    const weak = weakNearAlpha(lit, true);

    expect(dimmed).toBe(FAR_ALPHA);
    expect(weak).toBeLessThan(lit);
    expect(weak).toBeGreaterThan(dimmed);
  });

  it('leaves a card that is not weak as it was, and never brightens a card that was already faint', () => {
    expect(weakNearAlpha(1, false)).toBe(1);
    expect(weakNearAlpha(0.3, true)).toBe(0.3);
  });
});

describe('the side panel of a platform tile', () => {
  it('lists the places with files of the platform and, apart, the places its files use', async () => {
    const root = await open();

    pick(root, 'block:core:bot-b');

    expect(sentences(root)).toContain('Files here: Channels (1 file).');
    expect(sentences(root)).toContain('Uses, through relations: People (3 relations) and Selling (1 relation).');
  });

  it('keeps an area where the platform has files out of the uses', async () => {
    const root = await open();

    pick(root, 'block:core:bot-a');

    expect(sentences(root)).toContain('Files here: People (2 files) and Channels (1 file).');
    expect(sentences(root)).toContain('Uses, through relations: Selling (2 relations).');
  });

  it('shows the same area as files here for one platform and as uses for the other', async () => {
    const root = await open();

    pick(root, 'block:core:bot-a');
    const first = sentences(root);
    pick(root, 'block:core:bot-b');
    const second = sentences(root);

    expect(first.some((text) => text.startsWith('Files here:') && text.includes('People'))).toBe(true);
    expect(first.some((text) => text.startsWith('Uses, through relations:') && text.includes('People'))).toBe(false);
    expect(second.some((text) => text.startsWith('Files here:') && text.includes('People'))).toBe(false);
    expect(second.some((text) => text.startsWith('Uses, through relations:') && text.includes('People'))).toBe(true);
  });

  it('makes each entry a button that selects it', async () => {
    const root = await open();

    pick(root, 'block:core:bot-b');
    const buttons = [...root.querySelectorAll<HTMLButtonElement>('.lt-side .lt-detail .lt-sentence button')];
    buttons.find((button) => button.textContent === 'People')?.click();

    expect(macroViewItem(root, 'block:people').getAttribute('aria-pressed')).toBe('true');
  });

  it('lists the features of the opened area with their relation counts', async () => {
    sizeTheMacroViewPane(WIDE_PANE);
    const root = await open();
    dive(root, 'block:people');

    pick(root, 'block:core:bot-b');

    expect(sentences(root)).toContain('Uses, through relations: Users (2 relations) and Roles (1 relation).');
    expect(sentences(root).some((text) => text.startsWith('Files here:'))).toBe(false);
  });

  it('has no uses line for a platform whose files reach nothing outside it', async () => {
    const root = await open();

    pick(root, 'block:core:gate');

    expect(sentences(root).some((text) => text.startsWith('Uses, through relations:'))).toBe(false);
  });

  it('has no uses line when the project declares no platforms', async () => {
    const root = await open(usesPayload(''));

    pick(root, 'block:people');

    expect(sentences(root).some((text) => text.startsWith('Uses, through relations:'))).toBe(false);
  });
});
