import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { sizesFixtureJson } from './helpers/macro-sizes-world';

const FIXTURE = path.join(__dirname, 'fixtures', 'lantern-macro-sizes.json');
const fresh = sizesFixtureJson();

if (process.env.UPDATE_MACRO_SIZES === '1') fs.writeFileSync(FIXTURE, `${JSON.stringify(fresh)}\n`);

const stored = JSON.parse(fs.readFileSync(FIXTURE, 'utf8')) as typeof fresh;

describe('the small and the large project for Macro layouts', () => {
  it('are the output of the generator, so the committed file cannot drift (UPDATE_MACRO_SIZES=1 rewrites it)', () => {
    expect(stored).toEqual(JSON.parse(JSON.stringify(fresh)));
  });

  it('have 8 features in 4 areas and 24 features in 7 areas', () => {
    const features = (world: typeof fresh.small) => new Set(world.files.map((file) => file[2]).filter(Boolean)).size;
    expect([features(stored.small), stored.small.payload.areas.level0.areas.length]).toEqual([8, 4]);
    expect([features(stored.large), stored.large.payload.areas.level0.areas.length]).toEqual([24, 7]);
  });

  it('have links between areas to draw and files enough for the Macro view', () => {
    for (const world of [stored.small, stored.large]) {
      expect(world.payload.areas.level0.mainLinks.length).toBeGreaterThan(1);
      expect(world.files.length).toBeGreaterThan(40);
    }
  });
});
