import { describe, expect, it } from 'vitest';
import { deriveMacroAreas } from '../src/main/lantern-macro-areas';
import { parsePlatforms } from '../src/main/lantern-platforms';
import type { FixtureFile } from './helpers/lantern-macro-areas-fixture';
import { AREA_LIST, FEATURE_IDS, FILES, PLATFORM_RULES, foundationAreas, foundationRecords } from './helpers/macro-foundation-world';

const derive = foundationAreas;
const line = (link: { from: string; to: string; count: number }) => `${link.from} -> ${link.to}: ${link.count}`;

describe('foundation links at level 0', () => {
  it('links two foundation blocks to each other', () => {
    const links = derive().level0.foundationLinks.map(line);

    expect(links).toContain('core:ops -> core:relay-a: 2');
    expect(links).toContain('core:ops -> core:gate: 1');
    expect(links).toContain('core:ops -> core:pane: 1');
    expect(links).toContain('core:relay-a -> core:gate: 2');
    expect(links).toContain('core:relay-a -> core:pane: 1');
  });

  it('links a foundation block and an area, summing the member features', () => {
    const links = derive().level0.foundationLinks.map(line);

    expect(links).toContain('selling -> core:gate: 3');
    expect(links).toContain('core:relay-a -> selling: 3');
    expect(links).toContain('core:gate -> support: 2');
    expect(links).toContain('support -> core:pane: 1');
  });

  it('counts the relation arrows of a link', () => {
    const link = derive().level0.foundationLinks.find((candidate) => candidate.from === 'selling' && candidate.to === 'core:gate');

    expect(link?.arrows).toEqual({ '>': 3, '<': 0, '=': 0, '@': 0 });
  });

  it('keeps the links between two areas where they were and out of the foundation list', () => {
    const { links, foundationLinks } = derive().level0;

    expect(links.map(line)).toEqual(['support -> selling: 2']);
    for (const link of links) expect(link.from.startsWith('core:') || link.to.startsWith('core:')).toBe(false);
    for (const link of foundationLinks) expect(link.from.startsWith('core:') || link.to.startsWith('core:')).toBe(true);
  });

  it('never links a foundation block to itself', () => {
    for (const link of derive().level0.foundationLinks) expect(link.from).not.toBe(link.to);
  });

  it('reaches a feature that is in no area through the To assign node', () => {
    const files: FixtureFile[] = [...FILES, { path: 'gate/loose/hook.ts', feature: 'loose', rel: [['gate/core/entry.ts']] }];
    const links = derive(PLATFORM_RULES, files).level0.foundationLinks.map(line);

    expect(links).toContain('to-assign -> core:gate: 1');
  });
});

describe('foundation links inside an area', () => {
  it('links a foundation block and a feature of the area', () => {
    const links = derive().details.selling.foundationLinks.map(line);

    expect(links).toContain('orders -> core:gate: 2');
    expect(links).toContain('billing -> core:gate: 1');
    expect(links).toContain('core:relay-a -> orders: 3');
  });

  it('links two foundation blocks to each other, as at level 0', () => {
    const links = derive().details.selling.foundationLinks.map(line);

    expect(links).toContain('core:ops -> core:relay-a: 2');
    expect(links).toContain('core:relay-a -> core:gate: 2');
  });

  it('leaves out links to features of another area and to other areas', () => {
    const links = derive().details.selling.foundationLinks.map(line);

    expect(links.some((entry) => entry.includes('tickets'))).toBe(false);
    expect(links.some((entry) => entry.includes('support'))).toBe(false);
    expect(derive().details.support.foundationLinks.map(line)).toContain('core:gate -> tickets: 2');
  });

  it('leaves edges between the features of the area as they were', () => {
    const { edges } = derive().details.selling;

    expect(edges.map(line)).toEqual(['billing -> orders: 3']);
  });
});

describe('platforms of a feature and of an area', () => {
  it('lists the platforms of a feature with its files, the largest first, tests left out', () => {
    const { featurePlatforms } = derive().details.selling;

    expect(featurePlatforms.orders).toEqual([{ platform: 'pane', files: 2 }, { platform: 'gate', files: 1 }]);
    expect(featurePlatforms.billing).toEqual([{ platform: 'gate', files: 1 }]);
  });

  it('adds up the features of an area', () => {
    const { areas, toAssign } = derive().level0;

    expect(areas.find((area) => area.id === 'selling')?.platforms).toEqual([{ platform: 'gate', files: 2 }, { platform: 'pane', files: 2 }]);
    expect(areas.find((area) => area.id === 'support')?.platforms).toEqual([{ platform: 'gate', files: 1 }, { platform: 'pane', files: 1 }]);
    expect(toAssign?.platforms).toEqual([{ platform: 'gate', files: 1 }]);
  });

  it('gives every feature of the area an entry', () => {
    expect(Object.keys(derive().details.selling.featurePlatforms)).toEqual(['billing', 'orders']);
  });

  it('is empty for every feature and area when the project declares no platforms', () => {
    const { level0, details } = derive('');

    for (const area of level0.areas) expect(area.platforms).toEqual([]);
    expect(level0.toAssign?.platforms).toEqual([]);
    for (const detail of Object.values(details)) expect(detail.featurePlatforms).toEqual({});
  });

  it('still derives the foundation links of a project without platforms', () => {
    const { level0 } = derive('');

    expect(level0.foundation.map((block) => block.id)).toEqual(['core:shared']);
    expect(level0.foundationLinks.map(line)).toContain('selling -> core:shared: 3');
    for (const link of level0.foundationLinks) expect(link.from).not.toBe(link.to);
  });

  it('gives the same result for any order of the records', () => {
    const records = foundationRecords();
    const rules = parsePlatforms(PLATFORM_RULES, []);
    const declared = new Set(FEATURE_IDS);
    const first = deriveMacroAreas(records, rules, AREA_LIST, declared);
    const second = deriveMacroAreas([...records].reverse(), rules, AREA_LIST, declared);

    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });
});
