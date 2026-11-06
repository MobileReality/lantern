import type { EdgeCurve } from './lanternlayout';
import type { Point } from './lanternmacrolabels';

const CORNER = 9;
const ROUNDNESS = 0.55;
const SHIFT_STEPS = [0, 1, -1, 2, -2, 3, -3, 4, -4, 5, -5, 6, -6, 7, -7];
const SHIFT_PX = 20;
const SIDE_TAGS = 3;
const SIDE_TAG_STEP_PX = 36;
const OUTSIDE_ANCHOR_PX = 22;

interface ArcRoute {
  x: number;
  toward: 1 | -1;
  reach: number;
  y1: number;
  y2: number;
}

function between(a: Point, b: Point, t: number): Point {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

function segment(from: Point, to: Point): EdgeCurve {
  return { from, control1: between(from, to, 1 / 3), control2: between(from, to, 2 / 3), to };
}

function turn(from: Point, corner: Point, to: Point): EdgeCurve {
  return { from, control1: between(from, corner, ROUNDNESS), control2: between(to, corner, ROUNDNESS), to };
}

function arcPath(route: ArcRoute): EdgeCurve[] {
  const { x, toward, reach, y1, y2 } = route;
  const down = y2 > y1 ? 1 : -1;
  const r = Math.min(CORNER, Math.abs(y2 - y1) / 2, reach / 2);
  const lane = x + toward * reach;
  const out = { x: lane - toward * r, y: y1 };
  const back = { x: lane - toward * r, y: y2 };
  return [
    segment({ x, y: y1 }, out),
    turn(out, { x: lane, y: y1 }, { x: lane, y: y1 + down * r }),
    segment({ x: lane, y: y1 + down * r }, { x: lane, y: y2 - down * r }),
    turn({ x: lane, y: y2 - down * r }, { x: lane, y: y2 }, back),
    segment(back, { x, y: y2 }),
  ];
}

function arcAnchors(route: ArcRoute, labelHeight: number): Point[] {
  const { x, toward, reach, y1, y2 } = route;
  const lane = x + toward * reach;
  const mid = (y1 + y2) / 2;
  const run = Math.max(0, Math.abs(y2 - y1) - 2 * CORNER - labelHeight);
  const along = SHIFT_STEPS.filter((step) => Math.abs(step) * SHIFT_PX <= run / 2).map((step) => ({ x: lane, y: mid + step * SHIFT_PX }));
  const beside = Array.from({ length: SIDE_TAGS }, (_, tag) => SHIFT_STEPS.map((step) => ({ x: lane + toward * (OUTSIDE_ANCHOR_PX + tag * SIDE_TAG_STEP_PX), y: mid + step * SHIFT_PX }))).flat();
  return [...along, ...beside];
}

export { arcAnchors, arcPath };
export type { ArcRoute };
