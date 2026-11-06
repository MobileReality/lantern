import { describe, expect, it } from 'vitest';
import { usesAreas } from './helpers/macro-uses-world';

const derive = usesAreas;

const usesOf = (areas: ReturnType<typeof usesAreas>, id: string) => areas.level0.areas.find((area) => area.id === id)?.uses ?? [];
const arrows = (counts: Partial<Record<'>' | '<' | '=' | '@', number>>) => ({ '>': 0, '<': 0, '=': 0, '@': 0, ...counts });

describe('the areas a platform reaches through relations', () => {
  it('counts the calls of files tagged with another feature, so an umbrella feature does not hide them', () => {
    const people = usesOf(derive(), 'people');

    expect(people).toEqual([{ platform: 'bot-b', count: 3, arrows: arrows({ '=': 2, '<': 1 }) }]);
  });

  it('leaves out an area where the platform has files, so it sits in one list only', () => {
    const areas = derive();

    expect(areas.level0.areas.find((area) => area.id === 'people')?.platforms.map((entry) => entry.platform)).toContain('bot-a');
    expect(usesOf(areas, 'people').map((entry) => entry.platform)).not.toContain('bot-a');
    expect(usesOf(areas, 'channels')).toEqual([]);
  });

  it('counts the relations of files with no feature too', () => {
    const selling = usesOf(derive(), 'selling');

    expect(selling).toEqual([
      { platform: 'bot-a', count: 2, arrows: arrows({ '>': 2 }) },
      { platform: 'bot-b', count: 1, arrows: arrows({ '>': 1 }) },
    ]);
  });

  it('ignores outside systems, pointers, tests and files that belong to no feature', () => {
    const everything = [...derive().level0.areas.flatMap((area) => area.uses), ...(derive().level0.toAssign?.uses ?? [])];

    expect(everything.reduce((sum, entry) => sum + entry.arrows['@'], 0)).toBe(0);
    expect(everything.filter((entry) => entry.platform === 'bot-b').reduce((sum, entry) => sum + entry.count, 0)).toBe(4);
  });

  it('is empty for every area when the project declares no platforms', () => {
    const { level0, details } = derive('');

    for (const area of level0.areas) expect(area.uses).toEqual([]);
    for (const detail of Object.values(details)) expect(detail.featureUses).toEqual({});
  });
});

describe('the features a platform reaches through relations', () => {
  it('lists the platforms that reach a feature, the most relations first', () => {
    const { featureUses } = derive().details.people;

    expect(featureUses.users).toEqual([{ platform: 'bot-b', count: 2, arrows: arrows({ '=': 2 }) }]);
    expect(featureUses.roles).toEqual([{ platform: 'bot-b', count: 1, arrows: arrows({ '<': 1 }) }]);
  });

  it('names a feature only for the platforms that have no files in it', () => {
    const { featureUses, featurePlatforms } = derive().details.people;

    expect(featurePlatforms.users.map((entry) => entry.platform)).toContain('bot-a');
    expect(featureUses.users.map((entry) => entry.platform)).toEqual(['bot-b']);
  });

  it('counts a call from a file in another area', () => {
    const { featureUses } = derive().details.selling;

    expect(featureUses.orders.map((entry) => `${entry.platform}: ${entry.count}`)).toEqual(['bot-a: 2', 'bot-b: 1']);
  });

  it('gives no entry to a feature nothing reaches', () => {
    expect(derive().details.channels.featureUses).toEqual({});
  });
});
