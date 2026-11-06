import { SYSTEM_KEY } from '../lanternmacro';
import type { Rect } from './camera';
import { centerOf } from './camera';
import { diveInto, enterArea, fitAll, goTo, zoomToRect } from './follow';
import type { Direction } from './focus';
import type { KeyAction } from './keys';
import { FILE_PREFIX, moveFocus } from './navigation';
import type { Session } from './session';

const KEY_PAN = 140;
const OUT_RATIO = 1.12;
const AREA_STAY_RATIO = 1.3;

function rectOf(session: Session, key: string): Rect | null {
  const item = session.scene.items.get(key);
  if (!item) return null;
  return item.kind === 'foundation' ? (session.scene.band?.rect ?? item.rect) : item.rect;
}

function selectKey(session: Session, key: string | null) {
  const { ctx, scene, model } = session;
  if (key === null) return ctx.select(null);
  if (key.startsWith(SYSTEM_KEY)) return ctx.select(ctx.selection === key ? null : key);
  const item = scene.items.get(key);
  if (!item) return;
  if (item.kind === 'feature') {
    const feature = model.features.get(item.id);
    if (feature) enterArea(session, feature.areaId);
  }
  if (item.kind === 'area' && session.entered === item.id) return ctx.select(null);
  ctx.select(ctx.selection === key ? null : key);
}

function pickKey(session: Session, key: string | null) {
  const { ctx, model } = session;
  if (!key?.startsWith(FILE_PREFIX)) {
    session.pickedFile = null;
    return selectKey(session, key);
  }
  const path = key.slice(FILE_PREFIX.length);
  const owner = model.features.get(ctx.payload.blockByPath[path] ?? '');
  if (owner && ctx.selection !== owner.key) {
    enterArea(session, owner.areaId);
    ctx.select(owner.key);
  }
  session.pickedFile = path;
  ctx.openFile(path);
  session.repaint();
}

function dive(session: Session, key: string | null) {
  const { ctx, scene, model, layout } = session;
  const target = key ?? layout.areas[0]?.key ?? null;
  if (!target) return;
  if (target.startsWith(FILE_PREFIX)) return pickKey(session, target);
  const item = scene.items.get(target);
  if (!item) return;
  session.focusKey = target;
  if (item.kind === 'area') diveInto(session, item.id);
  else {
    const feature = item.kind === 'feature' ? model.features.get(item.id) : undefined;
    if (feature) diveInto(session, feature.areaId);
    if (ctx.selection !== target) ctx.select(target);
  }
  const rect = rectOf(session, target);
  if (rect) zoomToRect(session, rect);
  session.repaint();
}

function stepOut(session: Session): boolean {
  const { driver, layout, ctx } = session;
  const camera = driver.camera();
  if (camera.k > driver.fit().k * OUT_RATIO) {
    const area = session.entered ? layout.areas.find((candidate) => candidate.id === session.entered) : null;
    const inArea = area ? driver.fitTo(area.rect) : null;
    if (inArea && camera.k > inArea.k * AREA_STAY_RATIO) goTo(session, inArea);
    else fitAll(session);
    return true;
  }
  if (ctx.selection) {
    ctx.select(null);
    return true;
  }
  if (!session.entered) return false;
  fitAll(session);
  return true;
}

function revealRect(session: Session, rect: Rect) {
  const camera = session.driver.camera();
  const viewport = session.driver.viewport();
  const left = camera.x + rect.x * camera.k;
  const top = camera.y + rect.y * camera.k;
  const inside = left >= 0 && top >= 0 && left + rect.w * camera.k <= viewport.w && top + rect.h * camera.k <= viewport.h;
  if (inside) return;
  const middle = centerOf(rect);
  goTo(session, { x: viewport.w / 2 - middle.x * camera.k, y: viewport.h / 2 - middle.y * camera.k, k: camera.k });
}

function moveBy(session: Session, direction: Direction) {
  const next = moveFocus({ layout: session.layout, scene: session.scene, camera: session.driver.camera(), viewport: session.driver.viewport() }, session.focusKey, direction);
  if (!next) return;
  session.focusKey = next;
  const rect = session.scene.items.get(next)?.rect;
  if (rect) revealRect(session, rect);
  session.repaint();
}

function panKeys(session: Session, direction: Direction) {
  const dx = direction === 'left' ? KEY_PAN : direction === 'right' ? -KEY_PAN : 0;
  const dy = direction === 'up' ? KEY_PAN : direction === 'down' ? -KEY_PAN : 0;
  session.framing = 'free';
  session.driver.panBy(dx, dy);
}

function zoomCentre(session: Session, factor: number) {
  const viewport = session.driver.viewport();
  session.framing = 'free';
  session.anchor = null;
  session.driver.zoomBy(factor, { x: viewport.w / 2, y: viewport.h / 2 });
}

function run(session: Session, action: KeyAction): boolean {
  if (action.type === 'zoom') zoomCentre(session, action.factor);
  else if (action.type === 'fit') fitAll(session);
  else if (action.type === 'move') moveBy(session, action.direction);
  else if (action.type === 'pan') panKeys(session, action.direction);
  else if (action.type === 'dive') dive(session, session.focusKey ?? session.ctx.selection);
  else if (action.type === 'pick') pickKey(session, session.focusKey ?? session.ctx.selection);
  else return stepOut(session);
  return true;
}

export { dive, pickKey, run, selectKey, zoomCentre };
