import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { labFixtureJson } from './helpers/macro-lab-world';

const FIXTURE = path.join(__dirname, 'fixtures', 'lantern-macro-lab.json');
const fresh = labFixtureJson();

if (process.env.UPDATE_MACRO_LAB === '1') fs.writeFileSync(FIXTURE, `${JSON.stringify(fresh)}\n`);

const stored = JSON.parse(fs.readFileSync(FIXTURE, 'utf8')) as typeof fresh;
const { areas } = stored.payload;
const blockOf = (file: string) => stored.payload.blockByPath[file];
const areaOfBlock = (block: string) => areas.level0.areas.find((area) => area.features.includes(block))?.id;

describe('the evaluation project for Macro layouts', () => {
  it('is the output of the generator, so the committed file cannot drift (UPDATE_MACRO_LAB=1 rewrites it)', () => {
    expect(stored).toEqual(JSON.parse(JSON.stringify(fresh)));
  });

  it('is the size of a real product', () => {
    const features = new Set(stored.files.map((file) => file[2]).filter(Boolean));
    expect(areas.level0.areas).toHaveLength(6);
    expect(features.size).toBeGreaterThanOrEqual(14);
    expect(features.size).toBeLessThanOrEqual(18);
    expect(stored.platforms).toHaveLength(5);
    expect(stored.files.length).toBeGreaterThanOrEqual(300);
    expect(stored.files.length).toBeLessThanOrEqual(600);
  });

  it('has a foundation band and a feature that is in no area', () => {
    expect(areas.level0.foundation.length).toBeGreaterThan(0);
    expect(areas.level0.toAssign?.features).toEqual(['loyalty-points']);
  });

  it('has an infrastructure platform whose featureless files relate to the featureless files of the others', () => {
    const links = areas.level0.foundationLinks.filter((link) => link.from === 'core:infra' || link.to === 'core:infra');

    expect(areas.level0.foundation.map((entry) => entry.id)).toContain('core:infra');
    expect(links.map((link) => `${link.from} -> ${link.to}: ${link.count}`).sort()).toEqual(['core:infra -> core:service: 2', 'core:infra -> core:storefront: 2']);
  });

  it('shows the platforms of a feature and of an area', () => {
    expect(areas.details.ordering.featurePlatforms.checkout.map((entry) => entry.platform).sort()).toEqual(['service', 'storefront']);
    expect(areas.level0.areas.find((area) => area.id === 'ordering')?.platforms.map((entry) => entry.platform).sort()).toEqual(['service', 'storefront']);
  });

  it('has two platforms of one kind that reach the accounts area, one by files of its own there and one by calls from an umbrella feature', () => {
    const [orderBot, helpBot] = ['order-bot', 'help-bot'].map((id) => stored.platforms.find((platform) => platform.id === id));
    const accounts = areas.level0.areas.find((area) => area.id === 'accounts');
    const filesOf = (platform: string) => accounts?.platforms.find((entry) => entry.platform === platform)?.files ?? 0;
    const usesOf = (platform: string) => accounts?.uses.find((entry) => entry.platform === platform)?.count ?? 0;

    expect(orderBot?.kind).toBe(helpBot?.kind);
    expect([filesOf('order-bot'), usesOf('order-bot')]).toEqual([2, 0]);
    expect([filesOf('help-bot'), usesOf('help-bot')]).toEqual([0, 5]);
    expect(stored.files.filter((file) => file[3] === 'help-bot' && file[2] === 'chat-channels' && file[1] !== 'test').length).toBe(3);
    expect(areas.level0.foundation.map((entry) => entry.id)).toEqual(expect.arrayContaining(['core:order-bot', 'core:help-bot']));
  });

  it('has a pull request of 10 to 15 files across three areas, and a flow that points at changed files', () => {
    const changed = stored.pr.files.map((file) => file.path);
    expect(changed.length).toBeGreaterThanOrEqual(10);
    expect(changed.length).toBeLessThanOrEqual(15);
    expect(new Set(changed.map((file) => areaOfBlock(blockOf(file)))).size).toBe(3);
    const referenced = stored.pr.flow.flatMap((story) => [...story.steps, ...story.below].flatMap((step) => step.files ?? []));
    expect(referenced.length).toBeGreaterThan(0);
    for (const file of referenced) expect(changed).toContain(file);
  });
});
