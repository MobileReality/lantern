import type { Scene } from './build';
import type { Camera, Point, Size } from './camera';
import { centerOf, contains, inflate, intersects, toWorld, worldRect } from './camera';
import type { Direction, Placed } from './focus';
import { nearestInDirection } from './focus';
import type { MacroViewLayout } from './layout';
import { ACTIVE, featuresWeight, filesWeight, levelOf } from './lod';
import type { DetailLevel } from './lod';

const FILE_PREFIX = 'file:';

interface Where {
  layout: MacroViewLayout;
  scene: Scene;
  camera: Camera;
  viewport: Size;
}

function centreOf(camera: Camera, viewport: Size): Point {
  return toWorld(camera, { x: viewport.w / 2, y: viewport.h / 2 });
}

function levelAtCentre({ layout, camera, viewport }: Pick<Where, 'layout' | 'camera' | 'viewport'>): DetailLevel {
  const centre = centreOf(camera, viewport);
  const area = layout.areas.find((candidate) => contains(candidate.rect, centre));
  if (!area) return 'areas';
  const features = featuresWeight(area.rect.w * camera.k);
  const feature = area.features.find((candidate) => contains(candidate.rect, centre));
  return levelOf({ features, files: feature ? filesWeight(feature.rect.w * camera.k, features) : 0 });
}

function laneEntries(scene: Scene): Placed[] {
  return [...scene.entries].map((entry) => ({ key: entry.key, rect: entry.rect }));
}

function placedAt(level: DetailLevel, { layout, scene, camera, viewport }: Where): Placed[] {
  if (level === 'areas') return [...layout.areas.map((area) => ({ key: area.key, rect: area.rect })), ...laneEntries(scene)];
  const view = inflate(worldRect(camera, viewport), 20);
  return layout.areas
    .filter((area) => featuresWeight(area.rect.w * camera.k) >= ACTIVE && intersects(area.rect, view))
    .flatMap((area) => area.features.map((feature) => ({ key: feature.key, rect: feature.rect })));
}

function nearestToCentre(items: readonly Placed[], camera: Camera, viewport: Size): string | null {
  const centre = centreOf(camera, viewport);
  const best = items.map((item) => ({ key: item.key, gap: Math.hypot(centerOf(item.rect).x - centre.x, centerOf(item.rect).y - centre.y) })).sort((a, b) => a.gap - b.gap)[0];
  return best?.key ?? null;
}

function featureKeyOf(key: string | null, scene: Scene): string | null {
  if (!key) return null;
  if (!key.startsWith(FILE_PREFIX)) return scene.items.get(key)?.kind === 'feature' ? key : null;
  const path = key.slice(FILE_PREFIX.length);
  for (const area of scene.areas) for (const feature of area.features) if (feature.rows.some((row) => row.path === path)) return feature.key;
  return null;
}

function liveRows(scene: Scene, featureKey: string): string[] {
  for (const area of scene.areas) {
    const feature = area.features.find((candidate) => candidate.key === featureKey);
    if (feature) return feature.rows.filter((row) => row.g.style.display !== 'none' && row.path).map((row) => `${FILE_PREFIX}${row.path}`);
  }
  return [];
}

function stepRows(rows: readonly string[], from: string, direction: Direction): string | null {
  const at = rows.indexOf(from);
  if (direction === 'up') return at > 0 ? rows[at - 1] : null;
  if (direction === 'down') return at < rows.length - 1 ? rows[at + 1] : null;
  return null;
}

function moveFocus(where: Where, focusKey: string | null, direction: Direction): string | null {
  const level = levelAtCentre(where);
  const featureKey = featureKeyOf(focusKey, where.scene);
  if (level === 'files' && featureKey && (direction === 'up' || direction === 'down')) {
    const rows = liveRows(where.scene, featureKey);
    const current = focusKey?.startsWith(FILE_PREFIX) ? focusKey : null;
    if (!current) return rows[0] ?? null;
    const next = stepRows(rows, current, direction);
    return next ?? current;
  }
  const items = placedAt(level === 'files' ? 'features' : level, where);
  const base = featureKey && items.some((item) => item.key === featureKey) ? featureKey : focusKey;
  if (!base || !items.some((item) => item.key === base)) return nearestToCentre(items, where.camera, where.viewport);
  return nearestInDirection(items, base, direction) ?? base;
}

export { FILE_PREFIX, levelAtCentre, moveFocus, nearestToCentre, placedAt };
