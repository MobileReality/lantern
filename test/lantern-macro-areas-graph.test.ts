import { describe, expect, it } from 'vitest';
import { TO_ASSIGN_ID as MAIN_TO_ASSIGN_ID, deriveMacroAreas } from '../src/main/lantern-macro-areas';
import { macroGraph } from '../src/renderer/lib/lanternmacro';
import { TO_ASSIGN_ID, areaGraph, areasGraph, areasSignature } from '../src/renderer/lib/lanternmacroareas';
import { layoutMacro } from '../src/renderer/lib/lanternmacrolayout';
import { reconcileArea, sceneGraph } from '../src/renderer/lib/lanternmacrolevels';
import { systemLinksFor } from '../src/renderer/lib/lanternmacrorest';
import { macroFixtureOptions, macroFixtureRecords } from './helpers/lantern-macro-fixture';
import { AREA_LIST, areasPayload, derivedAreas } from './helpers/lantern-macro-areas-payload';

const payload = areasPayload();
const areas = payload.areas!;
const { view, texts } = payload;
const MIN = payload.minStrongEdge;
const level0 = areasGraph(areas, view, MIN);
const key = (id: string) => `block:${id}`;
const pairOf = (edge: { from: string; to: string }) => [edge.from, edge.to].sort().join('|');
const mainPairsOf = (edges: readonly { from: string; to: string; main: boolean }[]) => new Set(edges.filter((edge) => edge.main).map(pairOf));

describe('the areas graph (level 0)', () => {
  it('keeps the id main uses for the unplaced features', () => {
    expect(TO_ASSIGN_ID).toBe(MAIN_TO_ASSIGN_ID);
  });

  it('has one card per area in file order, then To assign, then the foundation entries', () => {
    expect(level0.level).toBe('areas');
    expect(level0.blocks.map((block) => block.id)).toEqual(['project-map', 'pull-request-review', 'agent-sessions', 'workspace-setup', 'to-assign', 'core:desktop', 'core:shared', 'core:skills']);
    expect(level0.blocks.filter((block) => block.kind === 'core')).toHaveLength(3);
  });

  it('gives an area card its name, purpose, feature and file count, and the area to open', () => {
    const card = level0.blocks[0];

    expect([card.name, card.purpose, card.caption, card.opens, card.unplaced]).toEqual(['Project map', 'mapping a project and reading its code', '3 features · 121 files', 'project-map', undefined]);
    expect(card.members).toEqual(['Lantern map', 'Lantern sections', 'Code insight']);
    expect(card.kind).toBe('feature');
  });

  it('marks the To assign card as features not placed yet, and lets it open', () => {
    const card = level0.blocks.find((block) => block.id === 'to-assign');

    expect(card).toMatchObject({ name: 'To assign', unplaced: true, opens: 'to-assign', caption: '1 feature · 16 files', members: ['Serve web'] });
    expect(card?.purpose).toContain('not in an area yet');
  });

  it('flags as main exactly the pairs main sent, and carries every area link so a selection can draw them', () => {
    const sent = new Set(areas.level0.mainLinks.map((link) => [link.a, link.b].sort().join('|')));

    expect(level0.edges).toHaveLength(areas.level0.links.length);
    expect(mainPairsOf(level0.edges)).toEqual(sent);
    expect(level0.edges.filter((edge) => edge.main).length).toBeLessThan(level0.edges.length);
    expect(level0.edges.filter((edge) => !sent.has(pairOf(edge))).every((edge) => !edge.main)).toBe(true);
  });

  it('holds the outside systems per area, which the layout shows only for a selection', () => {
    expect(level0.systems.length).toBeGreaterThan(0);
    const mapLinks = level0.systems.flatMap((system) => system.links.filter((link) => link.block === 'project-map'));
    expect(mapLinks.map((link) => link.count).reduce((a, b) => a + b, 0)).toBe(areas.level0.systems['project-map'].reduce((sum, use) => sum + use.count, 0));
    expect(level0.systems.every((system) => system.links.every((link) => link.blockKey === key(link.block)))).toBe(true);
  });

  it('never draws an area that holds no feature with records, because the derivation leaves it out', () => {
    const list = [...AREA_LIST, { id: 'empty-area', description: 'nothing mapped here yet', features: ['ghost-feature'] }];
    const derived = deriveMacroAreas(macroFixtureRecords(), macroFixtureOptions().platforms, list, new Set([...Object.keys(texts), 'ghost-feature']));
    if (!derived.ok) throw new Error(derived.warning);

    expect(derived.areas.level0.areas.map((area) => area.id)).not.toContain('empty-area');
    expect(areasGraph(derived.areas, view, MIN).blocks.map((block) => block.id)).not.toContain('empty-area');
  });
});

describe('an area graph (level 1)', () => {
  const inside = areaGraph(areas, 'project-map', view, texts, MIN)!;

  it('is the feature blocks of the area as today, the foundation band and one stub per other area', () => {
    expect(inside.level).toBe('area');
    expect(inside.area).toMatchObject({ id: 'project-map', name: 'Project map', purpose: 'mapping a project and reading its code', files: 121 });
    expect(inside.blocks.filter((block) => block.kind === 'feature').map((block) => block.id).sort()).toEqual(['code-insight', 'lantern-map', 'lantern-sections']);
    expect(inside.blocks.filter((block) => block.kind === 'core')).toHaveLength(3);
    expect(inside.blocks.filter((block) => block.kind === 'stub').map((block) => block.id)).toEqual(areas.details['project-map'].stubs.map((stub) => stub.id));
  });

  it('gives a feature card its purpose text, as in the flat view', () => {
    expect(inside.blocks.find((block) => block.id === 'lantern-map')?.purpose).toBe(texts['lantern-map']);
    expect(inside.blocks.find((block) => block.id === 'lantern-map')?.opens).toBeUndefined();
  });

  it('names a stub, counts its relations both ways and opens its area', () => {
    const [stub] = inside.blocks.filter((block) => block.kind === 'stub');
    const wanted = areas.details['project-map'].stubs[0];

    expect([stub.name, stub.caption, stub.opens, stub.traffic]).toEqual(['Pull request review', `${wanted.count} relations`, 'pull-request-review', { out: wanted.out, in: wanted.in }]);
  });

  it('keeps the inner edges only, with the main links main sent flagged', () => {
    expect(inside.edges).toHaveLength(areas.details['project-map'].edges.length);
    expect(mainPairsOf(inside.edges).size).toBe(areas.details['project-map'].mainLinks.length);
    expect(inside.edges.every((edge) => inside.blocks.some((block) => block.id === edge.from && block.kind === 'feature'))).toBe(true);
  });

  it('lists the outside systems of the features of the area only', () => {
    const all = new Set(view.external.map((entry) => entry.system));
    const mine = new Set(areas.details['project-map'].systems.map((use) => use.system));

    expect(new Set(inside.systems.map((system) => system.system))).toEqual(mine);
    expect(mine.size).toBeLessThan(all.size);
  });

  it('is null for an area main did not send', () => {
    expect(areaGraph(areas, 'no-such-area', view, texts, MIN)).toBeNull();
  });

  it('opens To assign like any area', () => {
    expect(areaGraph(areas, 'to-assign', view, texts, MIN)?.area).toMatchObject({ id: 'to-assign', name: 'To assign', files: 16 });
  });
});

describe('which graph a payload gives', () => {
  it('is the flat graph of today when there are no areas', () => {
    const { areas: _none, ...plain } = payload;

    expect(sceneGraph(plain, null)).toEqual(macroGraph(view, texts));
    expect(sceneGraph(plain, 'project-map')).toEqual(macroGraph(view, texts));
  });

  it('is the areas graph at the top and the area graph inside, and the top again for an area it does not know', () => {
    expect(sceneGraph(payload, null).level).toBe('areas');
    expect(sceneGraph(payload, 'project-map').level).toBe('area');
    expect(sceneGraph(payload, 'gone-area').level).toBe('areas');
  });

  it('keeps an entered area only while the payload still has it', () => {
    expect(reconcileArea('project-map', areas)).toBe('project-map');
    expect(reconcileArea('gone-area', areas)).toBeNull();
    expect(reconcileArea('project-map', undefined)).toBeNull();
    expect(reconcileArea(null, areas)).toBeNull();
  });

  it('tells two areas sets apart by their ids', () => {
    const fewer = derivedAreas(AREA_LIST.slice(0, 3));

    expect(areasSignature(areas)).toBe(areasSignature(derivedAreas()));
    expect(areasSignature(areas)).not.toBe(areasSignature(fewer));
    expect(areasSignature(null)).toBe('');
  });
});

describe('the layout of the levels', () => {
  const top = layoutMacro(level0);
  const rowY = (shape: ReturnType<typeof layoutMacro>, id: string) => shape.layout.pos.get(key(id))!.y;

  it('stacks the area cards in file order, and puts the foundation band in a column of its own', () => {
    const ys = ['project-map', 'pull-request-review', 'agent-sessions', 'workspace-setup', 'to-assign'].map((id) => rowY(top, id));

    expect(ys).toEqual([...ys].sort((a, b) => a - b));
    expect(top.layout.cols.map((col) => col.layer.name)).toEqual(['Shared foundation', 'Areas']);
    expect(top.layout.pos.get(key('core:desktop'))!.x).toBeLessThan(top.layout.pos.get(key('project-map'))!.x);
  });

  it('draws no outside system at rest and only main links count as at-rest lines', () => {
    expect([...top.layout.pos.keys()].some((k) => k.startsWith('ext:'))).toBe(false);
    expect(mainPairsOf(top.arcs.map((arc) => arc.edge)).size).toBe(areas.level0.mainLinks.length);
    expect(top.arcs.length).toBe(areas.level0.links.length);
  });

  it('shows the systems of a picked area, and of a picked system its areas', () => {
    const shown = systemLinksFor(level0, key('project-map'));
    const picked = layoutMacro(level0, shown);

    expect(shown.size).toBe(areas.level0.systems['project-map'].length);
    expect([...picked.layout.pos.keys()].filter((k) => k.startsWith('ext:'))).toHaveLength(shown.size);
    expect(picked.links).toHaveLength(shown.size);
  });

  it('puts the stubs in their own column right of the features, under a heading of other areas', () => {
    const inside = layoutMacro(areaGraph(areas, 'project-map', view, texts, MIN)!);
    const stubs = areas.details['project-map'].stubs.map((stub) => inside.layout.pos.get(key(stub.id))!);
    const features = ['lantern-map', 'code-insight', 'lantern-sections'].map((id) => inside.layout.pos.get(key(id))!);

    expect(inside.layout.cols.map((col) => col.layer.name)).toEqual(['Shared foundation', 'Project map', 'Other areas']);
    expect(Math.min(...stubs.map((p) => p.x))).toBeGreaterThan(Math.max(...features.map((p) => p.x + p.w)));
    expect(stubs.every((p) => p.h < features[0].h)).toBe(true);
    expect(stubs.map((p) => p.item.block?.opens)).toEqual([true, true, true]);
  });

  it('draws the inner edges at rest as main links only', () => {
    const inside = layoutMacro(areaGraph(areas, 'agent-sessions', view, texts, MIN)!);

    expect(mainPairsOf(inside.arcs.map((arc) => arc.edge)).size).toBe(areas.details['agent-sessions'].mainLinks.length);
    expect(inside.arcs.length).toBe(areas.details['agent-sessions'].edges.length);
  });
});
