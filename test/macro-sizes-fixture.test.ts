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
});
