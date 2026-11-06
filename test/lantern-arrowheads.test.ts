import { describe, expect, it } from 'vitest';
import { edgeGeometry, edgeKind } from '../src/renderer/lib/lantern-pixi/edge-graphics';
import type { EdgeCurve } from '../src/renderer/lib/lanternlayout';

const curve: EdgeCurve = {
  from: { x: 10, y: 20 },
  control1: { x: 60, y: 20 },
  control2: { x: 90, y: 60 },
  to: { x: 140, y: 60 },
};

describe('relation arrowheads', () => {
  it('puts the send head at the target', () => {
    const geometry = edgeGeometry(curve, '>');
    expect(geometry.startHead).toBeNull();
    expect(geometry.endHead?.tip).toEqual(curve.to);
  });

  it('puts the take head at the source', () => {
    const geometry = edgeGeometry(curve, '<');
    expect(geometry.startHead?.tip).toEqual(curve.from);
    expect(geometry.endHead).toBeNull();
  });

  it('puts both-way heads at both ends', () => {
    const geometry = edgeGeometry(curve, '=');
    expect(geometry.startHead?.tip).toEqual(curve.from);
    expect(geometry.endHead?.tip).toEqual(curve.to);
  });

  it('leaves room for each head instead of drawing the shaft through it', () => {
    for (const arrow of ['>', '<', '='] as const) {
      const geometry = edgeGeometry(curve, arrow);
      if (geometry.startHead) expect(geometry.shaft.from).not.toEqual(curve.from);
      if (geometry.endHead) expect(geometry.shaft.to).not.toEqual(curve.to);
    }
  });

  it('flips the visual kind when the selected file is the target', () => {
    expect(edgeKind('>', true)).toBe('take');
    expect(edgeKind('<', true)).toBe('send');
    expect(edgeKind('=', true)).toBe('both');
    expect(edgeKind('@', true)).toBe('ref');
  });

  it('keeps the declared visual kind from the source side', () => {
    expect(edgeKind('>', false)).toBe('send');
    expect(edgeKind('<', false)).toBe('take');
    expect(edgeKind('=', false)).toBe('both');
    expect(edgeKind('@', false)).toBe('ref');
  });
});
