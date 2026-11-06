import { describe, expect, it } from 'vitest';
import { FOUNDATION_KEY, blockKey } from '../src/renderer/lib/lanternmacro';
import { foundationFocus, foundationPartners, platformCarriers } from '../src/renderer/lib/lanternmacrofoundation';
import { sceneGraph } from '../src/renderer/lib/lanternmacrolevels';
import { createMacroMode } from '../src/renderer/lib/lanternmacroview';
import { foundationAreas, foundationPayload } from './helpers/macro-foundation-world';

const payload = foundationPayload();
const areas = foundationAreas();
const top = sceneGraph(payload, null);
const inside = sceneGraph(payload, 'selling');
const sorted = (values: ReadonlySet<string>) => [...values].sort();

describe('the partners of a foundation block', () => {
  it('say uses for a one-way link out, used by for one in, and connects to for both', () => {
    const partners = foundationPartners(areas.level0.foundationLinks, 'core:gate');
    const standing = Object.fromEntries(partners.map((partner) => [partner.id, partner.standing]));

    expect(standing).toEqual({ selling: 'connects to', support: 'uses', 'core:relay-a': 'used by', 'core:ops': 'used by' });
  });

  it('count both directions and the arrows of each', () => {
    const selling = foundationPartners(areas.level0.foundationLinks, 'core:gate').find((partner) => partner.id === 'selling');

    expect(selling).toMatchObject({ count: 4, out: 1, in: 3, arrows: { '>': 4, '<': 0, '=': 0, '@': 0 } });
  });

  it('come strongest first', () => {
    const counts = foundationPartners(areas.level0.foundationLinks, 'core:gate').map((partner) => partner.count);

    expect(counts).toEqual([...counts].sort((a, b) => b - a));
  });
});

describe('the focus of a selected foundation tile', () => {
  it('holds the areas and platforms it is linked to at the top level', () => {
    const focus = foundationFocus(top, areas, blockKey('core:gate'));

    expect(sorted(focus?.partners ?? new Set())).toEqual(['core:ops', 'core:relay-a', 'selling', 'support']);
  });

  it('holds the features the platform has files in, and their areas', () => {
    const focus = foundationFocus(top, areas, blockKey('core:gate'));

    expect(sorted(focus?.platformFeatures ?? new Set())).toEqual(['billing', 'loose', 'orders', 'tickets']);
    expect(sorted(focus?.platformAreas ?? new Set())).toEqual(['selling', 'support', 'to-assign']);
  });

  it('holds only the features of the platform, not those without files on it', () => {
    const focus = foundationFocus(top, areas, blockKey('core:pane'));

    expect(sorted(focus?.platformFeatures ?? new Set())).toEqual(['orders', 'tickets']);
  });

  it('holds the features of the opened area at the area level', () => {
    const focus = foundationFocus(inside, areas, blockKey('core:relay-a'));

    expect(sorted(focus?.partners ?? new Set())).toEqual(['core:gate', 'core:ops', 'core:pane', 'orders']);
  });

  it('has a platform with no files in any feature a partner list and no carriers', () => {
    const focus = foundationFocus(top, areas, blockKey('core:ops'));

    expect(sorted(focus?.partners ?? new Set())).toEqual(['core:gate', 'core:pane', 'core:relay-a']);
    expect(focus?.platformFeatures.size).toBe(0);
    expect(focus?.platformAreas.size).toBe(0);
  });

  it('is null for a selection that is not a foundation tile', () => {
    expect(foundationFocus(top, areas, null)).toBeNull();
    expect(foundationFocus(top, areas, blockKey('selling'))).toBeNull();
    expect(foundationFocus(inside, areas, blockKey('orders'))).toBeNull();
  });

  it('holds the partners of every entry for the whole band', () => {
    const focus = foundationFocus(top, areas, FOUNDATION_KEY);

    expect(sorted(focus?.partners ?? new Set())).toEqual(['selling', 'support']);
    expect(focus?.platformFeatures.size).toBe(0);
  });
});

describe('the carriers of a platform in a scene', () => {
  it('are the blocks that have files on it, the biggest first', () => {
    const carriers = platformCarriers(top.blocks, 'gate').map((carrier) => [carrier.block.id, carrier.files]);

    expect(carriers).toEqual([['selling', 2], ['support', 1], ['to-assign', 1]]);
  });
});

describe('what Levels lights when a foundation tile is selected', () => {
  async function selected(key: string, area: string | null = null) {
    const mode = createMacroMode(() => Promise.resolve(payload), () => undefined);
    mode.set(true);
    await new Promise((resolve) => setTimeout(resolve, 0));
    if (area) mode.enter(blockKey(area));
    mode.select(key);
    return mode.near();
  }

  it('lights the tile, the areas it links to and the other platforms it links to', async () => {
    const near = await selected(blockKey('core:gate'));

    expect([...near].sort()).toEqual([blockKey('core:gate'), blockKey('core:ops'), blockKey('core:relay-a'), blockKey('selling'), blockKey('support'), blockKey('to-assign')].sort());
  });

  it('lights the features of the opened area that the platform has files in', async () => {
    const near = await selected(blockKey('core:pane'), 'selling');

    expect(near.has(blockKey('orders'))).toBe(true);
    expect(near.has(blockKey('billing'))).toBe(false);
  });

  it('lights the features a platform without files in them reaches', async () => {
    const near = await selected(blockKey('core:relay-a'), 'selling');

    expect(near.has(blockKey('orders'))).toBe(true);
    expect(near.has(blockKey('billing'))).toBe(false);
  });
});
