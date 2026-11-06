import { Graphics } from 'pixi.js';
import type { EdgeCurve } from '../lanternlayout';
import { FLIP, KIND } from '../lanternctx';

const ARROW_LENGTH = 8;

interface Point {
  x: number;
  y: number;
}

export function drawArrow(graphics: Graphics, tip: Point, base: Point, fill: number) {
  const half = 3.5;
  const dx = tip.x - base.x;
  const dy = tip.y - base.y;
  const length = Math.hypot(dx, dy) || 1;
  const sin = dy / length;
  const cos = dx / length;
  graphics.poly([tip.x, tip.y, base.x + half * sin, base.y - half * cos, base.x - half * sin, base.y + half * cos]).fill(fill);
}

export const EDGE_DASHES: Record<string, number[]> = {
  take: [6, 4],
  both: [10, 3, 2, 3],
  ref: [2, 5],
};

function cubicPoint(curve: EdgeCurve, t: number) {
  const mt = 1 - t;
  const a = mt ** 3;
  const b = 3 * mt ** 2 * t;
  const c = 3 * mt * t ** 2;
  const d = t ** 3;
  return {
    x: a * curve.from.x + b * curve.control1.x + c * curve.control2.x + d * curve.to.x,
    y: a * curve.from.y + b * curve.control1.y + c * curve.control2.y + d * curve.to.y,
  };
}

function splitCurve(curve: EdgeCurve, t: number): [EdgeCurve, EdgeCurve] {
  const between = (a: Point, b: Point) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
  const a = between(curve.from, curve.control1);
  const b = between(curve.control1, curve.control2);
  const c = between(curve.control2, curve.to);
  const d = between(a, b);
  const e = between(b, c);
  const point = between(d, e);
  return [
    { from: curve.from, control1: a, control2: d, to: point },
    { from: point, control1: e, control2: c, to: curve.to },
  ];
}

function arrowBaseParameter(curve: EdgeCurve, atEnd: boolean) {
  const tip = atEnd ? curve.to : curve.from;
  let inner = atEnd ? 1 : 0;
  for (let step = 1; step <= 64; step += 1) {
    const outer = atEnd ? 1 - step / 64 : step / 64;
    const point = cubicPoint(curve, outer);
    if (Math.hypot(point.x - tip.x, point.y - tip.y) >= ARROW_LENGTH) {
      let near = inner;
      let far = outer;
      for (let iteration = 0; iteration < 24; iteration += 1) {
        const middle = (near + far) / 2;
        const candidate = cubicPoint(curve, middle);
        if (Math.hypot(candidate.x - tip.x, candidate.y - tip.y) < ARROW_LENGTH) near = middle;
        else far = middle;
      }
      return far;
    }
    inner = outer;
  }
  return atEnd ? 0 : 1;
}

export function edgeGeometry(curve: EdgeCurve, arrow: keyof typeof FLIP) {
  const start = arrow === '<' || arrow === '=' ? arrowBaseParameter(curve, false) : 0;
  const end = arrow !== '<' ? arrowBaseParameter(curve, true) : 1;
  const collapsed = start > end;
  const fromT = collapsed ? 0.5 : start;
  const toT = collapsed ? 0.5 : end;
  const [, afterStart] = splitCurve(curve, fromT);
  const [shaft] = splitCurve(afterStart, fromT === 1 ? 0 : (toT - fromT) / (1 - fromT));
  const head = (atEnd: boolean, parameter: number) => {
    const tip = atEnd ? curve.to : curve.from;
    const base = cubicPoint(curve, parameter);
    if (Math.hypot(tip.x - base.x, tip.y - base.y) >= ARROW_LENGTH - 1e-4) return { tip, base };
    const candidates = atEnd ? [curve.control2, curve.control1, curve.from] : [curve.control1, curve.control2, curve.to];
    const toward = candidates.find((point) => Math.hypot(point.x - tip.x, point.y - tip.y) > 1e-6) ?? { x: tip.x + 1, y: tip.y };
    const dx = toward.x - tip.x;
    const dy = toward.y - tip.y;
    const length = Math.hypot(dx, dy);
    return { tip, base: { x: tip.x + dx * ARROW_LENGTH / length, y: tip.y + dy * ARROW_LENGTH / length } };
  };
  return {
    shaft,
    startHead: arrow === '<' || arrow === '=' ? head(false, start) : null,
    endHead: arrow !== '<' ? head(true, end) : null,
  };
}

interface LinePath {
  moveTo(x: number, y: number): unknown;
  lineTo(x: number, y: number): unknown;
}

export function drawDashedCurve(graphics: LinePath, curve: EdgeCurve, dash: number[]) {
  const controlLength = Math.hypot(curve.control1.x - curve.from.x, curve.control1.y - curve.from.y)
    + Math.hypot(curve.control2.x - curve.control1.x, curve.control2.y - curve.control1.y)
    + Math.hypot(curve.to.x - curve.control2.x, curve.to.y - curve.control2.y);
  const steps = Math.max(16, Math.min(160, Math.ceil(controlLength / 2)));
  let previous = curve.from;
  let patternIndex = 0;
  let patternLeft = dash[0];
  let drawing = true;
  graphics.moveTo(previous.x, previous.y);
  for (let step = 1; step <= steps; step += 1) {
    const next = cubicPoint(curve, step / steps);
    const dx = next.x - previous.x;
    const dy = next.y - previous.y;
    const length = Math.hypot(dx, dy);
    let consumed = 0;
    while (consumed < length) {
      const amount = Math.min(patternLeft, length - consumed);
      consumed += amount;
      const x = previous.x + dx * (consumed / length);
      const y = previous.y + dy * (consumed / length);
      if (drawing) graphics.lineTo(x, y);
      patternLeft -= amount;
      if (patternLeft < 1e-6) {
        patternIndex = (patternIndex + 1) % dash.length;
        patternLeft = dash[patternIndex];
        drawing = !drawing;
        if (drawing) graphics.moveTo(x, y);
      }
    }
    previous = next;
  }
}

export function edgeKind(arrow: keyof typeof FLIP, incoming: boolean) {
  return KIND[incoming ? FLIP[arrow] : arrow];
}

export function drawEdge(curve: EdgeCurve, kind: string, arrow: keyof typeof FLIP, stroke: number, width = 2.4) {
  const line = new Graphics();
  const geometry = edgeGeometry(curve, arrow);
  const dash = EDGE_DASHES[kind];
  if (dash) drawDashedCurve(line, geometry.shaft, dash);
  else line.moveTo(geometry.shaft.from.x, geometry.shaft.from.y).bezierCurveTo(geometry.shaft.control1.x, geometry.shaft.control1.y, geometry.shaft.control2.x, geometry.shaft.control2.y, geometry.shaft.to.x, geometry.shaft.to.y);
  line.stroke({ color: stroke, width, cap: kind === 'ref' ? 'round' : 'butt' });
  if (geometry.endHead) drawArrow(line, geometry.endHead.tip, geometry.endHead.base, stroke);
  if (geometry.startHead) drawArrow(line, geometry.startHead.tip, geometry.startHead.base, stroke);
  return line;
}
