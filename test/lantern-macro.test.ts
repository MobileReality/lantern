import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { deriveMacroView } from '../src/main/lantern-macro';
import type { MacroEdge, MacroGroups } from '../src/main/lantern-macro';
import { MAP_DIR, parseMapFile } from '../src/main/lantern-parse';
import { PLATFORMS_FILE, parsePlatforms } from '../src/main/lantern-platforms';

const FIXTURE_ROOT = path.join(__dirname, 'fixtures', 'lantern-macro');

const GROUPS: MacroGroups = {
  'map-viewer': ['lantern-map', 'lantern-sections', 'code-insight', 'pull-requests', 'core:skills'],
  'skills-delegation': ['delegate-runs', 'skills-management'],
  sessions: ['session-monitoring', 'notifications', 'agent-runs', 'serve-web'],
  'app-shell': ['core:desktop', 'core:shared', 'projects-hub'],
};

function mapFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return mapFiles(full);
    return entry.name.endsWith('.lantern') ? [full] : [];
  });
}

function loadFixture() {
  const records = mapFiles(path.join(FIXTURE_ROOT, MAP_DIR)).flatMap((file) => {
    const parsed = parseMapFile(fs.readFileSync(file, 'utf8'), path.relative(FIXTURE_ROOT, file));
    expect(parsed.errors).toEqual([]);
    return parsed.records;
  });
  const platformWarnings: string[] = [];
  const platforms = parsePlatforms(fs.readFileSync(path.join(FIXTURE_ROOT, PLATFORMS_FILE), 'utf8'), platformWarnings);
  expect(platformWarnings).toEqual([]);
  return { records, platforms };
}

function describeEdge(edge: MacroEdge) {
  const { arrows } = edge;
  return `${edge.count} ${edge.from} -> ${edge.to} [> ${arrows['>']} < ${arrows['<']} = ${arrows['=']} @ ${arrows['@']}]`;
}

const strongEdges = (edges: MacroEdge[]) => edges.filter((edge) => edge.strong);
const sumOf = (edges: MacroEdge[]) => edges.reduce((sum, edge) => sum + edge.count, 0);

describe('deriveMacroView', () => {
  const { records, platforms } = loadFixture();

  it('5.1 derives 14 feature blocks, 58 edges (14 strong) and 13 external systems', () => {
    const view = deriveMacroView(records, { platforms });

    expect([view.recordCount, view.testCount]).toEqual([489, 176]);
    expect(view.blocks.map((block) => `${block.files} ${block.id}`)).toEqual([
      '80 lantern-map',
      '45 delegate-runs',
      '36 core:desktop',
      '30 code-insight',
      '21 skills-management',
      '18 pull-requests',
      '16 serve-web',
      '15 notifications',
      '11 core:shared',
      '11 core:skills',
      '11 lantern-sections',
      '8 session-monitoring',
      '6 agent-runs',
      '5 projects-hub',
    ]);
    expect(view.edges).toHaveLength(58);
    expect(view.crossBlockRelations).toBe(330);
    expect(strongEdges(view.edges).map(describeEdge)).toEqual([
      '32 lantern-map -> core:desktop [> 1 < 8 = 23 @ 0]',
      '18 pull-requests -> lantern-map [> 0 < 10 = 8 @ 0]',
      '17 lantern-map -> pull-requests [> 1 < 4 = 8 @ 4]',
      '16 lantern-sections -> lantern-map [> 0 < 13 = 3 @ 0]',
      '16 pull-requests -> code-insight [> 1 < 7 = 8 @ 0]',
      '13 delegate-runs -> lantern-map [> 2 < 0 = 0 @ 11]',
      '12 agent-runs -> core:desktop [> 1 < 6 = 5 @ 0]',
      '12 core:desktop -> code-insight [> 3 < 4 = 5 @ 0]',
      '12 lantern-map -> delegate-runs [> 1 < 10 = 1 @ 0]',
      '11 code-insight -> core:desktop [> 1 < 1 = 9 @ 0]',
      '11 core:desktop -> lantern-map [> 1 < 5 = 5 @ 0]',
      '9 core:desktop -> notifications [> 2 < 2 = 5 @ 0]',
      '9 projects-hub -> core:desktop [> 0 < 5 = 4 @ 0]',
      '9 serve-web -> core:desktop [> 1 < 4 = 4 @ 0]',
    ]);
    expect(sumOf(strongEdges(view.edges))).toBe(197);
    expect(view.external).toHaveLength(13);
    expect(view.external.slice(0, 4).map((e) => [e.system, e.blocks.map((b) => `${b.block}(${b.count})`)])).toEqual([
      ['git', ['code-insight(2)', 'core:skills(2)', 'lantern-map(1)', 'pull-requests(1)', 'skills-management(2)']],
      ['claude-code-cli', ['agent-runs(1)', 'session-monitoring(1)']],
      ['vscode-serve-web', ['core:desktop(1)', 'serve-web(2)']],
      ['bitbucket-api', ['delegate-runs(4)']],
    ]);
  });

  it('5.2 lifts the feature blocks to the 4 groups of the overlay: 12 edges, 6 strong', () => {
    const view = deriveMacroView(records, { platforms, groups: GROUPS });

    expect(view.blocks.map((block) => `${block.files} ${block.id}`)).toEqual([
      '150 map-viewer',
      '66 skills-delegation',
      '52 app-shell',
      '45 sessions',
    ]);
    expect(view.edges).toHaveLength(12);
    expect(view.crossBlockRelations).toBe(212);
    expect(strongEdges(view.edges).map(describeEdge)).toEqual([
      '49 app-shell -> map-viewer [> 12 < 23 = 14 @ 0]',
      '48 map-viewer -> app-shell [> 2 < 10 = 36 @ 0]',
      '35 app-shell -> sessions [> 6 < 8 = 21 @ 0]',
      '27 sessions -> app-shell [> 2 < 14 = 11 @ 0]',
      '18 skills-delegation -> map-viewer [> 2 < 1 = 0 @ 15]',
      '14 map-viewer -> skills-delegation [> 2 < 11 = 1 @ 0]',
    ]);
    expect(sumOf(strongEdges(view.edges))).toBe(191);
  });

  it('5.3 ignores relations written by entry files: 12 edges, 6 strong, 164 relations', () => {
    const view = deriveMacroView(records, { platforms, groups: GROUPS, dropEntryRelations: true });

    expect(view.blocks.map((block) => `${block.files} ${block.id}`)).toEqual([
      '150 map-viewer',
      '66 skills-delegation',
      '52 app-shell',
      '45 sessions',
    ]);
    expect(view.edges).toHaveLength(12);
    expect(view.crossBlockRelations).toBe(164);
    expect(strongEdges(view.edges).map(describeEdge)).toEqual([
      '48 map-viewer -> app-shell [> 2 < 10 = 36 @ 0]',
      '27 app-shell -> map-viewer [> 8 < 17 = 2 @ 0]',
      '26 sessions -> app-shell [> 2 < 14 = 10 @ 0]',
      '18 skills-delegation -> map-viewer [> 2 < 1 = 0 @ 15]',
      '14 map-viewer -> skills-delegation [> 2 < 11 = 1 @ 0]',
      '13 app-shell -> sessions [> 3 < 7 = 3 @ 0]',
    ]);
    expect(sumOf(strongEdges(view.edges))).toBe(146);
  });
});
