import { describe, expect, it } from 'vitest';
import type { LanternNode, LanternRelation } from '../src/main/lantern';
import { SYSTEM_KEY, blockKey } from '../src/renderer/lib/lanternmacro';
import { areasGraph, cardMembers } from '../src/renderer/lib/lanternmacroareas';
import { macroMarks } from '../src/renderer/lib/lanternmacromarks';
import { derivePrImpact } from '../src/renderer/lib/lanternmacropr';
import { macroFixtureRecords, repoPrRecord } from './helpers/lantern-macro-fixture';
import { areasPayload } from './helpers/lantern-macro-areas-payload';
import { node } from './helpers/lantern-map';

const payload = areasPayload();
const areas = payload.areas!;
const members = cardMembers(areas);
const graph = areasGraph(areas, payload.view, payload.minStrongEdge);
const records = macroFixtureRecords();
const nodes = records.map((r): LanternNode => node(r.path, r.role, { feature: r.feature }));
const relations = records.flatMap((r): LanternRelation[] => r.relations.map((x) => ({ from: r.path, arrow: x.arrow, to: x.to, ext: x.ext, symbol: null, label: '' })));
const prFiles = repoPrRecord('108').files;
const template = prFiles[0];
const filesAt = (...paths: string[]) => paths.map((path) => ({ ...template, path }));
const pathIn = (block: string) => Object.keys(payload.blockByPath).find((path) => payload.blockByPath[path] === block) as string;
const areaOf = (feature: string) => [...members].find(([, list]) => list.includes(feature))?.[0] as string;

function marksFor(paths: string[]) {
  const impact = derivePrImpact({ view: payload.view, blockByPath: payload.blockByPath, nodes, relations, files: filesAt(...paths) });
  return { impact, marks: macroMarks(graph, impact, members) };
}

describe('the pull request marks on the area cards', () => {
  it('marks an area exactly when one of its features holds a changed file', () => {
    const { impact, marks } = marksFor([pathIn('code-insight'), pathIn('projects-hub'), pathIn('serve-web'), pathIn('core:desktop')]);

    const expected = graph.blocks.filter((block) => (members.get(block.id) ?? [block.id]).some((feature) => impact.blocks.has(feature))).map((block) => block.key);
    expect([...marks.blocks.keys()].sort()).toEqual(expected.sort());
    expect([...marks.blocks.keys()]).toEqual(expect.arrayContaining([blockKey('project-map'), blockKey('workspace-setup'), blockKey('to-assign'), blockKey('core:desktop')]));
    expect(marks.blocks.has(blockKey('pull-request-review'))).toBe(false);
    expect(marks.blocks.has(blockKey('agent-sessions'))).toBe(false);
  });

  it('leaves every card unmarked when the pull request changes no feature file', () => {
    const { marks } = marksFor([]);

    expect(marks.blocks.size).toBe(0);
    expect(marks.edges.size).toBe(0);
    expect(marks.systems.size).toBe(0);
  });

  it('sums the changed files of the features of an area over the files of the whole area', () => {
    const insight = pathIn('code-insight');
    const map = pathIn('lantern-map');
    const sections = pathIn('lantern-sections');
    const area = areas.level0.areas.find((candidate) => candidate.id === 'project-map')!;

    expect(marksFor([insight]).marks.blocks.get(blockKey('project-map'))).toEqual({ changed: 1, total: area.files });
    expect(marksFor([insight, map, sections]).marks.blocks.get(blockKey('project-map'))).toEqual({ changed: 3, total: area.files });
  });

  it('counts To assign by its own features and keeps the foundation band on its entries', () => {
    const { marks } = marksFor([pathIn('serve-web'), pathIn('core:desktop'), pathIn('core:shared')]);

    expect(marks.blocks.get(blockKey('to-assign'))).toEqual({ changed: 1, total: areas.level0.toAssign!.files });
    expect(marks.blocks.get(blockKey('core:desktop'))?.changed).toBe(1);
    expect(marks.blocks.get(blockKey('core:shared'))?.changed).toBe(1);
    expect(marks.blocks.has(blockKey('core:skills'))).toBe(false);
  });

  it('marks the link between two areas when a link between their features carries a changed file', () => {
    const relation = relations.find((candidate) => {
      const from = payload.blockByPath[candidate.from];
      const to = candidate.to ? payload.blockByPath[candidate.to] : undefined;
      return candidate.ext === null && from && to && !from.startsWith('core:') && !to.startsWith('core:') && areaOf(from) !== areaOf(to);
    })!;
    const [from, to] = [areaOf(payload.blockByPath[relation.from]), areaOf(payload.blockByPath[relation.to as string])];

    const { marks } = marksFor([relation.from]);

    expect(marks.edges.has(`${blockKey(from)}>${blockKey(to)}`)).toBe(true);
    expect(marks.edges.size).toBeLessThan(graph.edges.length);
    expect(marksFor([]).marks.edges.size).toBe(0);
  });

  it('marks the outside system an area reaches through a changed file, and the link to it', () => {
    const relation = relations.find((candidate) => {
      const from = payload.blockByPath[candidate.from];
      return candidate.ext !== null && from && !from.startsWith('core:') && payload.view.external.some((entry) => entry.system === candidate.ext && entry.blocks.some((link) => link.block === from));
    })!;
    const area = areaOf(payload.blockByPath[relation.from]);

    const { marks } = marksFor([relation.from]);

    expect(marks.systems.has(`${SYSTEM_KEY}${relation.ext}`)).toBe(true);
    expect(marks.links.has(`${blockKey(area)}>${SYSTEM_KEY}${relation.ext}`)).toBe(true);
  });
});
