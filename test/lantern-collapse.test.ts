import { describe, expect, it } from 'vitest';
import { collapseActive, collapsedGroups, dirTileKey, tileFontSize, ZOOM_THRESHOLD } from '../src/renderer/lib/lanterncollapse';
import type { CollapseGroup } from '../src/renderer/lib/lanterncollapse';
import { arrangeLayout, collapseLayout, dirGroups, emptyFilters, layoutGraph } from '../src/renderer/lib/lanternlayout';
import { graphFixtures } from './fixtures/graph/graph-fixtures';
import { mapOf, node } from './helpers/lantern-map';

const none = new Set<string>();
const BELOW = ZOOM_THRESHOLD - 0.2;
const ABOVE = ZOOM_THRESHOLD + 0.1;

function groups(count: number, size: number): CollapseGroup[] {
  return Array.from({ length: count }, (_, g) => ({ id: `g${g}`, keys: Array.from({ length: size }, (_, i) => `g${g}/f${i}`) }));
}

describe('collapsedGroups', () => {
  it('collapses every directory below the zoom threshold', () => {
    const all = groups(30, 10);
    expect(collapsedGroups({ groups: all, scale: BELOW, expanded: none, pinned: none }).size).toBe(30);
  });

  it('collapses nothing at or above the zoom threshold', () => {
    const all = groups(30, 10);
    expect(collapsedGroups({ groups: all, scale: ZOOM_THRESHOLD, expanded: none, pinned: none }).size).toBe(0);
    expect(collapsedGroups({ groups: all, scale: 1, expanded: none, pinned: none }).size).toBe(0);
  });

  it('leaves a small map alone even when zoomed far out', () => {
    expect(collapsedGroups({ groups: groups(4, 5), scale: 0.2, expanded: none, pinned: none }).size).toBe(0);
    expect(collapseActive(20, 0.2)).toBe(false);
  });

  it('keeps a directory with a pinned file expanded', () => {
    const all = groups(30, 10);
    const collapsed = collapsedGroups({ groups: all, scale: BELOW, expanded: none, pinned: new Set(['g3/f7']) });
    expect(collapsed.has('g3')).toBe(false);
    expect(collapsed.size).toBe(29);
  });

  it('keeps a directory the user expanded', () => {
    const collapsed = collapsedGroups({ groups: groups(30, 10), scale: BELOW, expanded: new Set(['g5']), pinned: none });
    expect(collapsed.has('g5')).toBe(false);
    expect(collapsed.size).toBe(29);
  });

  it('never collapses a directory holding a single file', () => {
    const mixed = [...groups(30, 10), { id: 'lonely', keys: ['lonely/only.ts'] }];
    expect(collapsedGroups({ groups: mixed, scale: BELOW, expanded: none, pinned: none }).has('lonely')).toBe(false);
  });
});

describe('tile font', () => {
  it('grows the tile font as the view shrinks so it stays readable on screen', () => {
    expect(tileFontSize(0.5) * 0.5).toBeGreaterThanOrEqual(10);
    expect(tileFontSize(0.5)).toBeGreaterThan(tileFontSize(0.9));
  });
});

describe('collapseLayout on the large fixture', () => {
  const data = graphFixtures.large;
  const base = layoutGraph(data, emptyFilters());
  const files = data.nodes.length;
  const tiles = (layout: typeof base) => [...layout.pos.values()];

  it('draws a small fraction of the file count as directory tiles below the threshold', () => {
    const collapsed = collapsedGroups({ groups: dirGroups(base), scale: BELOW, expanded: none, pinned: none });
    const layout = collapseLayout(base, collapsed);
    expect(layout.pos.size).toBeLessThan(files * 0.2);
    expect(tiles(layout).every((p) => p.item.tile)).toBe(true);
    expect(tiles(layout).reduce((sum, p) => sum + (p.item.tile?.count ?? 0), 0)).toBe(files);
    expect(layout.height).toBeLessThan(base.height / 3);
  });

  it('draws every file as its own tile above the threshold', () => {
    const collapsed = collapsedGroups({ groups: dirGroups(base), scale: ABOVE, expanded: none, pinned: none });
    const layout = collapseLayout(base, collapsed);
    expect(layout).toBe(base);
    expect(layout.pos.size).toBe(files);
    expect(tiles(layout).some((p) => p.item.tile)).toBe(false);
  });

  it('labels a tile with its directory and file count', () => {
    const collapsed = collapsedGroups({ groups: dirGroups(base), scale: BELOW, expanded: none, pinned: none });
    const layout = collapseLayout(base, collapsed);
    expect(layout.pos.get(dirTileKey('presentation', 'src/group-00'))?.item.label).toBe('src/group-00 · 10');
  });

  it('expands only the pinned directory and keeps its file tile', () => {
    const selected = 'src/group-00/file-0600.ts';
    const collapsed = collapsedGroups({ groups: dirGroups(base), scale: BELOW, expanded: none, pinned: new Set([selected]) });
    const layout = collapseLayout(base, collapsed);
    expect(layout.pos.has(selected)).toBe(true);
    const files0 = tiles(layout).filter((p) => p.item.node);
    expect(files0.length).toBe(10);
    expect(files0.every((p) => p.item.dir === 'src/group-00')).toBe(true);
  });

  it('only keeps edges whose ends are tiles on screen', () => {
    const selected = 'src/group-00/file-0600.ts';
    const collapsed = collapsedGroups({ groups: dirGroups(base), scale: BELOW, expanded: none, pinned: new Set([selected]) });
    const layout = collapseLayout(base, collapsed);
    expect(layout.edges.length).toBeGreaterThan(0);
    expect(layout.edges.every((e) => layout.pos.has(e.fromKey) && layout.pos.has(e.toKey) && e.fromKey !== e.toKey)).toBe(true);
    const unique = new Set(layout.edges.map((e) => `${e.fromKey}|${e.toKey}|${e.r.arrow}`));
    expect(unique.size).toBe(layout.edges.length);
  });

  it('lets arrangeLayout lift a collapsed tile that neighbours the selection', () => {
    const selected = 'src/group-00/file-0600.ts';
    const collapsed = collapsedGroups({ groups: dirGroups(base), scale: BELOW, expanded: none, pinned: new Set([selected]) });
    const layout = collapseLayout(base, collapsed);
    const next = layout.edges.find((e) => e.fromKey === selected)?.toKey as string;
    const lifted = arrangeLayout(layout, new Set([selected, next]));
    expect(lifted.pos.get(next)?.item.tile).toBeDefined();
    expect(lifted.pos.size).toBe(layout.pos.size);
  });
});

describe('collapseLayout on a mixed column', () => {
  const nodes = [
    ...Array.from({ length: 3 }, (_, i) => node(`src/a/f${i}.ts`, 'service')),
    node('src/b/solo.ts', 'service'),
  ];
  const base = layoutGraph(mapOf({ nodes, total: nodes.length }), emptyFilters());

  it('collapses one directory and leaves the other as a header with its file', () => {
    const layout = collapseLayout(base, new Set([dirTileKey('domain', 'src/a')]));
    expect([...layout.pos.keys()]).toEqual([dirTileKey('domain', 'src/a'), 'src/b/solo.ts']);
    expect(layout.cols[0].groups.map((g) => g.dir)).toEqual(['src/b']);
    expect(layout.tileOf?.get('src/a/f1.ts')).toBe(dirTileKey('domain', 'src/a'));
  });
});
