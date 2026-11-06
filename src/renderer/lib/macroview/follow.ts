import type { MacroViewContext } from './types';
import type { Camera, Point, Rect } from './camera';
import { areaUnderView } from './focus';
import type { Session } from './session';

const FOCUS_PADDING = 44;

function viewCentre(session: Session): Point {
  const size = session.driver.viewport();
  return { x: size.w / 2, y: size.h / 2 };
}

function goTo(session: Session, camera: Camera) {
  session.framing = 'free';
  session.anchor = null;
  session.driver.animate(camera);
}

function zoomToRect(session: Session, rect: Rect) {
  goTo(session, session.driver.fitTo(rect, FOCUS_PADDING));
}

function areaCamera(session: Session, id: string): Camera | null {
  const area = session.layout.areas.find((candidate) => candidate.id === id);
  return area ? session.driver.fitTo(area.rect, FOCUS_PADDING) : null;
}

function enterArea(session: Session, id: string) {
  if (session.entered === id) return true;
  const before = session.entered;
  session.entered = id;
  if (session.ctx.enter(session.model.areaById.get(id)?.key ?? '')) return true;
  session.entered = before;
  return false;
}

function leaveArea(session: Session) {
  if (session.entered === null) return;
  session.entered = null;
  session.lastFocus = null;
  session.ctx.leave();
}

function diveInto(session: Session, id: string) {
  session.lastFocus = id;
  enterArea(session, id);
}

function fitAll(session: Session) {
  session.framing = 'all';
  session.anchor = null;
  leaveArea(session);
  session.driver.animate(session.driver.fit());
}

function syncEntered(session: Session) {
  const focus = areaUnderView(session.layout, session.driver.camera(), session.driver.viewport(), session.lastFocus, session.anchor ?? viewCentre(session));
  if (focus === session.lastFocus) return;
  session.lastFocus = focus;
  if (focus) enterArea(session, focus);
  else leaveArea(session);
}

function followHost(session: Session, next: MacroViewContext) {
  const hostArea = next.scene.level === 'area' ? (next.scene.area?.id ?? null) : null;
  if (hostArea === session.entered) return;
  session.entered = hostArea;
  session.lastFocus = hostArea;
  const camera = hostArea ? areaCamera(session, hostArea) : null;
  if (camera) return goTo(session, camera);
  session.framing = 'all';
  session.driver.animate(session.driver.fit());
}

export { FOCUS_PADDING, areaCamera, diveInto, enterArea, fitAll, followHost, goTo, leaveArea, syncEntered, viewCentre, zoomToRect };
