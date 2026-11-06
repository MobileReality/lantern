import { describe, expect, it } from 'vitest';
import { EDGE_DASHES, drawDashedCurve, drawEdge, edgeGeometry, edgeKind } from '../src/renderer/lib/lantern-pixi/edge-graphics';

const curve = {
  from: { x: 0, y: 0 },
  control1: { x: 10, y: 0 },
  control2: { x: 20, y: 0 },
  to: { x: 30, y: 0 },
};

describe('Pixi edge styles', () => {
  it('uses the SVG dash sequences and advances them by distance along a cubic', () => {
    expect(EDGE_DASHES).toEqual({ take: [6, 4], both: [10, 3, 2, 3], ref: [2, 5] });
    const commands: Array<[string, number, number]> = [];
    const path = {
      moveTo: (x: number, y: number) => commands.push(['M', x, y]),
      lineTo: (x: number, y: number) => commands.push(['L', x, y]),
    };
    drawDashedCurve(path, curve, EDGE_DASHES.take);
    expect(commands.filter(([command]) => command === 'M').map(([, x]) => x)).toEqual([0, 10, 20, 30]);
    expect(commands.some(([command, x]) => command === 'L' && x === 6)).toBe(true);
    expect(commands.some(([command, x]) => command === 'L' && x === 16)).toBe(true);
    expect(commands.some(([command, x]) => command === 'L' && x === 26)).toBe(true);
  });

  it('builds all four real Graphics strokes with SVG widths, caps, colors and raw arrowheads', () => {
    const cases = [
      { kind: 'send', arrow: '>' as const, color: 0x56b4e9, cap: 'butt', heads: 1 },
      { kind: 'take', arrow: '<' as const, color: 0xe8743b, cap: 'butt', heads: 1 },
      { kind: 'both', arrow: '=' as const, color: 0xe58bc0, cap: 'butt', heads: 2 },
      { kind: 'ref', arrow: '@' as const, color: 0xc5de4f, cap: 'round', heads: 1 },
    ];
    for (const expected of cases) {
      const graphics = drawEdge(curve, expected.kind, expected.arrow, expected.color);
      const instructions = graphics.context.instructions;
      const stroke = instructions.find((instruction) => instruction.action === 'stroke');
      expect(stroke?.data.style).toMatchObject({ width: 2.4, cap: expected.cap, color: expected.color });
      expect(stroke?.data.path.instructions.filter(({ action }) => action === 'moveTo').length).toBeGreaterThanOrEqual(expected.kind === 'send' ? 1 : 2);
      expect(instructions.filter(({ action }) => action === 'fill')).toHaveLength(expected.heads);
    }
    expect(edgeKind('>', false)).toBe('send');
    expect(edgeKind('>', true)).toBe('take');
    expect(edgeKind('=', true)).toBe('both');
    expect(edgeKind('@', true)).toBe('ref');
  });

  it.each([
    { name: 'steep end', arrow: '>' as const, curve: { from: { x: 0, y: 0 }, control1: { x: 4, y: 2 }, control2: { x: 8, y: 42 }, to: { x: 12, y: 52 } } },
    { name: 'reverse start', arrow: '<' as const, curve: { from: { x: 30, y: 5 }, control1: { x: 20, y: 35 }, control2: { x: 8, y: 12 }, to: { x: 0, y: 40 } } },
    { name: 'double angled', arrow: '=' as const, curve: { from: { x: 2, y: 3 }, control1: { x: 20, y: -5 }, control2: { x: 30, y: 45 }, to: { x: 48, y: 28 } } },
    { name: 'same-column end', arrow: '>' as const, curve: { from: { x: 12, y: 0 }, control1: { x: 18, y: 14 }, control2: { x: 6, y: 34 }, to: { x: 12, y: 48 } } },
  ])('ends the $name shaft at each arrow base', ({ arrow, curve: angled }) => {
    const geometry = edgeGeometry(angled, arrow);
    for (const [shaftPoint, head] of [[geometry.shaft.from, geometry.startHead], [geometry.shaft.to, geometry.endHead]] as const) {
      if (!head) continue;
      expect(shaftPoint.x).toBeCloseTo(head.base.x, 4);
      expect(shaftPoint.y).toBeCloseTo(head.base.y, 4);
      expect(Math.hypot(head.tip.x - head.base.x, head.tip.y - head.base.y)).toBeCloseTo(8, 4);
    }
  });

  it('collapses the shaft between overlapping heads on a short double-ended curve', () => {
    const short = { from: { x: 0, y: 0 }, control1: { x: 2, y: 1 }, control2: { x: 4, y: 1 }, to: { x: 6, y: 0 } };
    const { shaft } = edgeGeometry(short, '=');
    expect(shaft.from.x).toBeCloseTo(shaft.to.x, 6);
    expect(shaft.from.y).toBeCloseTo(shaft.to.y, 6);
    const geometry = edgeGeometry(short, '=');
    expect(Math.hypot(geometry.startHead!.tip.x - geometry.startHead!.base.x, geometry.startHead!.tip.y - geometry.startHead!.base.y)).toBeCloseTo(8, 4);
    expect(Math.hypot(geometry.endHead!.tip.x - geometry.endHead!.base.x, geometry.endHead!.tip.y - geometry.endHead!.base.y)).toBeCloseTo(8, 4);
  });

  it.each([
    { arrow: '>' as const, curve: { from: { x: 0, y: 0 }, control1: { x: 4, y: 2 }, control2: { x: 8, y: 6 }, to: { x: 8, y: 6 } }, side: 'endHead' as const },
    { arrow: '<' as const, curve: { from: { x: 2, y: 3 }, control1: { x: 2, y: 3 }, control2: { x: 7, y: 9 }, to: { x: 10, y: 12 } }, side: 'startHead' as const },
    { arrow: '>' as const, curve: { from: { x: 0, y: 0 }, control1: { x: 0, y: 0 }, control2: { x: 0, y: 0 }, to: { x: 0, y: 0 } }, side: 'endHead' as const },
  ])('keeps a finite eight-unit head when endpoint derivatives vanish', ({ arrow, curve: degenerate, side }) => {
    const head = edgeGeometry(degenerate, arrow)[side]!;
    expect(Number.isFinite(head.base.x)).toBe(true);
    expect(Number.isFinite(head.base.y)).toBe(true);
    expect(Math.hypot(head.tip.x - head.base.x, head.tip.y - head.base.y)).toBeCloseTo(8, 6);
  });
});
