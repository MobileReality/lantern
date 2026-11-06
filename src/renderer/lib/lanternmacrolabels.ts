import type { EdgeCurve } from './lanternlayout';

const LABEL_H = 16;
const LABEL_CHAR_W = 7;
const LABEL_PAD = 12;
const LABEL_MARGIN = 3;
const PIECE_SAMPLES = 12;

interface Point {
  x: number;
  y: number;
}

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface EdgeLabel extends Rect {
  text: string;
}

function pointAt(curve: EdgeCurve, t: number): Point {
  const mt = 1 - t;
  const [a, b, c, d] = [mt ** 3, 3 * mt ** 2 * t, 3 * mt * t ** 2, t ** 3];
  return {
    x: a * curve.from.x + b * curve.control1.x + c * curve.control2.x + d * curve.to.x,
    y: a * curve.from.y + b * curve.control1.y + c * curve.control2.y + d * curve.to.y,
  };
}

function pathPoints(path: readonly EdgeCurve[]): Point[] {
  return path.flatMap((piece) => Array.from({ length: PIECE_SAMPLES + 1 }, (_, step) => pointAt(piece, step / PIECE_SAMPLES)));
}

function overlaps(a: Rect, b: Rect, margin = LABEL_MARGIN) {
  return a.x < b.x + b.w + margin && b.x < a.x + a.w + margin && a.y < b.y + b.h + margin && b.y < a.y + a.h + margin;
}

function labelAt(anchor: Point, text: string): EdgeLabel {
  const w = LABEL_PAD + LABEL_CHAR_W * text.length;
  return { x: anchor.x - w / 2, y: anchor.y - LABEL_H / 2, w, h: LABEL_H, text };
}

function strikes(rect: Rect, points: readonly Point[]) {
  return points.filter((p) => p.x >= rect.x && p.x <= rect.x + rect.w && p.y >= rect.y && p.y <= rect.y + rect.h).length;
}

class LabelPlacer {
  private readonly placed: Rect[] = [];
  private readonly paths: { id: string; points: Point[] }[] = [];

  constructor(private readonly obstacles: readonly Rect[]) {}

  addPath(id: string, path: readonly EdgeCurve[]) {
    this.paths.push({ id, points: pathPoints(path) });
  }

  place(id: string, anchors: readonly Point[], text: string): EdgeLabel {
    let best: { label: EdgeLabel; cost: number } | null = null;
    for (const anchor of anchors) {
      const label = labelAt(anchor, text);
      const blocked = this.placed.filter((other) => overlaps(label, other)).length + this.obstacles.filter((other) => overlaps(label, other, 0)).length;
      const crossed = this.paths.reduce((sum, other) => (other.id === id ? sum : sum + strikes(label, other.points)), 0);
      const cost = blocked * 1000 + crossed;
      if (!best || cost < best.cost) best = { label, cost };
      if (cost === 0) break;
    }
    const chosen = (best as NonNullable<typeof best>).label;
    this.placed.push(chosen);
    return chosen;
  }
}

export { LABEL_H, LabelPlacer, overlaps, pathPoints, pointAt };
export type { EdgeLabel, Point, Rect };
