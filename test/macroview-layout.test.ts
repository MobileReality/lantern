import { describe, expect, it } from 'vitest';
import lab from './fixtures/lantern-macro-lab.json';
import { fitCamera, intersects } from '../src/renderer/lib/macroview/camera';
import type { Rect } from '../src/renderer/lib/macroview/camera';
import { topFiles, relationRows } from '../src/renderer/lib/macroview/files';
import { areaUnderView, nearestInDirection, relatedTo } from '../src/renderer/lib/macroview/focus';
import { layoutMacroView, orderAreas } from '../src/renderer/lib/macroview/layout';
import { FEATURES_RAMP } from '../src/renderer/lib/macroview/lod';
import { deriveMarks } from '../src/renderer/lib/macroview/marks';
import { buildModel } from '../src/renderer/lib/macroview/model';
import type { AreasPayload, MacroViewContext } from '../src/renderer/lib/macroview/types';
import { macroViewWorld } from './helpers/macroview-world';

const labPayload = lab.payload as unknown as AreasPayload;
const SMALL = macroViewWorld({ areas: 4, features: 8 }) as unknown as AreasPayload;
const LARGE = macroViewWorld({ areas: 7, features: 24 }) as unknown as AreasPayload;
const NO_MARKS = { prMarks: null, reading: { file: null, blocks: new Set<string>() }, flowStep: null };

const inside = (inner: Rect, outer: Rect) => inner.x >= outer.x - 0.001 && inner.y >= outer.y - 0.001 && inner.x + inner.w <= outer.x + outer.w + 0.001 && inner.y + inner.h <= outer.y + outer.h + 0.001;

describe.each([
  ['the evaluation project', labPayload, 7, 18],
  ['a small project', SMALL, 4, 8],
  ['a large project', LARGE, 7, 24],
])('the model and layout of %s', (_name, payload, areaCount, featureCount) => {
  const model = buildModel(payload);
  const layout = layoutMacroView(model);

  it('has every area and every feature once', () => {
    expect(model.areas).toHaveLength(areaCount);
    expect(model.features.size).toBe(featureCount);
    expect(layout.areas).toHaveLength(areaCount);
    expect(layout.areas.flatMap((area) => area.features)).toHaveLength(featureCount);
  });

  it('places the areas without overlap and the features inside their area', () => {
    for (const [index, area] of layout.areas.entries()) {
      for (const other of layout.areas.slice(index + 1)) expect(intersects(area.rect, other.rect)).toBe(false);
      for (const feature of area.features) expect(inside(feature.rect, area.rect)).toBe(true);
      for (const [at, feature] of area.features.entries()) for (const next of area.features.slice(at + 1)) expect(intersects(feature.rect, next.rect)).toBe(false);
    }
  });

  it('keeps everything inside the world, with the foundation band below the field and as wide as it', () => {
    for (const area of layout.areas) expect(inside(area.rect, layout.world)).toBe(true);
    if (layout.band) {
      expect(layout.band.rect.y).toBeGreaterThan(layout.field.y + layout.field.h);
      expect(inside(layout.band.rect, layout.world)).toBe(true);
      for (const entry of layout.band.boxes) expect(inside(entry.rect, layout.band.rect)).toBe(true);
    }
    expect(layout.band?.rect.w).toBe(layout.field.w);
  });

  it('is deterministic', () => {
    expect(layoutMacroView(buildModel(payload))).toEqual(layout);
  });

  it('shows every area when the whole world is fitted into a narrow or a wide window', () => {
    for (const viewport of [{ w: 560, h: 700 }, { w: 700, h: 880 }, { w: 1280, h: 700 }, { w: 1100, h: 600 }]) {
      const camera = fitCamera(layout.world, viewport);
      for (const area of layout.areas) {
        const left = camera.x + area.rect.x * camera.k;
        const top = camera.y + area.rect.y * camera.k;
        expect(left).toBeGreaterThanOrEqual(0);
        expect(top).toBeGreaterThanOrEqual(0);
        expect(left + area.rect.w * camera.k).toBeLessThanOrEqual(viewport.w);
        expect(top + area.rect.h * camera.k).toBeLessThanOrEqual(viewport.h);
      }
    }
  });

  it('chooses the grid from the window shape: a wider window gets a wider world', () => {
    const wide = layoutMacroView(model, 2.25).world;
    const tall = layoutMacroView(model, 0.75).world;
    expect(wide.w / wide.h).toBeGreaterThanOrEqual(tall.w / tall.h);
  });
});

describe('the evaluation project in particular', () => {
  const model = buildModel(labPayload);

  it('keeps the strongly linked areas next to each other in reading order, with To assign last', () => {
    const order = orderAreas(model).map((area) => area.id);
    expect(order.at(-1)).toBe('to-assign');
    expect(order[0]).toBe('ordering');
    expect(Math.abs(order.indexOf('ordering') - order.indexOf('payments'))).toBeLessThanOrEqual(2);
  });

  it('names the features of an area, their sizes and their purposes from the payload', () => {
    const ordering = model.areaById.get('ordering');
    expect(ordering?.features.map((feature) => feature.id)).toEqual(['cart', 'checkout', 'order-history']);
    expect(model.features.get('checkout')).toMatchObject({ name: 'Checkout', files: 20, areaId: 'ordering', key: 'block:checkout' });
    expect(model.features.get('checkout')?.purpose).toContain('cart into an order');
    expect(model.areaById.get('to-assign')?.pending).toBe(true);
  });

  it('lists the files of a feature, the changed ones first', () => {
    const files = model.filesOf.get('checkout') ?? [];
    expect(files.length).toBe(20);
    const marks = deriveMarks(model, { ...NO_MARKS, payload: labPayload });
    const changed = new Set(['api/checkout/checkout.service.ts', 'web/checkout/CheckoutPage.tsx']);
    const withChanges = { ...marks, files: changed };
    const list = topFiles(files, withChanges, 5);
    expect(list.rows.slice(0, 2).map((row) => row.path).sort()).toEqual([...changed].sort());
    expect(list.rows.slice(0, 2).every((row) => row.changed)).toBe(true);
    expect(list.more).toBe(15);
  });

  it('ranks the relations of a feature by how many there are', () => {
    const rows = relationRows(model, 'checkout');
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0].count).toBeGreaterThanOrEqual(rows[rows.length - 1].count);
    expect(rows.length).toBeLessThanOrEqual(3);
  });
});

describe('what a selection highlights', () => {
  const model = buildModel(labPayload);

  it('lights the partners of a feature, their areas and the outside systems it uses', () => {
    const related = relatedTo(model, 'block:checkout');
    expect(related.keys.has('block:cart')).toBe(true);
    expect(related.keys.has('block:card-payments')).toBe(true);
    expect(related.keys.has('block:ordering')).toBe(true);
    expect(related.keys.has('block:payments')).toBe(true);
    expect(related.keys.has('block:sales-reports')).toBe(false);
    expect([...related.systems].some((key) => key.startsWith('ext:'))).toBe(true);
  });

  it('lights the linked areas of an area, and the users of an outside system', () => {
    const area = relatedTo(model, 'block:ordering');
    expect(area.keys.has('block:catalog')).toBe(true);
    expect(area.keys.has('block:cart')).toBe(true);
    const system = model.systems[0];
    const users = relatedTo(model, system.key);
    expect(users.keys.has(system.key)).toBe(true);
    expect([...system.features.keys()].every((feature) => users.keys.has(`block:${feature}`))).toBe(true);
  });

  it('lights nothing for no selection or an unknown key', () => {
    expect(relatedTo(model, null).keys.size).toBe(0);
    expect(relatedTo(model, 'block:nope').keys.size).toBe(0);
  });

  it('moves between neighbours in the direction of the arrow', () => {
    const items = [
      { key: 'a', rect: { x: 0, y: 0, w: 10, h: 10 } },
      { key: 'b', rect: { x: 20, y: 0, w: 10, h: 10 } },
      { key: 'c', rect: { x: 0, y: 20, w: 10, h: 10 } },
      { key: 'd', rect: { x: 100, y: 100, w: 10, h: 10 } },
    ];
    expect(nearestInDirection(items, 'a', 'right')).toBe('b');
    expect(nearestInDirection(items, 'a', 'down')).toBe('c');
    expect(nearestInDirection(items, 'a', 'left')).toBeNull();
    expect(nearestInDirection(items, 'b', 'left')).toBe('a');
    expect(nearestInDirection(items, null, 'right')).toBe('a');
    expect(nearestInDirection([], 'a', 'right')).toBeNull();
  });
});

describe('which area the camera is inside', () => {
  const model = buildModel(labPayload);
  const layout = layoutMacroView(model);
  const viewport = { w: 700, h: 800 };
  const catalog = layout.areas.find((area) => area.id === 'catalog') as (typeof layout.areas)[number];

  it('is none at the fitted zoom, however the pointer sits', () => {
    const camera = fitCamera(layout.world, viewport);
    expect(areaUnderView(layout, camera, viewport, null, { x: 350, y: 400 })).toBeNull();
  });

  it('is the area under the pointer once that area is big enough on screen to show its features', () => {
    const camera = fitCamera(catalog.rect, viewport, 40);
    expect(areaUnderView(layout, camera, viewport, null, { x: 350, y: 400 })).toBe('catalog');
  });

  it('lets go of the area a little later than it takes it, so zooming around the threshold does not flicker', () => {
    const k = (FEATURES_RAMP.from + FEATURES_RAMP.span * 0.35) / catalog.rect.w;
    const anchor = { x: 350, y: 400 };
    const camera = { k, x: anchor.x - (catalog.rect.x + catalog.rect.w / 2) * k, y: anchor.y - (catalog.rect.y + catalog.rect.h / 2) * k };
    expect(areaUnderView(layout, camera, viewport, 'catalog', anchor)).toBe('catalog');
    expect(areaUnderView(layout, camera, viewport, null, anchor)).toBeNull();
  });
});

describe('marks', () => {
  const model = buildModel(labPayload);
  const changed = ['api/checkout/checkout.service.ts', 'web/checkout/CheckoutPage.tsx', 'web/cart/CartSummary.tsx'];
  const blocks = new Map([
    ['checkout', changed.slice(0, 2).map((path) => ({ path, kind: 'modified' as const, mapped: true, reason: '' }))],
    ['cart', [{ path: changed[2], kind: 'modified' as const, mapped: true, reason: '' }]],
  ]);
  const prMarks = { pr: {}, impact: { blocks, edges: new Set(['cart -> checkout']), systems: new Set(['PostgreSQL']), links: new Set<string>(), other: { unmapped: [], tests: [], unplaced: [], foundation: [] }, changed: 3 }, marks: {}, members: new Map() } as unknown as MacroViewContext['prMarks'];

  it('counts what changed per area and per feature, out of what each holds', () => {
    const marks = deriveMarks(model, { prMarks, reading: { file: null, blocks: new Set() }, flowStep: null, payload: labPayload });
    expect(marks.pr).toBe(true);
    expect(marks.areas.get('ordering')).toEqual({ changed: 3, total: 51 });
    expect(marks.features.get('checkout')).toEqual({ changed: 2, total: 20 });
    expect(marks.features.get('cart')).toEqual({ changed: 1, total: 17 });
    expect(marks.areas.has('catalog')).toBe(false);
    expect(marks.files).toEqual(new Set(changed));
    expect(marks.systems).toEqual(new Set(['ext:PostgreSQL']));
    expect(marks.featureEdges.size).toBe(1);
  });

  it('has no marks without a pull request', () => {
    const marks = deriveMarks(model, { ...NO_MARKS, payload: labPayload });
    expect(marks.pr).toBe(false);
    expect(marks.areas.size + marks.features.size + marks.files.size).toBe(0);
  });

  it('finds where the open file lives, and where the picked Flow step reaches', () => {
    const marks = deriveMarks(model, {
      prMarks: null,
      reading: { file: { path: 'api/checkout/checkout.service.ts', blockKey: 'block:checkout', elsewhere: false, area: null }, blocks: new Set(['block:checkout']) },
      flowStep: { label: 'A shopper', files: new Set(['web/cart/CartSummary.tsx']) },
      payload: labPayload,
    });
    expect(marks.reading.file).toBe('api/checkout/checkout.service.ts');
    expect(marks.home.features.has('checkout')).toBe(true);
    expect(marks.home.areas.has('ordering')).toBe(true);
    expect(marks.flow?.features.has('cart')).toBe(true);
    expect(marks.flow?.label).toBe('A shopper');
  });
});
