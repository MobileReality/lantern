interface Point {
  x: number;
  y: number;
}

interface Size {
  w: number;
  h: number;
}

interface Rect extends Point, Size {}

interface Camera {
  x: number;
  y: number;
  k: number;
}

interface ZoomLimits {
  min: number;
  max: number;
}

const FIT_PADDING = 24;
const MIN_FIT_RATIO = 0.7;
const MAX_FIT_RATIO = 24;
const MAX_SCALE = 4;
const MIN_SCALE = 0.01;
const WHEEL_SENSITIVITY = 0.0015;
const PINCH_SENSITIVITY = 0.01;
const PAN_SLACK = 0.12;
const SAME_PIXELS = 0.5;
const SAME_RATIO = 0.001;

function clamp(value: number, low: number, high: number) {
  return Math.min(high, Math.max(low, value));
}

function centerOf(rect: Rect): Point {
  return { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 };
}

function fitCamera(rect: Rect, viewport: Size, padding = FIT_PADDING, bottomInset = 0): Camera {
  const room = { w: Math.max(1, viewport.w - padding * 2), h: Math.max(1, viewport.h - bottomInset - padding * 2) };
  const k = rect.w > 0 && rect.h > 0 ? Math.min(room.w / rect.w, room.h / rect.h) : 1;
  const center = centerOf(rect);
  return { x: viewport.w / 2 - center.x * k, y: (viewport.h - bottomInset) / 2 - center.y * k, k };
}

function zoomLimits(fit: Camera): ZoomLimits {
  const min = Math.max(MIN_SCALE, fit.k * MIN_FIT_RATIO);
  return { min, max: Math.max(min, Math.min(MAX_SCALE, fit.k * MAX_FIT_RATIO)) };
}

function clampScale(k: number, limits: ZoomLimits) {
  return clamp(k, limits.min, limits.max);
}

function zoomAt(camera: Camera, factor: number, anchor: Point, limits: ZoomLimits): Camera {
  const k = clampScale(camera.k * factor, limits);
  const ratio = k / camera.k;
  return { x: anchor.x - (anchor.x - camera.x) * ratio, y: anchor.y - (anchor.y - camera.y) * ratio, k };
}

function panBy(camera: Camera, dx: number, dy: number): Camera {
  return { ...camera, x: camera.x + dx, y: camera.y + dy };
}

function toWorld(camera: Camera, point: Point): Point {
  return { x: (point.x - camera.x) / camera.k, y: (point.y - camera.y) / camera.k };
}

function toScreen(camera: Camera, point: Point): Point {
  return { x: point.x * camera.k + camera.x, y: point.y * camera.k + camera.y };
}

function worldRect(camera: Camera, viewport: Size): Rect {
  return { x: -camera.x / camera.k, y: -camera.y / camera.k, w: viewport.w / camera.k, h: viewport.h / camera.k };
}

function constrainCamera(camera: Camera, world: Rect, viewport: Size): Camera {
  const center = toWorld(camera, { x: viewport.w / 2, y: viewport.h / 2 });
  const slackX = world.w * PAN_SLACK;
  const slackY = world.h * PAN_SLACK;
  const x = clamp(center.x, world.x - slackX, world.x + world.w + slackX);
  const y = clamp(center.y, world.y - slackY, world.y + world.h + slackY);
  return { x: camera.x + (center.x - x) * camera.k, y: camera.y + (center.y - y) * camera.k, k: camera.k };
}

function lerpCamera(from: Camera, to: Camera, t: number, viewport: Size): Camera {
  const middle = { x: viewport.w / 2, y: viewport.h / 2 };
  const a = toWorld(from, middle);
  const b = toWorld(to, middle);
  const k = from.k * (to.k / from.k) ** t;
  const x = a.x + (b.x - a.x) * t;
  const y = a.y + (b.y - a.y) * t;
  return { x: middle.x - x * k, y: middle.y - y * k, k };
}

function easeInOut(t: number) {
  const v = clamp(t, 0, 1);
  return v < 0.5 ? 4 * v * v * v : 1 - (-2 * v + 2) ** 3 / 2;
}

function sameCamera(a: Camera, b: Camera) {
  return Math.abs(a.x - b.x) < SAME_PIXELS && Math.abs(a.y - b.y) < SAME_PIXELS && Math.abs(a.k / b.k - 1) < SAME_RATIO;
}

function intersects(a: Rect, b: Rect) {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

function contains(rect: Rect, point: Point) {
  return point.x >= rect.x && point.x <= rect.x + rect.w && point.y >= rect.y && point.y <= rect.y + rect.h;
}

function inflate(rect: Rect, by: number): Rect {
  return { x: rect.x - by, y: rect.y - by, w: rect.w + by * 2, h: rect.h + by * 2 };
}

function unionOf(rects: readonly Rect[]): Rect | null {
  if (!rects.length) return null;
  const left = Math.min(...rects.map((rect) => rect.x));
  const top = Math.min(...rects.map((rect) => rect.y));
  const right = Math.max(...rects.map((rect) => rect.x + rect.w));
  const bottom = Math.max(...rects.map((rect) => rect.y + rect.h));
  return { x: left, y: top, w: right - left, h: bottom - top };
}

export { FIT_PADDING, PINCH_SENSITIVITY, WHEEL_SENSITIVITY, centerOf, clamp, clampScale, constrainCamera, contains, easeInOut, fitCamera, inflate, intersects, lerpCamera, panBy, sameCamera, toScreen, toWorld, unionOf, worldRect, zoomAt, zoomLimits };
export type { Camera, Point, Rect, Size, ZoomLimits };
