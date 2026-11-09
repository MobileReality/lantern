import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
// @ts-expect-error plain ES module, no declarations
import { DELIVERY } from '../skills/lantern-delegate/scripts/preferences.mjs';

const SKILL = path.join(__dirname, '..', 'skills', 'lantern-delegate');
const read = (rel: string) => fs.readFileSync(path.join(SKILL, rel), 'utf8');
const protocol = read('protocol.md');
const VALUES = Object.values(DELIVERY) as string[];

const section = (text: string, heading: string) => {
  const start = text.indexOf(heading);
  expect(start, heading).toBeGreaterThanOrEqual(0);
  const rest = text.slice(start + heading.length);
  return rest.slice(0, rest.search(/\n## /) === -1 ? undefined : rest.search(/\n## /));
};

describe('protocol.md and the three Delivery values', () => {
  const delivery = section(protocol, '\n## Delivery');

  it('names exactly pr, push and local, in that order', () => {
    expect(VALUES).toEqual(['pr', 'push', 'local']);
    const bullets = [...delivery.matchAll(/^- \*\*`(\w+)`\*\*/gm)].map((match) => match[1]);
    expect(bullets).toEqual(VALUES);
  });
});
